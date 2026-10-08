import { FixedAssetsService, fechaDia } from './fixed-assets.service';

/**
 * La corrida de depreciación, sin base de datos: qué asiento arma, cómo se pone al
 * día si hubo meses sin correr y que no contabiliza de más.
 */
const cat = { depreciationExpenseAccountId: 'acc-5160', accumulatedDepreciationAccountId: 'acc-1592' };

function activo(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, code: id, name: id, category: cat, branch: { costCenterId: 'CC-YOPAL' }, costCenterId: null,
    acquisitionCost: 6_000_000, residualValue: 0, usefulLifeMonths: 60,
    inServiceDate: fechaDia('2026-03-10'), disposalDate: null, accumulatedDepreciation: 0,
    ...extra,
  };
}

function montar(assets: ReturnType<typeof activo>[]) {
  const creados: unknown[] = [];
  const prisma = {
    fixedAsset: {
      findMany: jest.fn().mockResolvedValue(assets),
      update: jest.fn((a) => { creados.push(['update', a]); return a; }),
    },
    depreciationEntry: { create: jest.fn((a) => { creados.push(['entry', a]); return a; }) },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
  const journal = {
    post: jest.fn().mockResolvedValue({ id: 'je-1', number: 99 }),
    reverse: jest.fn().mockResolvedValue({ id: 'je-rev' }),
  };
  const svc = new FixedAssetsService(prisma as never, journal as never);
  return { svc, prisma, journal, creados };
}

describe('corrida de depreciación', () => {
  it('un asiento: débito al gasto por centro de costo y crédito a la acumulada', async () => {
    const { svc, journal } = montar([activo('A'), activo('B', { costCenterId: 'CC-ADMIN' })]);
    const r = await svc.runDepreciation(2026, 3, { name: 'Prueba' } as never);
    expect(r).toMatchObject({ total: 200_000, assets: 2, journalNumber: 99 });
    const lineas = journal.post.mock.calls[0][0].lines;
    expect(lineas).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'acc-5160', costCenterId: 'CC-YOPAL', debit: 100_000, credit: 0 }),
      expect.objectContaining({ accountId: 'acc-5160', costCenterId: 'CC-ADMIN', debit: 100_000, credit: 0 }),
      expect.objectContaining({ accountId: 'acc-1592', credit: 100_000, debit: 0 }),
    ]));
    const deb = lineas.reduce((s: number, l: { debit: number }) => s + l.debit, 0);
    const cred = lineas.reduce((s: number, l: { credit: number }) => s + l.credit, 0);
    expect(deb).toBe(cred);
  });

  it('se pone al día con los meses que no se corrieron', async () => {
    const { svc, creados } = montar([activo('A', { accumulatedDepreciation: 100_000 })]);
    const r = await svc.runDepreciation(2026, 8, { name: 'Prueba' } as never);
    // Marzo a agosto = 6 meses = 600.000; ya había 100.000 → faltan 500.000.
    expect(r.total).toBe(500_000);
    expect(creados).toContainEqual(['update', expect.objectContaining({ data: expect.objectContaining({ accumulatedDepreciation: 600_000 }) })]);
  });

  it('el último mes lo marca depreciado y no pasa del costo', async () => {
    const { svc, creados } = montar([activo('A', { accumulatedDepreciation: 5_900_000 })]);
    const r = await svc.runDepreciation(2035, 1, { name: 'Prueba' } as never);
    expect(r.total).toBe(100_000);
    expect(creados).toContainEqual(['update', expect.objectContaining({ data: expect.objectContaining({ status: 'FULLY_DEPRECIATED' }) })]);
  });

  it('sin nada que contabilizar no genera asiento', async () => {
    const { svc, journal } = montar([activo('A', { accumulatedDepreciation: 600_000 })]);
    const r = await svc.runDepreciation(2026, 8, { name: 'Prueba' } as never);
    expect(r.journalEntryId).toBeNull();
    expect(journal.post).not.toHaveBeenCalled();
  });

  it('si fallan los renglones, reversa el asiento para no duplicarlo en la próxima corrida', async () => {
    const { svc, prisma, journal } = montar([activo('A')]);
    prisma.$transaction.mockRejectedValueOnce(new Error('caída'));
    await expect(svc.runDepreciation(2026, 3, { name: 'Prueba' } as never)).rejects.toThrow('caída');
    expect(journal.reverse).toHaveBeenCalledWith('je-1', expect.any(String));
  });
});
