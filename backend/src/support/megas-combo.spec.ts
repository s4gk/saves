import 'reflect-metadata';
import { SupportWriteService } from './support-write.service';

/**
 * La orden de megas que deja al cliente en un COMBO (internet + TV / streaming) y
 * no sólo en un plan de internet (pedido del 2026-09-28: «en bajar megas sólo salen
 * las megas; necesito un campo para la TV, o en combo»).
 *
 * El plan de internet sigue saliendo del combo —de ahí las megas, el sentido y el
 * perfil—; al cerrar se aplica el combo entero con `applyBundle`.
 */
const COMBO = {
  id: 'combo-100', name: 'Internet 100 megas + Tv Digital', active: true,
  items: [
    { kind: 'TV', planId: 'plan-tv', price: 10000, plan: { id: 'plan-tv', name: 'Television', kind: 'TV', active: true, megas: null, taxRate: 19 } },
    { kind: 'INTERNET', planId: 'plan-100', price: 65000, plan: { id: 'plan-100', name: '100 MEGAS --', kind: 'INTERNET', active: true, megas: 100, taxRate: 0 } },
  ],
};

function armar(opts: { activos?: string[]; sinCombo?: boolean } = {}) {
  const creados: any[] = [];
  const prisma = {
    subscriber: { findUnique: jest.fn().mockResolvedValue({ id: 'sub-1', nomenclature: {}, addressLine: null, neighborhood: '77' }) },
    planBundle: {
      findUnique: jest.fn().mockResolvedValue(COMBO),
      findMany: jest.fn().mockResolvedValue(opts.sinCombo ? [] : [{ ...COMBO, items: [{ kind: 'INTERNET' }, { kind: 'TV' }] }]),
    },
    plan: {
      findUnique: jest.fn((a: any) => Promise.resolve(
        a.where.id === 'plan-tv'
          ? { id: 'plan-tv', name: 'Television', kind: 'TV', megas: null, active: true }
          : { id: 'plan-100', name: '100 MEGAS --', kind: 'INTERNET', megas: 100, active: true },
      )),
    },
    subInvoice: { count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null) },
    subscriberService: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn((args: any) => Promise.resolve(
        args?.where?.kind === 'INTERNET'
          ? [{ planId: 'plan-300', planName: '300 Megas --', megas: 300, status: 'ACTIVO', plan: { name: '300 Megas --', megas: 300 } }]
          : (opts.activos ?? ['INTERNET']).map((kind) => ({ kind })),
      )),
    },
    ticket: { update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (fn: any) =>
      fn({
        ticket: { create: jest.fn((args: any) => { creados.push(args.data); return Promise.resolve({ id: 't-1', code: 500123 }); }) },
        subscriber: { update: jest.fn().mockResolvedValue({}) },
        $queryRaw: jest.fn().mockResolvedValue([{ tid: 500123n }]),
      }),
    ),
  };
  const planes = {
    changePlan: jest.fn(),
    applyBundle: jest.fn().mockResolvedValue({ ok: true, bundle: { id: COMBO.id, name: COMBO.name }, results: [{ router: { ok: true, message: 'ok' } }] }),
  };
  const prorrateo = { aplicar: jest.fn().mockResolvedValue({ mensaje: 'Se cobraron 3 días de TV.' }) };
  const srv = new SupportWriteService(
    prisma as any, {} as any, {} as any, { notifyPost: jest.fn() } as any, { emit: jest.fn() } as any, {} as any, {} as any,
    undefined, undefined, undefined, planes as any,
  );
  (srv as any).prorrateo = prorrateo;
  jest.spyOn(srv as any, 'reprecioDelPlanEnFactura').mockResolvedValue({ ok: true, detalle: 'Factura repreciada.' });
  return { srv, prisma, planes, prorrateo, creados };
}

const USUARIO = { id: 'u-1', name: 'Cajera', email: 'caja@vestel.com.co', areas: ['caja'] } as any;

describe('orden de megas con combo', () => {
  it('al abrirla guarda el combo y el plan de internet que trae', async () => {
    const { srv, creados, planes } = armar();

    await srv.createTicket(
      { subscriberId: 'sub-1', subject: 'servicio', type: 'Bajar megas', bundleToId: 'combo-100' } as any,
      USUARIO,
    );

    expect(creados[0]).toMatchObject({
      planToId: 'plan-100', planToMegas: 100, planFromMegas: 300,
      bundleToId: 'combo-100', bundleToName: 'Internet 100 megas + Tv Digital',
    });
    expect(creados[0].section).toMatch(/de 300 Megas a 100 Megas en combo «Internet 100 megas \+ Tv Digital» \(100 MEGAS -- \+ Television\)/);
    // Al abrir no se mueve nada.
    expect(planes.applyBundle).not.toHaveBeenCalled();
  });

  it('megas + plan de TV → el combo que los reúne', async () => {
    const { srv, creados, prisma } = armar();

    await srv.createTicket(
      { subscriberId: 'sub-1', subject: 'servicio', type: 'Bajar megas', planToId: 'plan-100', tvPlanToId: 'plan-tv' } as any,
      USUARIO,
    );

    expect(prisma.planBundle.findMany).toHaveBeenCalled();
    expect(creados[0]).toMatchObject({ planToId: 'plan-100', planToMegas: 100, bundleToId: 'combo-100' });
  });

  it('megas + TV sin combo armado: rechaza y dice cuál falta', async () => {
    const { srv } = armar({ sinCombo: true });
    await expect(srv.createTicket(
      { subscriberId: 'sub-1', subject: 'servicio', type: 'Bajar megas', planToId: 'plan-100', tvPlanToId: 'plan-tv' } as any,
      USUARIO,
    )).rejects.toThrow(/No hay combo armado con 100 Megas \+ «Television»/);
  });

  it('el sentido se mide con el internet del combo', async () => {
    const { srv } = armar();
    await expect(srv.createTicket(
      { subscriberId: 'sub-1', subject: 'servicio', type: 'Subir megas', bundleToId: 'combo-100' } as any,
      USUARIO,
    )).rejects.toThrow(/no sube nada/);
  });

  it('al cerrarla aplica el combo entero y cobra los días de la TV que no tenía', async () => {
    const { srv, planes, prorrateo, prisma } = armar({ activos: ['INTERNET'] });

    const cascade = await (srv as any).applyCloseCascade(
      { ticketId: 't-1', subscriberId: 'sub-1', type: 'Bajar megas', code: 505251, planToId: 'plan-100', bundleToId: 'combo-100' },
      USUARIO,
    );

    expect(planes.applyBundle).toHaveBeenCalledWith('sub-1', 'combo-100', USUARIO, { allowInactive: true });
    expect(planes.changePlan).not.toHaveBeenCalled();
    expect(prisma.ticket.update).toHaveBeenCalledWith({ where: { id: 't-1' }, data: { planAppliedAt: expect.any(Date) } });
    // El internet se reprecia al precio DENTRO del combo.
    expect((srv as any).reprecioDelPlanEnFactura).toHaveBeenCalledWith(
      'sub-1', expect.objectContaining({ id: 'plan-100', price: 65000 }), 505251, USUARIO,
    );
    expect(prorrateo.aplicar).toHaveBeenCalledWith('sub-1', ['TV'], expect.any(Object));
    expect(cascade.note).toMatch(/combo «Internet 100 megas \+ Tv Digital»/);
  });

  it('si ya tenía la TV no la vuelve a cobrar', async () => {
    const { srv, prorrateo } = armar({ activos: ['INTERNET', 'TV'] });

    const cascade = await (srv as any).applyCloseCascade(
      { ticketId: 't-1', subscriberId: 'sub-1', type: 'Bajar megas', code: 505251, planToId: 'plan-100', bundleToId: 'combo-100' },
      USUARIO,
    );

    expect(prorrateo.aplicar).not.toHaveBeenCalled();
    expect(cascade.note).toMatch(/Television: al precio del combo desde la próxima corrida/);
  });
});
