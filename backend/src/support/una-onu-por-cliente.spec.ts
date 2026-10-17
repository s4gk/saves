import { OnuProvisionService, lineaDePerfiles, snsAutenticadosEnNotas } from './onu-provision.service';

/**
 * UNA ONU por cliente (17-oct-2026, orden 512203, abonado 2369). El técnico
 * autenticó una ONU genérica (47504F4E00B89D48, MONTERREY 0/0/0:0), no navegó,
 * instaló la 900060 (485754433058BEAD) y la autenticó también: la primera quedó
 * dada de alta y a nombre de la clienta. Las notas son las reales de esa orden.
 */
const NOTA_GENERICA = 'ONU autenticada desde la orden · SN 47504F4E00B89D48 · puerto 0/0/0 · ONT-ID 0\nPlan: 100 MEGAS --';
const NOTA_900060 = 'ONU autenticada desde la orden · SN 485754433058BEAD · puerto 0/1/5 · ONT-ID 15\nPlan: 100 MEGAS --';

const GENERICA = { id: 'o1', oltId: 'mty', sn: '47504F4E00B89D48', frame: 0, slot: 0, port: 0, ontId: 0, runState: 'online', olt: { name: 'MONTERREY' } };
const VIEJA = { id: 'o2', oltId: 'mty', sn: '44433830AAAA0001', frame: 0, slot: 2, port: 7, ontId: 4, runState: 'offline', olt: { name: 'MONTERREY' } };

function montar(otras: any[], notas: string[], equipos: any[] = []) {
  const hilo: string[] = [];
  const prisma: any = {
    oltOnu: { findMany: jest.fn(async () => otras), update: jest.fn(async () => ({})) },
    ticketThread: {
      findMany: jest.fn(async () => notas.map((message) => ({ message }))),
      create: jest.fn(async (x: any) => { hilo.push(x.data.message); return x.data; }),
    },
    equipment: { findMany: jest.fn(async () => equipos) },
  };
  const olt: any = {
    // La posición se relee de la OLT: aquí la genérica sigue en 0/0/0:0.
    findBySn: jest.fn(async () => ({ ok: true, onu: { fsp: '0/0/0', ont_id: '0' } })),
    remove: jest.fn(async () => ({ ok: true, dryRun: false })),
  };
  const svc = new OnuProvisionService(prisma, olt, {} as any, {} as any, {} as any);
  return { svc: svc as any, prisma, olt, hilo };
}

const X = { t: { id: 't', code: 512203 }, sub: { id: 'sub-2369' }, sn: '485754433058BEAD' };

describe('snsAutenticadosEnNotas', () => {
  it('saca los SN de las notas de alta de la orden', () => {
    expect([...snsAutenticadosEnNotas([NOTA_GENERICA, NOTA_900060, 'Prueba de señal · SN 1234'])])
      .toEqual(['47504F4E00B89D48', '485754433058BEAD']);
  });
});

describe('retirarIntentosAnteriores', () => {
  it('quita de la OLT la ONU que ESTA orden autenticó antes (lo de la 2369)', async () => {
    const { svc, olt, hilo } = montar([GENERICA], [NOTA_GENERICA, NOTA_900060]);
    const r = await svc.retirarIntentosAnteriores(X);
    expect(olt.findBySn).toHaveBeenCalledWith('mty', '47504F4E00B89D48');
    expect(olt.remove).toHaveBeenCalledWith('mty', { frame: 0, slot: 0, port: 0, ont_id: 0, sn: '47504F4E00B89D48' }, undefined);
    expect(r.retiradas).toEqual(['47504F4E00B89D48 (MONTERREY 0/0/0:0)']);
    expect(hilo[0]).toContain('UNA ONU POR CLIENTE');
    expect(hilo[0]).toContain('Queda la 485754433058BEAD');
  });

  it('una ONU de ANTES de la orden no se toca: solo se avisa', async () => {
    const { svc, olt, hilo } = montar([VIEJA], [NOTA_900060]);
    const r = await svc.retirarIntentosAnteriores(X);
    expect(olt.remove).not.toHaveBeenCalled();
    expect(r.retiradas).toEqual([]);
    expect(hilo[0]).toContain('OTRAS ONUs DEL CLIENTE');
    expect(hilo[0]).toContain('44433830AAAA0001');
  });

  it('si el intento anterior ya no está en la OLT, solo se suelta el vínculo local', async () => {
    const { svc, olt, prisma } = montar([GENERICA], [NOTA_GENERICA]);
    olt.findBySn.mockResolvedValueOnce({ ok: false });
    const r = await svc.retirarIntentosAnteriores(X);
    expect(olt.remove).not.toHaveBeenCalled();
    expect(prisma.oltOnu.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { subscriberId: null, clientName: null } });
    expect(r.retiradas).toEqual([]);
  });

  it('avisa si el equipo del intento retirado sigue a nombre del cliente', async () => {
    const { svc, hilo } = montar([GENERICA], [NOTA_GENERICA], [{ code: 900061 }]);
    await svc.retirarIntentosAnteriores(X);
    expect(hilo[0]).toContain('el equipo 900061 de la ONU retirada sigue a nombre del abonado');
  });

  it('sin otras ONUs no hace nada ni escribe en la orden', async () => {
    const { svc, olt, hilo } = montar([], []);
    await svc.retirarIntentosAnteriores(X);
    expect(olt.findBySn).not.toHaveBeenCalled();
    expect(hilo).toEqual([]);
  });

  it('nunca tumba el alta: un error queda como aviso', async () => {
    const { svc, prisma } = montar([GENERICA], []);
    prisma.oltOnu.findMany.mockRejectedValueOnce(new Error('BD caída'));
    const r = await svc.retirarIntentosAnteriores(X);
    expect(r.avisos[0]).toContain('BD caída');
  });
});

describe('lineaDePerfiles (nota del alta)', () => {
  const params = { lineprofile: '13', srvprofile: '21' };
  it('dice de qué vecina de la misma marca salieron', () => {
    expect(lineaDePerfiles({ referencia: { fsp: '0/1/5', ont_id: '9', origen: 'PUERTO' } }, params, {}))
      .toBe('Perfiles: line-profile 13 / srv-profile 21, copiados de la ONU de la misma marca en 0/1/5:9, que funciona.');
  });
  it('avisa cuando no hubo ninguna de su marca', () => {
    expect(lineaDePerfiles({ referenciaMotivo: 'no hay ninguna ONU HWTC funcionando…' }, params, {}))
      .toContain('OJO: no hay ninguna ONU HWTC');
  });
  it('los perfiles del plan mandan y se dice', () => {
    expect(lineaDePerfiles({ referencia: { fsp: '0/1/5', ont_id: '9' } }, params, { lineprofile: 13 }))
      .toContain('configurados en el plan');
  });
});
