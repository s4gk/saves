import { quitarCortados, serviciosCaidos, sumarCortesDeOrdenes } from './servicios-cortados';

const combo = [
  { kind: 'INTERNET', planName: '100 Megas F-26' },
  { kind: 'TV', planName: 'Television26' },
  { kind: 'PUNTOS', planName: 'Punto Adicional' },
];
const factura = (p: Partial<Parameters<typeof serviciosCaidos>[0] & object> = {}) => ({
  serviceCombo: '100 Megas F-26', serviceTv: 'Television26', estadoCombo: null, estadoTv: null, ...p,
});

describe('servicio cortado no se factura', () => {
  it('sin corte se cobra todo', () => {
    expect(quitarCortados(combo, factura()).cobrables).toHaveLength(3);
    expect(quitarCortados(combo, null).cobrables).toHaveLength(3);
  });

  it('abonado 56671: internet y TV cortados → no queda nada que cobrar', () => {
    const r = quitarCortados(combo, factura({ estadoCombo: 'CORTADO', estadoTv: 'CORTADO' }));
    expect(r.cobrables).toEqual([]);
    expect(r.cortados).toHaveLength(3);
  });

  it('sólo el internet cortado: la TV y sus puntos se siguen cobrando', () => {
    const r = quitarCortados(combo, factura({ estadoCombo: 'CORTADO' }));
    expect(r.cobrables.map((s) => s.kind)).toEqual(['TV', 'PUNTOS']);
  });

  it('TV cortada: los puntos adicionales se van con ella', () => {
    const r = quitarCortados(combo, factura({ estadoTv: 'SUSPENDIDO' }));
    expect(r.cobrables.map((s) => s.kind)).toEqual(['INTERNET']);
  });

  it("el 'cortado' que el legacy le escribe a quien no tiene ese servicio no cuenta", () => {
    const soloTv = factura({ serviceCombo: 'no', estadoCombo: 'CORTADO' });
    expect(serviciosCaidos(soloTv)).toEqual({ INTERNET: false, TV: false });
    expect(quitarCortados(combo, soloTv).cobrables).toHaveLength(3);
  });

  describe('la orden de corte cuenta aunque la factura haya perdido la marca', () => {
    it('abonado 51854: «Corte Combo» cerrada, factura limpia → no se cobra nada', () => {
      const c = sumarCortesDeOrdenes(factura(), { INTERNET: true, TV: true });
      expect(serviciosCaidos(c)).toEqual({ INTERNET: true, TV: true });
      expect(quitarCortados(combo, c).cobrables).toEqual([]);
    });

    it("'Corte Internet' por orden: la TV y sus puntos se siguen cobrando", () => {
      const c = sumarCortesDeOrdenes(factura(), { INTERNET: true, TV: false });
      expect(quitarCortados(combo, c).cobrables.map((s) => s.kind)).toEqual(['TV', 'PUNTOS']);
    });

    it('sólo añade cortes: lo que la factura ya da por caído no lo levanta', () => {
      const c = sumarCortesDeOrdenes(factura({ estadoTv: 'SUSPENDIDO' }), { INTERNET: false, TV: false });
      expect(c?.estadoTv).toBe('SUSPENDIDO');
      expect(sumarCortesDeOrdenes(factura({ estadoTv: 'SUSPENDIDO' }), { INTERNET: false, TV: true })?.estadoTv).toBe('SUSPENDIDO');
    });

    it("una 'Corte Combo' a quien sólo tiene TV no le inventa internet", () => {
      const c = sumarCortesDeOrdenes(factura({ serviceCombo: 'no' }), { INTERNET: true, TV: true });
      expect(serviciosCaidos(c)).toEqual({ INTERNET: false, TV: true });
    });

    it('sin factura anterior no hay de dónde sacar la cabecera', () => {
      expect(sumarCortesDeOrdenes(null, { INTERNET: true, TV: true })).toBeNull();
    });
  });
});
