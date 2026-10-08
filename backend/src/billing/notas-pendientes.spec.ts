import { repartirNotasPendientes } from './notas-pendientes';

describe('repartirNotasPendientes', () => {
  it('crédito menor que la factura: entra entero', () => {
    expect(repartirNotasPendientes([{ id: 'a', type: 'CREDITO', queda: 20000 }], 85000))
      .toEqual([{ id: 'a', type: 'CREDITO', amount: 20000 }]);
  });

  it('crédito mayor que la factura: la deja en cero y el resto queda pendiente', () => {
    expect(repartirNotasPendientes([{ id: 'a', type: 'CREDITO', queda: 100000 }], 85000))
      .toEqual([{ id: 'a', type: 'CREDITO', amount: 85000 }]);
  });

  it('débito entra entero aunque la factura no deba nada', () => {
    expect(repartirNotasPendientes([{ id: 'd', type: 'DEBITO', queda: 50000 }], 0))
      .toEqual([{ id: 'd', type: 'DEBITO', amount: 50000 }]);
  });

  it('primero los débitos: el crédito puede absorber el recargo de la misma factura', () => {
    const r = repartirNotasPendientes([
      { id: 'c', type: 'CREDITO', queda: 120000 },
      { id: 'd', type: 'DEBITO', queda: 50000 },
    ], 85000);
    expect(r).toEqual([
      { id: 'd', type: 'DEBITO', amount: 50000 },
      { id: 'c', type: 'CREDITO', amount: 120000 },
    ]);
  });

  it('dos créditos: el segundo sólo con lo que deje el primero; nada si ya está en cero', () => {
    expect(repartirNotasPendientes([
      { id: 'a', type: 'CREDITO', queda: 60000 },
      { id: 'b', type: 'CREDITO', queda: 60000 },
      { id: 'c', type: 'CREDITO', queda: 10000 },
    ], 85000)).toEqual([
      { id: 'a', type: 'CREDITO', amount: 60000 },
      { id: 'b', type: 'CREDITO', amount: 25000 },
    ]);
  });
});
