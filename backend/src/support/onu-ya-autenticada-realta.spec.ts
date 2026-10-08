import { OnuProvisionService } from './onu-provision.service';

/**
 * ONU YA AUTENTICADA: se desautentica y se vuelve a autenticar, no se adopta.
 *
 * Regla del usuario (2026-10-05), a raíz de la ONU 444338306A3C92F4: volvía a
 * bodega desde un cliente retirado, seguía dada de alta a su nombre y la orden
 * de otro cliente no la dejaba montar. «Primero validar que la ONU no esté
 * autenticada; si está autenticada la eliminamos automáticamente y volvemos a
 * autenticar.»
 */
describe('ONU ya autenticada · desautenticar y volver a autenticar', () => {
  const SN = '444338306A3C92F4';

  const armar = (opts: {
    enAutofindAlInicio?: boolean;
    reaparece?: boolean;
    vinculadaA?: { status: string } | null;
    borradoFalla?: boolean;
  } = {}) => {
    const notas: string[] = [];
    const orden: string[] = [];
    const prisma: any = {
      ticket: {
        findUnique: jest.fn().mockResolvedValue({
          id: 't1', code: 510823, type: 'Migracion', subscriberId: 'sub-1',
          planToId: null, planToName: null, planToMegas: null, planAppliedAt: null,
        }),
      },
      subscriber: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === 'sub-viejo'
          ? { abonado: 54128, status: opts.vinculadaA?.status }
          : {
            id: 'sub-1', abonado: 73, branchId: 'br-1', fullName: 'MARICELA PEREZ',
            firstName: 'MARICELA', secondName: null, lastName1: 'PEREZ', lastName2: null, companyName: null,
            branch: { name: 'Yopal', legacyId: 2 },
          })),
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
          { planId: 'plan-50', planName: '50 MEGAS', megas: 50, status: 'ACTIVO', plan: { megas: 50 } },
        ]),
      },
      oltOnu: {
        findFirst: jest.fn().mockResolvedValue(
          opts.vinculadaA ? { subscriberId: 'sub-viejo', clientName: '54128sandra' } : null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      ticketThread: { create: jest.fn(async ({ data }: any) => { notas.push(data.message); return data; }) },
    };
    let lecturasAutofind = 0;
    const olt: any = {
      mode: jest.fn().mockResolvedValue({ live: true }),
      autofind: jest.fn(async () => {
        lecturasAutofind++;
        const visible = (lecturasAutofind === 1 && opts.enAutofindAlInicio)
          || (lecturasAutofind > 1 && opts.reaparece !== false);
        return { ok: true, onus: visible ? [{ sn: SN, fsp: '0/1/0', vendor: 'DD', autofind_time: new Date().toISOString() }] : [] };
      }),
      findBySn: jest.fn().mockResolvedValue({ ok: true, onu: { fsp: '0/1/0', ont_id: 43, description: '54128sandra' } }),
      remove: jest.fn(async (oltId: string, p: any) => {
        orden.push(`remove ${oltId} ${p.frame}/${p.slot}/${p.port}:${p.ont_id}`);
        return opts.borradoFalla ? { ok: false, dryRun: false, error: 'timeout' } : { ok: true, dryRun: false };
      }),
      sugerencia: jest.fn().mockResolvedValue({ sugerencia: { vlan: 100, lineprofile: 'LP', srvprofile: 'SP', gemport: 1, user_vlan: 100 } }),
      provision: jest.fn(async (oltId: string, p: any) => {
        // Mientras siga el alta vieja la OLT rechaza el `ont add`.
        if (opts.enAutofindAlInicio && !orden.some((o) => o.startsWith('remove'))) {
          orden.push(`provision ${oltId} ${p.frame}/${p.slot}/${p.port} (rechazada)`);
          return { ok: false, dryRun: false, codigo: 'SN_YA_EXISTE', error: 'SN already exists', existente: { fsp: '0/1/3', ont_id: 12 } };
        }
        orden.push(`provision ${oltId} ${p.frame}/${p.slot}/${p.port}`);
        return { ok: true, dryRun: false, message: 'ONT agregada', ontId: 5, verificacion: { run_state: 'online', config_state: 'normal', servicePorts: [1] } };
      }),
      adoptar: jest.fn().mockResolvedValue({ ok: true, dryRun: false, adoptada: true, fsp: '0/1/0', ontId: 43 }),
      ontOptical: jest.fn().mockResolvedValue({ ok: true, optical: { rx: '-20.10', olt_rx: '-22.00' } }),
    };
    const planProfiles: any = {
      resolve: jest.fn().mockResolvedValue({ vlan: 100, lineprofile: 'LP', srvprofile: 'SP', gemport: 1, userVlan: 100, trafficIn: 11, trafficOut: 9 }),
      resolveConEtiqueta: jest.fn().mockResolvedValue({ trafficIn: 11, trafficOut: 9 }),
    };
    const reserva: any = { conciliarTrasAutenticar: jest.fn().mockResolvedValue({ liberados: [], devuelto: null }) };
    const svc = new OnuProvisionService(prisma, olt, planProfiles, reserva);
    svc.esperaAutofindMs = 0;
    svc.intentosAutofind = 3;
    return { svc, olt, orden, notas };
  };

  it('no se anuncia porque ya está dada de alta: la borra, espera a que reaparezca y la autentica', async () => {
    const { svc, olt, orden } = armar();
    const r: any = await svc.autenticar('t1', { sn: SN });
    expect(r.ok).toBe(true);
    expect(orden).toEqual(['remove olt-1 0/1/0:43', 'provision olt-1 0/1/0']);
    expect(r.liberacion).toMatchObject({ borrado: true, anterior: '0/1/0:43' });
    expect(olt.adoptar).not.toHaveBeenCalled();
  });

  it('se anuncia en un puerto pero sigue dada de alta en otro: borra la vieja y reintenta', async () => {
    const { svc, olt, orden } = armar({ enAutofindAlInicio: true });
    const r: any = await svc.autenticar('t1', { sn: SN });
    expect(r.ok).toBe(true);
    expect(orden).toEqual([
      'provision olt-1 0/1/0 (rechazada)', 'remove olt-1 0/1/3:12', 'provision olt-1 0/1/0',
    ]);
    expect(olt.adoptar).not.toHaveBeenCalled();
  });

  it('lo deja anotado en la orden con el nombre que tenía', async () => {
    const { svc, notas } = armar();
    await svc.autenticar('t1', { sn: SN });
    const nota = notas.find((n) => n.startsWith('ONU YA AUTENTICADA'));
    expect(nota).toMatch(/«54128sandra»/);
    expect(nota).toMatch(/YOPAL 0\/1\/0:43 — borrada/);
  });

  it('si no vuelve a anunciarse, no autentica y lo dice', async () => {
    const { svc, olt } = armar({ reaparece: false });
    const r: any = await svc.autenticar('t1', { sn: SN });
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('NO_REAPARECE');
    expect(r.error).toMatch(/ya se desautenticó/);
    expect(olt.provision).not.toHaveBeenCalled();
  });

  it('si la OLT no deja borrarla, se adopta como antes para no dejar al técnico sin salida', async () => {
    const { svc, olt } = armar({ borradoFalla: true });
    await svc.autenticar('t1', { sn: SN });
    expect(olt.provision).not.toHaveBeenCalled();
    expect(olt.adoptar).toHaveBeenCalled();
  });

  it('vinculada a un abonado RETIRADO: no frena, la libera', async () => {
    const { svc, olt } = armar({ vinculadaA: { status: 'RETIRADO' } });
    const r: any = await svc.autenticar('t1', { sn: SN });
    expect(r.ok).toBe(true);
    expect(olt.remove).toHaveBeenCalled();
  });

  it('vinculada a un abonado que sigue con servicio: no se le quita', async () => {
    const { svc, olt } = armar({ vinculadaA: { status: 'ACTIVO' } });
    await expect(svc.autenticar('t1', { sn: SN })).rejects.toThrow(/sigue con servicio/);
    expect(olt.remove).not.toHaveBeenCalled();
  });
});
