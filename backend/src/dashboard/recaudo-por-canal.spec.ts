import { recaudoPorCanal } from './dashboard.service';

/** Por dónde entró el recaudo del panel: ventanilla, Wompi o bancos. */
describe('recaudoPorCanal', () => {
  it('reparte cada cuenta en su canal y las partes suman el total', () => {
    const c = recaudoPorCanal([
      { cuenta: 3, nombre: 'Yopal', sede: 2, total: 100, n: 4 },
      { cuenta: 23, nombre: 'WOMPI', sede: 0, total: 50, n: 2 },
      { cuenta: 7, nombre: 'BANCOLOMBIA TELECOMUNICACIONES', sede: 0, total: 30, n: 1 },
      { cuenta: 5, nombre: 'Monterrey', sede: 4, total: 20, n: 1 },
    ]);
    expect(c.map((x) => [x.canal, x.total, x.n])).toEqual([['ventanilla', 120, 5], ['wompi', 50, 2], ['bancos', 30, 1]]);
    expect(c[2].cuentas[0].nombre).toBe('BANCOLOMBIA TELECOMUNICACIONES');
  });
  it('los saldos a favor (sin caja) salen uno por sede del cliente, dentro del total', () => {
    const c = recaudoPorCanal([
      { cuenta: 3, nombre: 'Yopal', sede: 2, total: 100, n: 4 },
      { cuenta: null, nombre: null, sede: null, sedeCliente: 2, nombreSedeCliente: 'Yopal', total: 22, n: 3 },
      { cuenta: null, nombre: null, sede: null, sedeCliente: null, nombreSedeCliente: null, total: 1, n: 1 },
    ]);
    expect([c[0].total, c[0].n]).toEqual([123, 8]);
    expect(c[0].cuentas.slice(1)).toEqual([
      { id: null, nombre: 'Saldos a favor · Yopal', total: 22, n: 3, sede: 2 },
      { id: null, nombre: 'Saldos a favor · Sin sede', total: 1, n: 1, sede: null },
    ]);
  });
  it('siempre los tres canales, aunque no haya movimientos', () => {
    expect(recaudoPorCanal([]).map((x) => x.total)).toEqual([0, 0, 0]);
  });
});
