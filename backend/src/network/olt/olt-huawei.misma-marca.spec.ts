import { OltHuawei } from './olt-huawei.driver';
import { marcaDeSn, mismaMarca, perfilesValenParaVlan, vlansDelDetalleOnt } from './olt-referencia-marca';

/**
 * Perfiles de la MISMA MARCA (17-oct-2026). En MONTERREY 0/1/5 —lleno de ZTE y
 * genéricas— una Huawei (equipo 900060, abonado 2369) recibió por mayoría lp 150
 * "vlan150" + sp 50 "catv": `config failed`, en línea y sin un solo intento PPPoE
 * en el Mikrotik. La Huawei vecina que navega (ONT 9) usa lp 13 + sp 21; con ese
 * par quedó `normal` y conectó en un minuto. Las dos salidas son REALES de ese día.
 */

/** `display ont info 0 1 5 9` — Huawei 48575443DC48F20A, navega (abonado 57218). */
const ONT9_HUAWEI_NORMAL = "  -----------------------------------------------------------------------------\r\n  F/S/P                   : 0/1/5\r\n  ONT-ID                  : 9\r\n  Control flag            : active\r\n  Run state               : online\r\n  Config state            : normal\r\n  Match state             : match\r\n  DBA type                : SR\r\n  ONT distance(m)         : 2224\r\n  ONT battery state       : holding state\r\n  Memory occupation       : -\r\n  CPU occupation          : -\r\n  Temperature             : -\r\n  Authentic type          : SN-auth\r\n  SN                      : 48575443DC48F20A (HWTC-DC48F20A)\r\n  Management mode         : OMCI\r\n  Software work mode      : normal\r\n  Isolation state         : normal\r\n  ONT IP 0 address/mask   : -\r\n  Description             : 57218ARIOLFO_zone_PRINCIPAL_auth\r\n                            d_20260327\r\n  Last down cause         : dying-gasp\r\n  Last up time            : 2026-10-16 13:31:13-05:00\r\n---- More ( Press 'Q' to break ) ----\u001b[37D                                     \u001b[37D  Last down time          : 2026-10-16 13:29:37-05:00\r\n  Last dying gasp time    : 2026-10-16 13:29:37-05:00\r\n  ONT online duration     : 0 day(s), 20 hour(s), 52 minute(s), 30 second(s) \r\n  Type C support          : Not support\r\n  Interoperability-mode   : ITU-T\r\n  -----------------------------------------------------------------------------\r\n  VoIP configure method   : Default\r\n  -----------------------------------------------------------------------------\r\n  Line profile ID      : 13\r\n  Line profile name    : Generic_1_V150\r\n  -----------------------------------------------------------------------------\r\n  FEC upstream switch :Disable\r\n  OMCC encrypt switch :Off\r\n  Qos mode            :PQ\r\n  Mapping mode        :VLAN\r\n  TR069 management    :Disable\r\n  TR069 IP index      :0\r\n  -----------------------------------------------------------------------------\r\n  Notes: * indicates Discrete TCONT(TCONT Unbound)\r\n  -----------------------------------------------------------------------------\r\n  <T-CONT   0>          DBA Profile-ID:2\r\n  <T-CONT   1>          DBA Profile-ID:10\r\n   <Gem Index 1>\r\n   --------------------------------------------------------------------\r\n---- More ( Press 'Q' to break ) ----\u001b[37D                                     \u001b[37D   |Serv-Type:ETH |Encrypt:off |Cascade:off |GEM-CAR:-            |\r\n   |Upstream-priority-queue:0  |Downstream-priority-queue:-       |\r\n   --------------------------------------------------------------------\r\n    Mapping VLAN  Priority Port    Port  Bundle  Flow  Transparent\r\n    index                  type    ID    ID      CAR   \r\n   --------------------------------------------------------------------\r\n    1       150   -        -       -     -       -     -          \r\n   --------------------------------------------------------------------\r\n  <T-CONT   2>          DBA Profile-ID:10\r\n   <Gem Index 2>\r\n   --------------------------------------------------------------------\r\n   |Serv-Type:ETH |Encrypt:off |Cascade:off |GEM-CAR:-            |\r\n   |Upstream-priority-queue:0  |Downstream-priority-queue:-       |\r\n   --------------------------------------------------------------------\r\n  -----------------------------------------------------------------------------\r\n  Notes: Run the display traffic table ip command to query \r\n         traffic table configuration\r\n  -----------------------------------------------------------------------------\r\n  Service profile ID   : 21\r\n  Service profile name : Generic_1_V150\r\n  -----------------------------------------------------------------------------\r\n  Port-type     Port-number\r\n  -----------------------------------------------------------------------------\r\n  POTS          adaptive\r\n---- More ( Press 'Q' to break ) ----\u001b[37D                                     \u001b[37D  ETH           adaptive\r\n  VDSL          0\r\n  TDM           0\r\n  MOCA          0\r\n  CATV          adaptive\r\n  -----------------------------------------------------------------------------\r\n  TDM port type                     : E1\r\n  TDM service type                  : TDMoGem\r\n  MAC learning function switch      : Enable\r\n  ONT transparent function switch   : Disable\r\n  Ring check switch                 : Disable\r\n  Ring port auto-shutdown           : Enable\r\n  Ring detect frequency             : 8 (pps)\r\n  Ring resume interval              : 300 (s)\r\n  Multicast forward mode            : Unconcern\r\n  Multicast forward VLAN            : -\r\n  Multicast mode                    : Unconcern\r\n  Upstream IGMP packet forward mode : Unconcern\r\n  Upstream IGMP packet forward VLAN : -\r\n  Upstream IGMP packet priority     : -\r\n  Native VLAN option                : Concern\r\n  Upstream PQ color policy          : -\r\n  Downstream PQ color policy        : -\r\n  -----------------------------------------------------------------------------\r\n---- More ( Press 'Q' to break ) ----\u001b[37D                                     \u001b[37D  Port-type Port-ID QinQmode  PriorityPolicy Inbound     Outbound\r\n  -----------------------------------------------------------------------------\r\n  ETH       1       unconcern unconcern      unconcern   unconcern\r\n  ETH       2       unconcern unconcern      unconcern   unconcern\r\n  ETH       3       unconcern unconcern      unconcern   unconcern\r\n  ETH       4       unconcern unconcern      unconcern   unconcern\r\n  ETH       5       unconcern unconcern      unconcern   unconcern\r\n  ETH       6       unconcern unconcern      unconcern   unconcern\r\n  ETH       7       unconcern unconcern      unconcern   unconcern\r\n  ETH       8       unconcern unconcern      unconcern   unconcern\r\n  -----------------------------------------------------------------------------\r\n  Notes: * indicates the discretely configured traffic profile,\r\n         run the display traffic table ip command to query\r\n         traffic table configuration.\r\n  -----------------------------------------------------------------------------\r\n  Port-type Port-ID  DownstreamMode  MismatchPolicy\r\n  -----------------------------------------------------------------------------\r\n  ETH             1  operation       discard       \r\n  ETH             2  operation       discard       \r\n  ETH             3  operation       discard       \r\n  ETH             4  operation       discard       \r\n  ETH             5  operation       discard       \r\n  ETH             6  operation       discard       \r\n  ETH             7  operation       discard       \r\n---- More ( Press 'Q' to break ) ----\u001b[37D                                     \u001b[37D  ETH             8  operation       discard       \r\n  -----------------------------------------------------------------------------\r\n  Port-type Port-ID Dscp-mapping-table-index\r\n  -----------------------------------------------------------------------------\r\n  ETH       1       0        \r\n  ETH       2       0        \r\n  ETH       3       0        \r\n  ETH       4       0        \r\n  ETH       5       0        \r\n  ETH       6       0        \r\n  ETH       7       0        \r\n  ETH       8       0        \r\n  IPHOST    1       0        \r\n  -----------------------------------------------------------------------------\r\n  Port   Port Service-type Index S-VLAN S-PRI C-VLAN C-PRI ENCAP      S-PRI\r\n  type   ID                                                           POLICY\r\n  -----------------------------------------------------------------------------\r\n  ETH    1    Translation  1     150    -     150    -     -          -     \r\n  ETH    2    Translation  1     150    -     150    -     -          -     \r\n  ETH    3    Translation  1     150    -     150    -     -          -     \r\n  ETH    4    Translation  1     150    -     150    -     -          -     \r\n  ETH    5    Translation  1     150    -     150    -     -          -     \r\n  ETH    6    Translation  1     150    -     150    -     -          -     \r\n  ETH    7    Translation  1     150    -     150    -     -          -     \r\n---- More ( Press 'Q' to break ) ----\u001b[37D                                     \u001b[37D  ETH    8    Translation  1     150    -     150    -     -          -     \r\n  -----------------------------------------------------------------------------\r\n  Notes: * indicates transparent attribute of the vlan\r\n  -----------------------------------------------------------------------------\r\n  Port-type  Port-ID    IGMP-mode         IGMP-VLAN  IGMP-PRI  Max-MAC-Count\r\n  -----------------------------------------------------------------------------\r\n  ETH              1    -                         -         -      Unlimited\r\n  ETH              2    -                         -         -      Unlimited\r\n  ETH              3    -                         -         -      Unlimited\r\n  ETH              4    -                         -         -      Unlimited\r\n  ETH              5    -                         -         -      Unlimited\r\n  ETH              6    -                         -         -      Unlimited\r\n  ETH              7    -                         -         -      Unlimited\r\n  ETH              8    -                         -         -      Unlimited\r\n  -----------------------------------------------------------------------------\r\n  Alarm policy profile ID      : 0\r\n  Alarm policy profile name    : alarm-policy_0\r\n  -----------------------------------------------------------------------------\r\n  -----------------------------------------------------------------------------\r\n  The number of required ONTs     : 1\r\n  -----------------------------------------------------------------------------\r\n\r\n";

/** `display ont info 0 1 5 15` — la 900060 tal como la dejó el alta mala. */
const ONT15_HUAWEI_FAILED = "  -----------------------------------------------------------------------------\r\n  F/S/P                   : 0/1/5\r\n  ONT-ID                  : 15\r\n  Control flag            : active\r\n  Run state               : online\r\n  Config state            : failed\r\n  Match state             : match\r\n  DBA type                : SR\r\n  ONT distance(m)         : 2056\r\n  ONT battery state       : not support\r\n  Memory occupation       : 27%\r\n  CPU occupation          : 9%\r\n  Temperature             : 69(C)\r\n  Authentic type          : SN-auth\r\n  SN                      : 485754433058BEAD (HWTC-3058BEAD)\r\n  Management mode         : OMCI\r\n  Software work mode      : normal\r\n  Isolation state         : normal\r\n  ONT IP 0 address/mask   : -\r\n  Description             : 2369MARIAMAGDALENA\r\n  Last down cause         : dying-gasp\r\n  Last up time            : 2026-10-17 10:05:15-05:00\r\n  Last down time          : 2026-10-17 10:04:41-05:00\r\n---- More ( Press 'Q' to break ) ----\u001b[37D                                     \u001b[37D  Last dying gasp time    : 2026-10-17 10:04:41-05:00\r\n  ONT online duration     : 0 day(s), 0 hour(s), 18 minute(s), 41 second(s) \r\n  Type C support          : Not support\r\n  Interoperability-mode   : ITU-T\r\n  -----------------------------------------------------------------------------\r\n  VoIP configure method   : Default\r\n  -----------------------------------------------------------------------------\r\n  Line profile ID      : 150\r\n  Line profile name    : vlan150\r\n  -----------------------------------------------------------------------------\r\n  FEC upstream switch :Disable\r\n  OMCC encrypt switch :Off\r\n  Qos mode            :PQ\r\n  Mapping mode        :VLAN\r\n  TR069 management    :Disable\r\n  TR069 IP index      :0\r\n  -----------------------------------------------------------------------------\r\n  Notes: * indicates Discrete TCONT(TCONT Unbound)\r\n  -----------------------------------------------------------------------------\r\n  <T-CONT   0>          DBA Profile-ID:1\r\n  <T-CONT   8>          DBA Profile-ID:100\r\n   <Gem Index 150>\r\n   --------------------------------------------------------------------\r\n   |Serv-Type:ETH |Encrypt:off |Cascade:off |GEM-CAR:-            |\r\n---- More ( Press 'Q' to break ) ----\u001b[37D                                     \u001b[37D   |Upstream-priority-queue:0  |Downstream-priority-queue:-       |\r\n   --------------------------------------------------------------------\r\n    Mapping VLAN  Priority Port    Port  Bundle  Flow  Transparent\r\n    index                  type    ID    ID      CAR   \r\n   --------------------------------------------------------------------\r\n    1       150   -        -       -     -       -     -          \r\n   --------------------------------------------------------------------\r\n  -----------------------------------------------------------------------------\r\n  Notes: Run the display traffic table ip command to query \r\n         traffic table configuration\r\n  -----------------------------------------------------------------------------\r\n  Service profile ID   : 50\r\n  Service profile name : catv\r\n  -----------------------------------------------------------------------------\r\n  Port-type     Port-number\r\n  -----------------------------------------------------------------------------\r\n  POTS          adaptive\r\n  ETH           adaptive\r\n  VDSL          0\r\n  TDM           0\r\n  MOCA          0\r\n  CATV          1\r\n  -----------------------------------------------------------------------------\r\n  TDM port type                     : E1\r\n---- More ( Press 'Q' to break ) ----\u001b[37D                                     \u001b[37D  TDM service type                  : TDMoGem\r\n  MAC learning function switch      : Enable\r\n  ONT transparent function switch   : Disable\r\n  Ring check switch                 : Disable\r\n  Ring port auto-shutdown           : Enable\r\n  Ring detect frequency             : 8 (pps)\r\n  Ring resume interval              : 300 (s)\r\n  Multicast forward mode            : Unconcern\r\n  Multicast forward VLAN            : -\r\n  Multicast mode                    : Unconcern\r\n  Upstream IGMP packet forward mode : Unconcern\r\n  Upstream IGMP packet forward VLAN : -\r\n  Upstream IGMP packet priority     : -\r\n  Native VLAN option                : Concern\r\n  Upstream PQ color policy          : -\r\n  Downstream PQ color policy        : -\r\n  -----------------------------------------------------------------------------\r\n  Port-type Port-ID QinQmode  PriorityPolicy Inbound     Outbound\r\n  -----------------------------------------------------------------------------\r\n  ETH       1       unconcern unconcern      unconcern   unconcern\r\n  ETH       2       unconcern unconcern      unconcern   unconcern\r\n  ETH       3       unconcern unconcern      unconcern   unconcern\r\n  ETH       4       unconcern unconcern      unconcern   unconcern\r\n  ETH       5       unconcern unconcern      unconcern   unconcern\r\n---- More ( Press 'Q' to break ) ----\u001b[37D                                     \u001b[37D  ETH       6       unconcern unconcern      unconcern   unconcern\r\n  ETH       7       unconcern unconcern      unconcern   unconcern\r\n  ETH       8       unconcern unconcern      unconcern   unconcern\r\n  -----------------------------------------------------------------------------\r\n  Notes: * indicates the discretely configured traffic profile,\r\n         run the display traffic table ip command to query\r\n         traffic table configuration.\r\n  -----------------------------------------------------------------------------\r\n  Port-type Port-ID  DownstreamMode  MismatchPolicy\r\n  -----------------------------------------------------------------------------\r\n  ETH             1  operation       discard       \r\n  ETH             2  operation       discard       \r\n  ETH             3  operation       discard       \r\n  ETH             4  operation       discard       \r\n  ETH             5  operation       discard       \r\n  ETH             6  operation       discard       \r\n  ETH             7  operation       discard       \r\n  ETH             8  operation       discard       \r\n  -----------------------------------------------------------------------------\r\n  Port-type Port-ID Dscp-mapping-table-index\r\n  -----------------------------------------------------------------------------\r\n  ETH       1       0        \r\n  ETH       2       0        \r\n  ETH       3       0        \r\n---- More ( Press 'Q' to break ) ----\u001b[37D                                     \u001b[37D  ETH       4       0        \r\n  ETH       5       0        \r\n  ETH       6       0        \r\n  ETH       7       0        \r\n  ETH       8       0        \r\n  IPHOST    1       0        \r\n  -----------------------------------------------------------------------------\r\n  Port-type  Port-ID    IGMP-mode         IGMP-VLAN  IGMP-PRI  Max-MAC-Count\r\n  -----------------------------------------------------------------------------\r\n  ETH              1    -                         -         -      Unlimited\r\n  ETH              2    -                         -         -      Unlimited\r\n  ETH              3    -                         -         -      Unlimited\r\n  ETH              4    -                         -         -      Unlimited\r\n  ETH              5    -                         -         -      Unlimited\r\n  ETH              6    -                         -         -      Unlimited\r\n  ETH              7    -                         -         -      Unlimited\r\n  ETH              8    -                         -         -      Unlimited\r\n  -----------------------------------------------------------------------------\r\n  Alarm policy profile ID      : 0\r\n  Alarm policy profile name    : alarm-policy_0\r\n  -----------------------------------------------------------------------------\r\n  -----------------------------------------------------------------------------\r\n  The number of required ONTs     : 1\r\n  -----------------------------------------------------------------------------\r\n\r\n";

/** Una ZTE del puerto con el perfil mayoritario "vlan150" (recorte con el mismo formato). */
const ONT_ZTE = (ontId: number, config: string) => `
  F/S/P                   : 0/1/5
  ONT-ID                  : ${ontId}
  Run state               : online
  Config state            : ${config}
  Match state             : match
  Line profile ID      : 150
  Line profile name    : vlan150
    Mapping VLAN  Priority Port    Port  Bundle  Flow  Transparent
    index                  type    ID    ID      CAR
   --------------------------------------------------------------------
    1       150   -        -       -     -       -     -
   --------------------------------------------------------------------
  Service profile ID   : 24
  Service profile name : ONU-type-eth-4-pots-2-catv-0
  CATV          0
`;

/** `display service-port port 0/1/5`: todo el PON en la VLAN 150. */
const SP_PUERTO = `
     373  150 common   gpon 0/1 /5  0    150   vlan  150        45   45   up
     374  150 common   gpon 0/1 /5  2    150   vlan  150        45   45   up
     375  150 common   gpon 0/1 /5  3    150   vlan  150        45   45   up
     380  150 common   gpon 0/1 /5  9    1     vlan  150        53   54   up
`;

/** `display ont info 0 1 5 all`: tres ZTE/genéricas y UNA Huawei en config normal. */
const LISTADO = (conHuawei = true) => `
  0/ 1/5    0  444338306A432AED  active      online   normal   match    no
  0/ 1/5    2  44433830E697D248  active      online   normal   mismatch no
  0/ 1/5    3  444338306A426FD9  active      online   normal   match    no
` + (conHuawei ? `  0/ 1/5    9  48575443DC48F20A  active      online   normal   match    no
` : '');

function driver(respuestas: Record<string, string>) {
  const d = new OltHuawei('10.0.0.1', '22', 'u', 'p');
  const enviados: string[] = [];
  (d as any).sendCommand = async (cmd: string) => {
    enviados.push(cmd);
    // La clave más larga primero: "display ont info 0 1 5 1" no debe tapar a "…5 15".
    const k = Object.keys(respuestas).filter((x) => cmd === x || cmd.startsWith(x + ' ') || cmd.startsWith(x)).sort((a, b) => b.length - a.length)[0];
    return k ? respuestas[k] : '';
  };
  return { d, enviados };
}

const PUERTO_CON_HUAWEI: Record<string, string> = {
  'display service-port port 0/1/5': SP_PUERTO,
  'display ont info 0 1 5 all': LISTADO(true),
  'display ont info 0 1 5 0': ONT_ZTE(0, 'normal'),
  'display ont info 0 1 5 2': ONT_ZTE(2, 'normal'),
  'display ont info 0 1 5 3': ONT_ZTE(3, 'normal'),
  'display ont info 0 1 5 9': ONT9_HUAWEI_NORMAL,
};

describe('marcaDeSn', () => {
  it('lee el vendor-id del SN hexadecimal y del legible', () => {
    expect(marcaDeSn('485754433058BEAD')).toBe('HWTC');
    expect(marcaDeSn('HWTC3058BEAD')).toBe('HWTC');
    expect(marcaDeSn('5A544547C64520C9')).toBe('ZTEG');
    expect(marcaDeSn('47504F4E00B89D48')).toBe('GPON');
    expect(marcaDeSn('')).toBeNull();
    expect(marcaDeSn('basura')).toBeNull();
  });
  it('misma marca solo si las dos se identifican', () => {
    expect(mismaMarca('485754433058BEAD', 'HWTCDC48F20A')).toBe(true);
    expect(mismaMarca('485754433058BEAD', '444338306A432AED')).toBe(false);
    expect(mismaMarca(null, null)).toBe(false);
  });
});

describe('vlansDelDetalleOnt (salida real)', () => {
  it('la Huawei que navega: GEM 1 → VLAN 150 y los ETH traducidos 150→150', () => {
    expect(vlansDelDetalleOnt(ONT9_HUAWEI_NORMAL)).toEqual({ lp: [150], sp: [150] });
  });
  it('la 900060 mal dada de alta: VLAN 150 en el GEM y NINGUNA en los puertos', () => {
    expect(vlansDelDetalleOnt(ONT15_HUAWEI_FAILED)).toEqual({ lp: [150], sp: [] });
  });
  it('un perfil con la VLAN 150 dentro no vale para un puerto de la 260', () => {
    const v = vlansDelDetalleOnt(ONT9_HUAWEI_NORMAL);
    expect(perfilesValenParaVlan(v, 150)).toBe(true);
    expect(perfilesValenParaVlan(v, 260)).toBe(false);
    expect(perfilesValenParaVlan({ lp: [], sp: [] }, 260)).toBe(true);
  });
});

describe('sugerenciaDePuerto copia los perfiles de una vecina de la MISMA marca', () => {
  it('Huawei en un puerto de ZTE: lp 13 + sp 21 de la Huawei que navega (lo de la 900060)', async () => {
    const { d } = driver(PUERTO_CON_HUAWEI);
    const s = await d.sugerenciaDePuerto(0, 1, 5, { sn: '485754433058BEAD' });
    expect(s.lineprofile).toBe('13');
    expect(s.srvprofile).toBe('21');
    expect(s.referencia).toMatchObject({ fsp: '0/1/5', ont_id: '9', origen: 'PUERTO' });
    expect(s.referenciaMotivo).toBeNull();
    expect(s.vlan).toBe('150');
    // El GEM del service-port sale del line-profile de la vecina (1), no de la mayoría del puerto (150).
    expect(s.gemport).toBe('1');
  });

  it('una ZTE en el mismo puerto sigue con el perfil de las ZTE', async () => {
    const { d } = driver(PUERTO_CON_HUAWEI);
    const s = await d.sugerenciaDePuerto(0, 1, 5, { sn: '444338306A3CAD4C' });
    expect(s.lineprofile).toBe('150');
    expect(s.srvprofile).toBe('24');
    expect(s.referencia).toMatchObject({ origen: 'PUERTO' });
    expect(s.referencia.sn).toMatch(/^44433830/);
  });

  it('sin SN (llamadas viejas) se comporta como antes: mayoría del puerto', async () => {
    const { d } = driver(PUERTO_CON_HUAWEI);
    const s = await d.sugerenciaDePuerto(0, 1, 5);
    expect(s.lineprofile).toBe('150');
    expect(s.referencia).toBeNull();
  });

  it('sin Huawei en el puerto, la toma de otro puerto de la OLT si su VLAN casa', async () => {
    const { d, enviados } = driver({
      ...PUERTO_CON_HUAWEI,
      'display ont info 0 1 5 all': LISTADO(false),
      'display ont info 0 1 3 8': ONT9_HUAWEI_NORMAL,
    });
    const s = await d.sugerenciaDePuerto(0, 1, 5, {
      sn: '485754433058BEAD',
      referenciasOlt: [{ fsp: '0/1/3', ont_id: '8', sn: '48575443306F7CAD' }],
    });
    expect(enviados).toContain('display ont info 0 1 3 8');
    expect(s.lineprofile).toBe('13');
    expect(s.srvprofile).toBe('21');
    expect(s.referencia).toMatchObject({ fsp: '0/1/3', ont_id: '8', origen: 'OLT' });
  });

  it('la de otro puerto con OTRA VLAN dentro no se copia, y se avisa', async () => {
    const { d } = driver({
      ...PUERTO_CON_HUAWEI,
      'display service-port port 0/1/5': SP_PUERTO.replace(/ 150 /g, ' 260 '),
      'display ont info 0 1 5 all': LISTADO(false),
      'display ont info 0 1 3 8': ONT9_HUAWEI_NORMAL,
    });
    const s = await d.sugerenciaDePuerto(0, 1, 5, {
      sn: '485754433058BEAD',
      referenciasOlt: [{ fsp: '0/1/3', ont_id: '8', sn: '48575443306F7CAD' }],
    });
    expect(s.referencia).toBeNull();
    expect(s.referenciaMotivo).toContain('HWTC');
    expect(s.lineprofile).toBe('150');
  });

  it('una vecina de su marca en config FAILED no sirve de modelo', async () => {
    const { d } = driver({
      ...PUERTO_CON_HUAWEI,
      'display ont info 0 1 5 all': LISTADO(false) + '  0/ 1/5   15  485754433058BEAD  active      online   failed   match    no\n',
      'display ont info 0 1 5 15': ONT15_HUAWEI_FAILED,
    });
    const s = await d.sugerenciaDePuerto(0, 1, 5, { sn: '48575443AAAAAAAA' });
    expect(s.referencia).toBeNull();
    expect(s.referenciaMotivo).toBeTruthy();
  });
});
