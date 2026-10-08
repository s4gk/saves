import { SEDE_ACTIVA, nombresDeSedesApagadas } from './sedes-activas';
import { SubscribersService } from '../subscribers/subscribers.service';
import { OrdersService } from '../orders/orders.service';

/**
 * El interruptor de sede (Mocoa y Villavicencio, 2026-10-01). Lo que se fija aquí es la
 * REGLA, no la lista: una sede desactivada sale de los catálogos y de nada más.
 *
 * Importa que esté escrito: el día que alguien añada un selector de sede nuevo, el
 * `where` se olvida sin que nada se queje, y la sede apagada reaparece sólo en esa
 * pantalla — el fallo más difícil de ver, porque en las otras doce sigue bien.
 */
describe('SEDE_ACTIVA', () => {
  it('es el `where` de los catálogos, y mezcla con el acotado por usuario', () => {
    expect(SEDE_ACTIVA).toEqual({ isActive: true });
    const sedes = [2, 3];
    expect({ ...SEDE_ACTIVA, ...(sedes ? { legacyId: { in: sedes } } : {}) }).toEqual({
      isActive: true,
      legacyId: { in: [2, 3] },
    });
  });
});

describe('catálogos de sede', () => {
  /** Prisma de mentira que apunta con qué `where` se le preguntó. */
  const prismaBranches = () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'b2', name: 'Yopal', legacyId: 2 }]);
    return { prisma: { branch: { findMany } } as never, findMany };
  };

  it('el selector de sede del cliente pide sólo las activas', async () => {
    const { prisma, findMany } = prismaBranches();
    const svc = new SubscribersService(prisma, {} as never, {} as never, {} as never);
    await svc.branches(undefined);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ isActive: true });
  });

  it('el filtro de sede de las compras, que sale de las órdenes y no del catálogo, descarta las apagadas por nombre', async () => {
    const prisma = {
      supplyOrder: {
        groupBy: jest.fn().mockResolvedValue([
          { branchRef: 'Yopal', _count: { _all: 3 } },
          { branchRef: ' mocoa ', _count: { _all: 1 } },
          { branchRef: '', _count: { _all: 9 } },
        ]),
      },
      branch: { findMany: jest.fn().mockResolvedValue([{ name: 'Mocoa' }]) },
    } as never;
    const svc = new OrdersService(prisma, {} as never, {} as never);
    expect(await svc.branches()).toEqual([{ name: 'Yopal', orders: 3 }]);
  });

  it('los nombres apagados se comparan sin mayúsculas ni espacios (en las órdenes la sede es texto libre)', async () => {
    const prisma = { branch: { findMany: jest.fn().mockResolvedValue([{ name: ' Villavicencio ' }]) } } as never;
    expect(await nombresDeSedesApagadas(prisma)).toEqual(new Set(['villavicencio']));
  });
});
