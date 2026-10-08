import { acumuladaAl, cuotaMensual, fechaDia } from './fixed-assets.service';

const olt = {
  acquisitionCost: 6_000_000,
  residualValue: 0,
  usefulLifeMonths: 60,
  inServiceDate: fechaDia('2026-03-15'),
};

describe('depreciación en línea recta', () => {
  it('cuota mensual = (costo − residual) / vida útil', () => {
    expect(cuotaMensual(olt)).toBe(100_000);
    expect(cuotaMensual({ ...olt, residualValue: 600_000 })).toBe(90_000);
  });

  it('el mes de entrada en uso cuenta completo', () => {
    expect(acumuladaAl(olt, 2026, 2)).toBe(0);
    expect(acumuladaAl(olt, 2026, 3)).toBe(100_000);
    expect(acumuladaAl(olt, 2026, 9)).toBe(700_000);
  });

  it('nunca pasa de costo − residual', () => {
    expect(acumuladaAl(olt, 2031, 2)).toBe(6_000_000);
    expect(acumuladaAl(olt, 2040, 1)).toBe(6_000_000);
    expect(acumuladaAl({ ...olt, residualValue: 500_000 }, 2040, 1)).toBe(5_500_000);
  });

  it('con cuota de centavos, el último mes cierra exacto', () => {
    const a = { acquisitionCost: 1_000_000, residualValue: 0, usefulLifeMonths: 36, inServiceDate: fechaDia('2026-01-01') };
    expect(acumuladaAl(a, 2028, 12)).toBe(1_000_000);
    expect(acumuladaAl(a, 2026, 1)).toBe(27_777.78);
  });

  it('dado de baja, se congela en el mes de la baja', () => {
    const baja = { ...olt, disposalDate: fechaDia('2026-06-10') };
    expect(acumuladaAl(baja, 2027, 1)).toBe(400_000);
  });

  it('las fechas del primer y último día del mes no se corren de mes', () => {
    const a = { ...olt, inServiceDate: fechaDia('2026-04-01') };
    expect(acumuladaAl(a, 2026, 3)).toBe(0);
    expect(acumuladaAl(a, 2026, 4)).toBe(100_000);
    const b = { ...olt, inServiceDate: fechaDia('2026-04-30') };
    expect(acumuladaAl(b, 2026, 4)).toBe(100_000);
  });
});
