import { OltHuawei } from './olt-huawei.driver';

/**
 * Sync de slot con lectura cortada (2026-10-06). En YOPAL slot 1 la sesión dejó
 * de responder a mitad de 0/1/8: el driver tomaba la salida truncada por buena y
 * los puertos siguientes por vacíos, y el sync marcaba ~570 ONUs como ausentes.
 */
function driverCon(cortaEnPuerto: number | null, cortesSeguidos = 99) {
  const d = new OltHuawei('h', 22, 'u', 'p') as any;
  let cortes = 0;
  d.getOnus = jest.fn(async (_f: number, _s: number, p: number) => {
    if (p === cortaEnPuerto && cortes < cortesSeguidos) { cortes++; return false; }
    return p <= 2 ? [{ ont_id: '0', sn: `SN${p}`, run_state: 'online' }] : [];
  });
  return d;
}

describe('getSlotOnus con lectura cortada', () => {
  it('sin cortes devuelve todas las ONUs con su puerto', async () => {
    const r = await driverCon(null).getSlotOnus(0, 1);
    expect(r).toHaveLength(3);
    expect(r[2]).toMatchObject({ frame: 0, slot: 1, port: 2 });
  });

  it('un corte aislado se reintenta y el slot sale completo', async () => {
    const d = driverCon(1, 1);
    const r = await d.getSlotOnus(0, 1);
    expect(r).toHaveLength(3);
    expect(d.getOnus).toHaveBeenCalledTimes(17);
  });

  it('si el puerto vuelve a cortarse, falla el slot entero (no devuelve lista parcial)', async () => {
    const d = driverCon(8);
    expect(await d.getSlotOnus(0, 1)).toBe(false);
    expect(d.getError()).toMatch(/0\/1\/8 se cortó/);
  });
});
