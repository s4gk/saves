import { OnuProvisionService } from './onu-provision.service';
import { evaluarSenalRx } from './senal-optica-aceptacion';

/**
 * PRUEBA DE SEÑAL AL AUTENTICAR (protocolo técnico VESTEL 4.5, pedido del usuario
 * 2026-09-25): la orden solo autentica la ONU si la potencia que recibe está en el
 * rango Óptimo (-15 a -24 dBm). Marginal, Crítico y "no se pudo medir" se rechazan
 * y el alta se deshace; el superadministrador puede forzarlo con motivo.
 */
describe('criterio de señal RX · protocolo 4.5', () => {
  it.each([
    [-15, 'OPTIMO'], [-19.8, 'OPTIMO'], [-24, 'OPTIMO'],
    [-24.5, 'MARGINAL'], [-26, 'MARGINAL'], [-27.5, 'MARGINAL'], [-28, 'MARGINAL'],
    [-28.01, 'CRITICO'], [-31, 'CRITICO'],
    [-10, 'MARGINAL'], [null, 'SIN_LECTURA'],
  ])('%p dBm → %s', (rx, nivel) => {
    const e = evaluarSenalRx(rx as number | null);
    expect(e.nivel).toBe(nivel);
    expect(e.aprobada).toBe(nivel === 'OPTIMO');
  });
});

describe('autenticar desde la orden · prueba de señal', () => {
  const SN = '48575443A1B2C3D4';
  const SUPER: any = { id: 'u1', name: 'Admin', permissions: ['system.admin'] };
  const TECNICO: any = { id: 'u2', name: 'Técnico', permissions: ['network.olt.manage'], sedes: [2] };

  const armar = (opts: { rx?: string | null; yaExiste?: boolean } = {}) => {
    const notas: string[] = [];
    const prisma: any = {
      ticket: {
        findUnique: jest.fn().mockResolvedValue({
          id: 't1', code: 900, type: 'Traslado interno De Equipos Red en cliente final', subscriberId: 'sub-1',
          planToId: null, planToName: null, planToMegas: null, planAppliedAt: null,
        }),
      },
      subscriber: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sub-1', abonado: 57439, branchId: 'br-1', fullName: 'ANA GOMEZ',
          firstName: 'ANA', secondName: null, lastName1: 'GOMEZ', lastName2: null, companyName: null,
          branch: { name: 'Yopal', legacyId: 2 },
        }),
      },
      olt: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'olt-1', name: 'YOPAL', ip: '10.0.0.1',
          defaultLineProfile: null, defaultSrvProfile: null, defaultVlan: null, defaultGemport: null, defaultUserVlan: null,
        }),
        findMany: jest.fn().mockResolvedValue([{
          id: 'olt-1', name: 'YOPAL', ip: '10.0.0.1',
          defaultLineProfile: null, defaultSrvProfile: null, defaultVlan: null, defaultGemport: null, defaultUserVlan: null,
        }]),
      },
      subscriberService: {
        findMany: jest.fn().mockResolvedValue([
          { planId: 'plan-100', planName: '100 Megas F-26', megas: 100, status: 'ACTIVO', plan: { megas: 100 } },
        ]),
      },
      oltOnu: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      ticketThread: { create: jest.fn(async ({ data }: any) => { notas.push(data.message); return data; }) },
    };
    const rx = opts.rx === undefined ? '-20.10' : opts.rx;
    const olt: any = {
      mode: jest.fn().mockResolvedValue({ live: true }),
      autofind: jest.fn().mockResolvedValue({ ok: true, onus: [{ sn: SN, fsp: '0/2/7', vendor: 'HWTC' }] }),
      findBySn: jest.fn().mockResolvedValue({ ok: true, onu: { fsp: '0/1/3', ont_id: 12, run_state: 'online' } }),
      remove: jest.fn().mockResolvedValue({ ok: true, dryRun: false, message: 'ONT borrada' }),
      sugerencia: jest.fn().mockResolvedValue({ sugerencia: { vlan: 100, lineprofile: 'LP', srvprofile: 'SP', gemport: 1, user_vlan: 100 } }),
      provision: jest.fn().mockResolvedValue(opts.yaExiste
        ? { ok: false, dryRun: false, codigo: 'SN_YA_EXISTE', error: 'SN already exists' }
        : { ok: true, dryRun: false, message: 'ONT agregada', ontId: 4, verificacion: { run_state: 'online', config_state: 'normal', servicePorts: [1] } }),
      adoptar: jest.fn().mockResolvedValue({ ok: true, dryRun: false, adoptada: true, fsp: '0/1/3', ontId: 12 }),
      ontOptical: jest.fn().mockResolvedValue(rx === null
        ? { ok: false, error: 'Failure: The ONT is not online', optical: {} }
        : { ok: true, optical: { rx, olt_rx: '-23.00' } }),
    };
    const planProfiles: any = {
      resolve: jest.fn().mockResolvedValue({ vlan: 100, lineprofile: 'LP', srvprofile: 'SP', gemport: 1, userVlan: 100, trafficIn: 11, trafficOut: 9 }),
      resolveConEtiqueta: jest.fn().mockResolvedValue({ trafficIn: 11, trafficOut: 9 }),
    };
    const reserva: any = { conciliarTrasAutenticar: jest.fn().mockResolvedValue({ liberados: [], devuelto: null }) };
    const svc = new OnuProvisionService(prisma, olt, planProfiles, reserva);
    svc.esperaSenalMs = 0;
    return { svc, olt, notas, reserva };
  };

  it('señal Óptima: autentica y deja la medición en la orden', async () => {
    const { svc, olt, notas } = armar({ rx: '-20.10' });
    const r: any = await svc.autenticar('t1', { sn: SN }, SUPER);
    expect(r.ok).toBe(true);
    expect(r.senal).toMatchObject({ nivel: 'OPTIMO', rx: -20.1, oltRx: -23 });
    expect(olt.ontOptical).toHaveBeenCalledWith('olt-1', 0, 2, 7, 4);
    expect(olt.remove).not.toHaveBeenCalled();
    expect(notas.some((n) => n.startsWith('Prueba de señal') && n.includes('-20,10 dBm'))).toBe(true);
  });

  it('señal Marginal: no autentica, deshace el alta y dice qué revisar', async () => {
    const { svc, olt, notas, reserva } = armar({ rx: '-26.40' });
    const r: any = await svc.autenticar('t1', { sn: SN }, SUPER);
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('SENAL_RECHAZADA');
    expect(r.senal.nivel).toBe('MARGINAL');
    expect(r.altaDeshecha).toBe(true);
    expect(r.error).toMatch(/limpieza, macrocurvaturas/);
    expect(olt.remove).toHaveBeenCalledWith('olt-1', { frame: 0, slot: 2, port: 7, ont_id: 4, sn: SN }, SUPER);
    // No se registra equipo ni se cuadra la reserva: la orden no quedó autenticada.
    expect(reserva.conciliarTrasAutenticar).not.toHaveBeenCalled();
    expect(notas.some((n) => n.startsWith('ONU NO AUTENTICADA por señal'))).toBe(true);
  });

  it('señal Crítica: rechazada con la acción del protocolo', async () => {
    const { svc } = armar({ rx: '-29.50' });
    const r: any = await svc.autenticar('t1', { sn: SN }, SUPER);
    expect(r.ok).toBe(false);
    expect(r.senal.nivel).toBe('CRITICO');
    expect(r.error).toMatch(/Rehacer conector/);
  });

  it('sin lectura: reintenta y, si no la consigue, tampoco autentica', async () => {
    const { svc, olt } = armar({ rx: null });
    const r: any = await svc.autenticar('t1', { sn: SN }, SUPER);
    expect(r.ok).toBe(false);
    expect(r.senal.nivel).toBe('SIN_LECTURA');
    expect(olt.ontOptical).toHaveBeenCalledTimes(svc.intentosSenal);
    expect(olt.remove).toHaveBeenCalled();
  });

  it('forzar: solo el superadministrador, y ANTES de tocar la OLT', async () => {
    const { svc, olt } = armar({ rx: '-26.40' });
    await expect(svc.autenticar('t1', { sn: SN, forzarSenal: 'cliente acepta así hasta cambio de drop' }, TECNICO))
      .rejects.toThrow(/superadministrador/);
    expect(olt.provision).not.toHaveBeenCalled();
  });

  it('forzar sin motivo que diga algo: se rechaza', async () => {
    const { svc } = armar({ rx: '-26.40' });
    await expect(svc.autenticar('t1', { sn: SN, forzarSenal: 'ok' }, SUPER)).rejects.toThrow(/10 caracteres/);
  });

  it('superadministrador con motivo: autentica y lo deja anotado', async () => {
    const { svc, olt, notas } = armar({ rx: '-26.40' });
    const r: any = await svc.autenticar('t1', { sn: SN, forzarSenal: 'cliente acepta así hasta cambio de drop' }, SUPER);
    expect(r.ok).toBe(true);
    expect(r.senal.forzada).toEqual({ por: 'Admin', motivo: 'cliente acepta así hasta cambio de drop' });
    expect(olt.remove).not.toHaveBeenCalled();
    expect(notas.some((n) => n.startsWith('SEÑAL FORZADA') && n.includes('cambio de drop'))).toBe(true);
  });

  it('ONU ya dada de alta (adoptar): mide antes y, si no pasa, no toca la OLT', async () => {
    const { svc, olt } = armar({ rx: '-27.80', yaExiste: true });
    const r: any = await svc.autenticar('t1', { sn: SN }, SUPER);
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('SENAL_RECHAZADA');
    expect(olt.ontOptical).toHaveBeenCalledWith('olt-1', 0, 1, 3, 12);
    expect(olt.adoptar).not.toHaveBeenCalled();
    expect(olt.remove).not.toHaveBeenCalled();
  });

  it('ONU ya dada de alta con señal Óptima: se adopta', async () => {
    const { svc, olt } = armar({ rx: '-18.00', yaExiste: true });
    const r: any = await svc.autenticar('t1', { sn: SN }, SUPER);
    expect(r.ok).toBe(true);
    expect(r.senal.nivel).toBe('OPTIMO');
    expect(olt.adoptar).toHaveBeenCalled();
  });
});
