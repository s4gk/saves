import { contarIntentosPppoe } from './mikrotik.service';

/**
 * Log del Mikrotik de Monterrey, 17-oct-2026 (formato real de RouterOS 7). Con
 * cero intentos la clave no es el problema: el PPPoE no está saliendo de la casa.
 */
const LOG = [
  { time: '2026-10-17 08:33:12', topics: 'system,info', message: 'ppp secret <MARIAMAGDALENAGARNICADAZA> added by api:api.crmvestel@89.117.146.226' },
  { time: '2026-10-17 10:00:15', topics: 'system,error,critical', message: 'login failure for user user from 34.100.153.150 via ssh' },
  { time: '2026-10-17 10:01:02', topics: 'pppoe,ppp,info', message: '<pppoe-JUAN.PEREZ>: user JUAN.PEREZ authentication failed' },
  { time: '2026-10-17 10:25:11', topics: 'pppoe,ppp,info,account', message: 'MARIAMAGDALENAGARNICADAZA logged in, 10.1.109.6 from D8:59:82:1F:C4:57' },
];

describe('contarIntentosPppoe', () => {
  it('cuenta los ingresos del usuario y no se confunde con el secret creado ni con otros', () => {
    expect(contarIntentosPppoe(LOG, 'MARIAMAGDALENAGARNICADAZA')).toEqual({ rechazos: 0, ingresos: 1, ultimoRechazo: null });
  });
  it('cuenta los «authentication failed» del usuario, sin distinguir mayúsculas', () => {
    expect(contarIntentosPppoe(LOG, 'juan.perez')).toEqual({ rechazos: 1, ingresos: 0, ultimoRechazo: '2026-10-17 10:01:02' });
  });
  it('un usuario que es prefijo de otro no cuenta los rechazos ajenos', () => {
    expect(contarIntentosPppoe(LOG, 'JUAN').rechazos).toBe(0);
    expect(contarIntentosPppoe(LOG, 'MAGDALENAGARNICADAZA').ingresos).toBe(0);
  });
  it('sin usuario no cuenta nada', () => {
    expect(contarIntentosPppoe(LOG, '  ')).toEqual({ rechazos: 0, ingresos: 0, ultimoRechazo: null });
  });
});
