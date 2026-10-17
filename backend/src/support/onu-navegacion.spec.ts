import { OnuProvisionService } from './onu-provision.service';

/**
 * "¿Navega?" 60 s después de autenticar (2026-09-23). Con la 590 de Villanueva
 * la ONU quedó en línea y la orden se cerró en verde sin que nadie supiera que la
 * clienta no tenía internet. La comprobación mira la sesión PPPoE y, si no la
 * hay, dice qué tramo de la VLAN falta; queda anotada en la orden.
 */
function montar(live: any, chequeo: any = { vlan: 590, falta: [] }, intentos?: any) {
  const notas: string[] = [];
  const prisma: any = { ticketThread: { create: async (x: any) => { notas.push(x.data.message); return x.data; } } };
  const mikrotik: any = { liveStatus: async () => live, ...(intentos ? { intentosPppoe: jest.fn(async () => intentos) } : {}) };
  const vlanEquipos: any = { chequeoDePuerto: jest.fn(async () => chequeo) };
  const svc = new OnuProvisionService(prisma, {} as any, {} as any, mikrotik, {} as any, undefined, vlanEquipos);
  const x = {
    t: { id: 't1', code: 506510 }, sub: { id: 's1', pppUsername: 'carolina.4064' }, oltId: 'olt-v',
    frame: 0, slot: 2, port: 13, vlan: 590, verificacion: { run_state: 'online' },
  };
  return { svc: svc as any, notas, vlanEquipos, x };
}

describe('comprobación de navegación tras autenticar', () => {
  it('con sesión PPPoE: "Navegando", en la orden', async () => {
    const { svc, notas, vlanEquipos, x } = montar({ ok: true, dryRun: false, mikrotik: { name: 'Ip_Villanueva_GPON' }, live: { sessionActive: true, ip: '10.20.9.188' } });
    await svc.comprobarNavegacion(x);
    expect(svc.navegacionDeOrden('t1')).toMatchObject({ estado: 'NAVEGANDO' });
    expect(notas[0]).toBe('Comprobación tras autenticar (0/2/13): Navegando: sesión PPPoE activa en Ip_Villanueva_GPON (IP 10.20.9.188).');
    expect(vlanEquipos.chequeoDePuerto).not.toHaveBeenCalled();
  });

  it('ONU en línea sin PPPoE y la VLAN sin uplink (lo de la 590): lo dice con el tramo que falta', async () => {
    const { svc, notas, x } = montar(
      { ok: true, dryRun: false, live: { sessionActive: false, secretExists: true } },
      { vlan: 590, falta: ['la VLAN 590 no sale por el uplink de la OLT'] },
    );
    await svc.comprobarNavegacion(x);
    expect(svc.navegacionDeOrden('t1').estado).toBe('SIN_PPPOE');
    expect(notas[0]).toContain('La ONU está en línea pero NO hay sesión PPPoE a los 60 s — revisar VLAN/uplink/credenciales.');
    expect(notas[0]).toContain('VLAN 590 de 0/2/13: la VLAN 590 no sale por el uplink de la OLT.');
  });

  it('sin PPPoE con la VLAN completa: apunta a las credenciales / al secret', async () => {
    const { svc, notas, x } = montar({ ok: true, dryRun: false, live: { sessionActive: false, secretExists: false } });
    await svc.comprobarNavegacion(x);
    expect(notas[0]).toContain('La VLAN 590 está completa en OLT y Mikrotik: revisar usuario/clave PPPoE');
    expect(notas[0]).toContain('el secret NO existe en el router');
  });

  // 17-oct (MONTERREY 0/1/5:15, abonado 2369): la nota decía «revisar usuario/clave»
  // y la clave estaba bien; la ONU estaba en config failed y no salía ni un intento.
  it('VLAN completa, config failed y CERO intentos en el log: dice que NO es la clave', async () => {
    const { svc, notas, x } = montar(
      { ok: true, dryRun: false, live: { sessionActive: false, secretExists: true } }, undefined,
      { leido: true, rechazos: 0, ingresos: 0, ultimoRechazo: null },
    );
    await svc.comprobarNavegacion({ ...x, verificacion: { run_state: 'online', config_state: 'failed' } });
    expect(notas[0]).toContain('quedó en «config failed»');
    expect(notas[0]).toContain('NO es la clave');
    expect(notas[0]).not.toContain('revisar usuario/clave');
  });

  it('VLAN completa, config normal y cero intentos: el PPPoE no sale de la casa (WAN de la ONU)', async () => {
    const { svc, notas, x } = montar(
      { ok: true, dryRun: false, live: { sessionActive: false, secretExists: true } }, undefined,
      { leido: true, rechazos: 0, ingresos: 0, ultimoRechazo: null },
    );
    await svc.comprobarNavegacion({ ...x, verificacion: { run_state: 'online', config_state: 'normal' } });
    expect(notas[0]).toContain('no ha recibido ni un intento PPPoE del usuario «carolina.4064»');
    expect(notas[0]).toContain('modo PPPoE, VLAN 590');
  });

  it('con «authentication failed» en el log: la clave está mal, y lo dice', async () => {
    const { svc, notas, x } = montar(
      { ok: true, dryRun: false, live: { sessionActive: false, secretExists: true } }, undefined,
      { leido: true, rechazos: 3, ingresos: 0, ultimoRechazo: '2026-10-17 10:01:12' },
    );
    await svc.comprobarNavegacion({ ...x, verificacion: { run_state: 'online', config_state: 'failed' } });
    expect(notas[0]).toContain('RECHAZA la clave: 3 intento(s)');
    expect(notas[0]).toContain('10:01:12');
  });

  it('si no se puede leer el log, queda el aviso de siempre', async () => {
    const { svc, notas, x } = montar(
      { ok: true, dryRun: false, live: { sessionActive: false, secretExists: true } }, undefined,
      { leido: false, rechazos: 0, ingresos: 0, ultimoRechazo: null, error: 'timeout' },
    );
    await svc.comprobarNavegacion(x);
    expect(notas[0]).toContain('revisar usuario/clave PPPoE en el equipo del cliente.');
  });

  it('Mikrotik en dry-run: no se da por buena ni por mala', async () => {
    const { svc, x } = montar({ ok: true, dryRun: true });
    await svc.comprobarNavegacion(x);
    expect(svc.navegacionDeOrden('t1')).toMatchObject({ estado: 'SIN_REVISAR' });
  });

  it('se programa a los 60 s y responde enseguida PENDIENTE', () => {
    jest.useFakeTimers();
    try {
      const { svc, x } = montar({ ok: true, dryRun: false, live: { sessionActive: true } });
      const spy = jest.spyOn(svc, 'comprobarNavegacion').mockResolvedValue(undefined);
      expect(svc.programarComprobacionDeNavegacion(x)).toEqual({ estado: 'PENDIENTE', enSegundos: 60 });
      expect(svc.navegacionDeOrden('t1').estado).toBe('PENDIENTE');
      jest.advanceTimersByTime(59_000);
      expect(spy).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1_000);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
