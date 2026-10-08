import { normalizarRango, rangoAnterior } from './dashboard.service';

/** Contra qué periodo se comparan las tarjetas del panel ejecutivo. */
describe('rangoAnterior', () => {
  const ant = (a: string, b: string) => {
    const r = rangoAnterior(normalizarRango(a, b));
    return `${r.desde}..${r.hasta}`;
  };

  it('mes en curso: los mismos días del mes anterior', () => {
    expect(ant('2026-09-01', '2026-09-26')).toBe('2026-08-01..2026-08-26');
  });
  it('mes entero: el mes entero anterior, aunque tenga otro largo', () => {
    expect(ant('2026-08-01', '2026-08-31')).toBe('2026-07-01..2026-07-31');
    expect(ant('2026-09-01', '2026-09-30')).toBe('2026-08-01..2026-08-31');
    expect(ant('2026-03-01', '2026-03-31')).toBe('2026-02-01..2026-02-28');
  });
  it('un día que el mes anterior no tiene se recorta a su último día', () => {
    expect(ant('2026-03-01', '2026-03-30')).toBe('2026-02-01..2026-02-28');
  });
  it('varios meses: retrocede los mismos meses', () => {
    expect(ant('2026-07-01', '2026-09-26')).toBe('2026-04-01..2026-06-26');
    expect(ant('2026-01-01', '2026-12-31')).toBe('2025-01-01..2025-12-31');
  });
  it('rango suelto: la ventana del mismo largo justo antes', () => {
    expect(ant('2026-09-10', '2026-09-26')).toBe('2026-08-24..2026-09-09');
    expect(ant('2026-09-26', '2026-09-26')).toBe('2026-09-25..2026-09-25');
  });
});
