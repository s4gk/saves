import { BONO_TEMPRANO, bonoPorTemprano, duracionMinutos, minutosSugeridos } from './order-score.policy';

const hace = (min: number, cierre: Date) => new Date(cierre.getTime() - min * 60_000);

describe('bono por terminar temprano', () => {
  const cierre = new Date('2026-10-01T15:00:00Z');

  it('lo gana quien cierra dentro del tiempo estándar', () => {
    expect(bonoPorTemprano(hace(60, cierre), cierre, 90)).toBe(BONO_TEMPRANO);
    expect(bonoPorTemprano(hace(90, cierre), cierre, 90)).toBe(BONO_TEMPRANO);
  });

  it('no lo gana quien se pasa', () => {
    expect(bonoPorTemprano(hace(91, cierre), cierre, 90)).toBe(0);
  });

  it('sin hora de inicio, o empezar y cerrar de un tirón, no cuenta', () => {
    expect(bonoPorTemprano(null, cierre, 90)).toBe(0);
    expect(bonoPorTemprano(hace(2, cierre), cierre, 90)).toBe(0);
  });

  it('un tipo con 0 minutos no da bono', () => {
    expect(bonoPorTemprano(hace(30, cierre), cierre, 0)).toBe(0);
  });

  it('los trámites de escritorio no traen tiempo sugerido y una instalación sí', () => {
    expect(minutosSugeridos('Corte')).toBe(0);
    expect(minutosSugeridos('Instalacion')).toBe(240);
    expect(duracionMinutos(hace(45, cierre), cierre)).toBe(45);
  });
});
