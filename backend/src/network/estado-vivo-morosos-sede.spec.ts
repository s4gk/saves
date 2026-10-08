import { MikrotikService } from './mikrotik.service';

/**
 * `liveStatus` tiene que ver el corte donde la reconexión lo quitaría.
 *
 * El corte marca la IP en MOROSOS en TODOS los routers de la sede y `reconnect()` la saca
 * de todos, buscándola por comment o por IP. `liveStatus` sólo miraba el principal y sólo
 * por comment: 1450 y 50429 (Yopal, sep-2026) seguían en MOROSOS en Yopal_Eoc, el pago en
 * línea preguntó, le dijeron "al aire" y no reconectó ni dejó orden.
 */
const listas: Record<string, Array<{ comment?: string; address?: string; dynamic?: string }>> = {};

jest.mock('../common/secret-box', () => ({ decryptSecret: (x: string) => x, encryptSecret: (x: string) => x }));
jest.mock('./routeros/routeros-client', () => {
  class RouterosError extends Error {}
  class RouterosClient {
    host = '';
    async connect(ip: string, port: number) {
      if (ip === 'caido') throw new Error('timeout');
      this.host = `${ip}:${port}`;
    }
    async comm(cmd: string, q: Record<string, string>) {
      if (cmd === '/ppp/secret/getall') return [{ '.id': '*1', name: 'X', disabled: 'false', 'remote-address': '10.100.3.49' }];
      if (cmd === '/ppp/active/getall') return [{ '.id': '*9', address: '10.100.3.49' }];
      if (cmd === '/ip/firewall/address-list/print') {
        if (q['?list'] !== 'MOROSOS') return q['?list'] === 'ACTIVOS' ? [{}] : [];
        return (listas[this.host] || []).filter((e) =>
          (q['?comment'] === undefined || e.comment === q['?comment']) &&
          (q['?address'] === undefined || e.address === q['?address']));
      }
      return [];
    }
    close() {}
  }
  return { RouterosClient, RouterosError };
});

describe('MikrotikService.liveStatus · MOROSOS en la sede', () => {
  const armar = (routers: any[]) => {
    const prisma: any = {
      appSetting: { findUnique: jest.fn().mockResolvedValue({ value: 'true' }) },
      subscriber: {
        findUnique: jest.fn().mockResolvedValue({
          id: 's1', legacyId: 14869, pppUsername: 'X', ipRemote: '10.100.3.49',
          installTech: 'GPON', status: 'ACTIVO', branch: { legacyId: 2 }, services: [],
        }),
      },
      mikrotik: {
        findMany: jest.fn().mockResolvedValue(routers),
        findUnique: jest.fn(({ where }: any) => Promise.resolve(routers.find((r) => r.id === where.id))),
      },
    };
    return new MikrotikService(prisma as any, {} as any, {} as any);
  };
  const YOPAL = { id: 'r1', name: 'Yopal', ip: 'a', port: '5051', tech: 'GPON', sedeLegacy: 2, isDefault: true, username: 'u', password: 'p' };
  const EOC = { id: 'r2', name: 'Yopal_Eoc', ip: 'b', port: '5070', tech: 'EOC', sedeLegacy: 2, isDefault: false, username: 'u', password: 'p' };

  beforeEach(() => { for (const k of Object.keys(listas)) delete listas[k]; });

  it('limpio en el principal pero en MOROSOS en otro router de la sede → cortado', async () => {
    listas['b:5070'] = [{ comment: 'activo_14869', address: '10.100.3.49' }];
    const r = await armar([YOPAL, EOC]).liveStatus('s1');
    expect(r.live?.inMorosos).toBe(true);
    expect(r.live?.morososEn).toEqual(['Yopal_Eoc']);
  });

  it('en MOROSOS por IP con otro comment (el que dejó un corte ajeno) → cortado', async () => {
    listas['a:5051'] = [{ comment: 'otro_comment', address: '10.100.3.49' }];
    const r = await armar([YOPAL, EOC]).liveStatus('s1');
    expect(r.live?.inMorosos).toBe(true);
    expect(r.live?.morososEn).toEqual(['Yopal']);
  });

  it('limpio en todos → al aire; un router que no contesta no cuenta como corte', async () => {
    const r = await armar([YOPAL, { ...EOC, ip: 'caido' }]).liveStatus('s1');
    expect(r.ok).toBe(true);
    expect(r.live?.inMorosos).toBe(false);
    expect(r.live?.morososEn).toEqual([]);
  });
});
