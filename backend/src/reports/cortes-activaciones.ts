/**
 * Cortes y activaciones, contados desde las ÓRDENES y comprobados en el router.
 *
 * Hasta el 2026-09-29 este reporte contaba filas de `SubscriberStatusHistory` y salía
 * muy lejos de la realidad: en septiembre decía 73 cortes cuando hubo 1.251 órdenes de
 * corte de internet y 984 de TV. Tres motivos, todos de datos:
 *  - el corte masivo lo hace el legacy y deja la ficha en "Activo", así que casi ningún
 *    corte llega al historial (ver corte-legacy-no-cambia-estado);
 *  - el historial pierde ~12% de los cambios y repite filas (121 retiros = 41 personas);
 *  - no dice qué servicio se cortó.
 *
 * Lo que sí es fiable es la ORDEN de servicio resuelta: la crea el lote de corte, la
 * reconexión por pago o la persona que atiende, y se cierra cuando el trabajo se hizo.
 * Por eso un evento = una orden resuelta, fechada por su CIERRE (`finalDate`), con tres
 * limpiezas medidas en septiembre:
 *  - las del perfil de prueba (`PRUEBA · …`) no cuentan (6 órdenes el 09-09);
 *  - la misma orden repetida para el mismo cliente el mismo día cuenta una vez (el lote
 *    de corte del 21-09 corrió dos veces: 76 cortes de internet y 95 de TV duplicados);
 *  - "Retiro" suma, además de la orden, a quien quedó RETIRADO sin ella (devolución de
 *    equipo, cambio manual): 9 personas en septiembre.
 *
 * El router confirma sólo internet (TV vive en la OLT y TR-069 está en pausa). Y sólo
 * sabe de lo que hizo el sistema: los cortes que el legacy o alguien por Winbox hizo
 * directo en el router no dejan rastro. Hasta el 21-09 el corte masivo lo hacía el
 * legacy, así que "sin registro" antes de esa fecha NO significa "no se cortó".
 */

export type Evento = 'CORTE' | 'RECONEXION' | 'SUSPENSION' | 'RETIRO' | 'INSTALACION';
export type Servicio = 'Internet' | 'TV' | 'Combo' | 'General';

export const EVENTOS: { key: Evento; label: string }[] = [
  { key: 'CORTE', label: 'Cortes' },
  { key: 'RECONEXION', label: 'Reconexiones' },
  { key: 'SUSPENSION', label: 'Suspensiones' },
  { key: 'RETIRO', label: 'Retiros' },
  { key: 'INSTALACION', label: 'Instalaciones' },
];
const SERVICIOS: Servicio[] = ['Internet', 'TV', 'Combo', 'General'];

/**
 * Tipos de orden que entran al reporte, para el `WHERE` (Postgres, sin distinguir
 * mayúsculas). Tiene que decir lo mismo que `clasificarOrden`; el spec lo comprueba.
 * 'Instalación y/o Mantenimiento de Equipos Activos d' queda fuera a propósito: es
 * trabajo de red, no el alta de un cliente.
 */
export const TIPOS_SQL = '^(corte|reconex|suspen[cs]ion|retiro|instalaci[oó]n$|reinstalaci[oó]n|activacion$)';

/**
 * El tipo de orden (el `detalle` del legacy) → qué pasó y a qué servicio.
 * `null` = no es una orden de este reporte.
 */
export function clasificarOrden(tipo: string | null | undefined): { evento: Evento; servicio: Servicio } | null {
  const t = (tipo ?? '').trim().toLowerCase();
  let evento: Evento | null = null;
  if (t.startsWith('corte')) evento = 'CORTE';
  else if (t.startsWith('reconex')) evento = 'RECONEXION';
  else if (/^suspen[cs]ion/.test(t)) evento = 'SUSPENSION';
  else if (t.startsWith('retiro')) evento = 'RETIRO';
  else if (/^instalaci[oó]n$/.test(t) || /^reinstalaci[oó]n/.test(t) || t === 'activacion') evento = 'INSTALACION';
  if (!evento) return null;
  // 'Internet2'/'Television2' son el segundo servicio del mismo tipo: cuentan igual.
  const servicio: Servicio = t.includes('combo') ? 'Combo'
    : t.includes('internet') ? 'Internet'
    : t.includes('televis') ? 'TV'
    : 'General';
  return { evento, servicio };
}

/** ¿El router puede confirmar este evento? Sólo cortes y reconexiones con internet. */
export const confirmableEnRouter = (evento: Evento, servicio: Servicio): boolean =>
  (evento === 'CORTE' || evento === 'RECONEXION') && (servicio === 'Internet' || servicio === 'Combo');

/** Órdenes creadas por los perfiles de prueba (`seed-usuarios-prueba.ts`). */
export const esDePrueba = (creadoPor: string | null | undefined): boolean =>
  /^prueba\s*·/i.test((creadoPor ?? '').trim());

/** Una orden del periodo, tal como sale de la consulta. */
export type FilaOrden = {
  id: string;
  code: number | null;
  tipo: string;
  estado: 'RESUELTO' | 'ANULADA' | 'PENDIENTE' | 'REALIZANDO';
  creadoPor: string | null;
  fecha: string; // YYYY-MM-DD: cierre (o creación si sigue abierta)
  clienteId: string;
  abonado: number;
  nombre: string | null;
  sede: string | null;
  enRouter: boolean;
};

/** Quien quedó RETIRADO en el periodo sin orden de retiro (del historial de estados). */
export type RetiroSinOrden = {
  clienteId: string; abonado: number; nombre: string | null; sede: string | null;
  fecha: string; nota: string | null;
};

/** Acciones hechas en el router sin una orden que las respalde, por día. */
export type AccionRouterSinOrden = { fecha: string; accion: 'CUT' | 'RECONNECT' | 'MOROSO_ON' | 'MOROSO_OFF'; acciones: number; clientes: number };

export type FilaDetalle = {
  fecha: string; clienteId: string; abonado: number; nombre: string | null; sede: string | null;
  evento: Evento; servicio: Servicio; tipo: string; orden: number | null;
  /** true/false = el router lo registró o no; null = el router no puede confirmarlo. */
  router: boolean | null;
  origen: 'Orden' | 'Sin orden';
};

type Celda = {
  evento: Evento; servicio: Servicio;
  hechos: number; clientes: number;
  conRouter: number | null; sinRouter: number | null;
  anuladas: number; abiertas: number;
};

/** Tope de filas de detalle: un año entero son ~50.000 y el navegador no las pinta. */
export const MAX_DETALLE = 6000;

export function armarCortesActivaciones(
  ordenes: FilaOrden[],
  retirosSinOrden: RetiroSinOrden[],
  routerSinOrden: AccionRouterSinOrden[],
) {
  const celdas = new Map<string, Celda & { _clientes: Set<string> }>();
  const celda = (evento: Evento, servicio: Servicio) => {
    const k = `${evento}|${servicio}`;
    let c = celdas.get(k);
    if (!c) {
      const conf = confirmableEnRouter(evento, servicio);
      c = { evento, servicio, hechos: 0, clientes: 0, conRouter: conf ? 0 : null, sinRouter: conf ? 0 : null, anuladas: 0, abiertas: 0, _clientes: new Set() };
      celdas.set(k, c);
    }
    return c;
  };

  const detalle: FilaDetalle[] = [];
  const vistos = new Set<string>();
  const clientesPorEvento = new Map<Evento, Set<string>>();
  const porDia = new Map<string, Record<Evento, number>>();
  let pruebas = 0;
  let duplicadas = 0;

  for (const o of ordenes) {
    const cl = clasificarOrden(o.tipo);
    if (!cl) continue;
    if (esDePrueba(o.creadoPor)) { pruebas++; continue; }
    const c = celda(cl.evento, cl.servicio);
    if (o.estado === 'ANULADA') { c.anuladas++; continue; }
    if (o.estado !== 'RESUELTO') { c.abiertas++; continue; }

    // Misma orden, mismo cliente, mismo día: el lote corrió dos veces.
    const clave = `${o.clienteId}|${o.tipo.trim().toLowerCase()}|${o.fecha}`;
    if (vistos.has(clave)) { duplicadas++; continue; }
    vistos.add(clave);

    c.hechos++;
    c._clientes.add(o.clienteId);
    const router = confirmableEnRouter(cl.evento, cl.servicio) ? o.enRouter : null;
    if (router === true) c.conRouter!++;
    if (router === false) c.sinRouter!++;
    sumar(clientesPorEvento, cl.evento, o.clienteId);
    diaDe(porDia, o.fecha)[cl.evento]++;
    detalle.push({
      fecha: o.fecha, clienteId: o.clienteId, abonado: o.abonado, nombre: o.nombre, sede: o.sede,
      evento: cl.evento, servicio: cl.servicio, tipo: o.tipo.trim(), orden: o.code, router, origen: 'Orden',
    });
  }

  // Retiros sin orden: sólo quien NO tiene ya una orden de retiro en el periodo, y una
  // vez por persona (el historial repite filas).
  const conRetiro = clientesPorEvento.get('RETIRO') ?? new Set<string>();
  const retiroSinOrdenVisto = new Set<string>();
  let retirosSinOrdenN = 0;
  for (const r of retirosSinOrden) {
    if (conRetiro.has(r.clienteId) || retiroSinOrdenVisto.has(r.clienteId)) continue;
    retiroSinOrdenVisto.add(r.clienteId);
    retirosSinOrdenN++;
    const c = celda('RETIRO', 'General');
    c.hechos++;
    c._clientes.add(r.clienteId);
    sumar(clientesPorEvento, 'RETIRO', r.clienteId);
    diaDe(porDia, r.fecha).RETIRO++;
    detalle.push({
      fecha: r.fecha, clienteId: r.clienteId, abonado: r.abonado, nombre: r.nombre, sede: r.sede,
      evento: 'RETIRO', servicio: 'General', tipo: r.nota?.trim() || 'Cambio de estado a RETIRADO', orden: null,
      router: null, origen: 'Sin orden',
    });
  }

  const filas: Celda[] = [...celdas.values()]
    .map(({ _clientes, ...c }) => ({ ...c, clientes: _clientes.size }))
    .sort((a, b) => ordenEvento(a.evento) - ordenEvento(b.evento) || SERVICIOS.indexOf(a.servicio) - SERVICIOS.indexOf(b.servicio));

  const resumen = EVENTOS.map(({ key, label }) => {
    const fs = filas.filter((f) => f.evento === key);
    const suma = (k: 'hechos' | 'anuladas' | 'abiertas') => fs.reduce((s, f) => s + f[k], 0);
    const conf = fs.filter((f) => f.conRouter != null);
    return {
      evento: key, label,
      hechos: suma('hechos'),
      clientes: clientesPorEvento.get(key)?.size ?? 0,
      anuladas: suma('anuladas'),
      abiertas: suma('abiertas'),
      conRouter: conf.length ? conf.reduce((s, f) => s + (f.conRouter ?? 0), 0) : null,
      sinRouter: conf.length ? conf.reduce((s, f) => s + (f.sinRouter ?? 0), 0) : null,
    };
  });

  const sinOrden = {
    cortes: routerSinOrden.filter((r) => r.accion === 'CUT' || r.accion === 'MOROSO_ON').reduce((s, r) => s + r.acciones, 0),
    reconexiones: routerSinOrden.filter((r) => r.accion === 'RECONNECT' || r.accion === 'MOROSO_OFF').reduce((s, r) => s + r.acciones, 0),
    porDia: [...routerSinOrden].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.accion.localeCompare(b.accion)),
  };

  const depurado = { pruebas, duplicadas, retirosSinOrden: retirosSinOrdenN };
  detalle.sort((a, b) => b.fecha.localeCompare(a.fecha) || ordenEvento(a.evento) - ordenEvento(b.evento) || a.abonado - b.abonado);
  const total = (e: Evento) => resumen.find((r) => r.evento === e)!.hechos;

  return {
    // Las cinco cifras de siempre, para el chatbot y el PDF. `activaciones` = reconexiones:
    // es lo que el reporte siempre quiso decir con esa palabra.
    cortes: total('CORTE'),
    activaciones: total('RECONEXION'),
    reconexiones: total('RECONEXION'),
    suspensiones: total('SUSPENSION'),
    retiros: total('RETIRO'),
    instalaciones: total('INSTALACION'),
    resumen,
    filas,
    porDia: [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, n]) => ({ fecha, ...n })),
    routerSinOrden: sinOrden,
    depurado,
    notas: notasDeLectura(depurado, sinOrden),
    detalle: detalle.slice(0, MAX_DETALLE),
    detalleTotal: detalle.length,
  };
}

/**
 * Cómo leer el reporte. Las mismas frases en la pantalla, el PDF y el chatbot: si una
 * cifra se explica distinto en cada sitio, nadie se fía de ninguna.
 */
function notasDeLectura(
  d: { pruebas: number; duplicadas: number; retirosSinOrden: number },
  sinOrden: { cortes: number; reconexiones: number },
): string[] {
  const n = (x: number) => new Intl.NumberFormat('es-CO').format(x);
  const notas = [
    'Cada evento es una orden de servicio RESUELTA, fechada el día en que se cerró. Las anuladas y las que siguen abiertas se muestran aparte y no suman.',
    '«Clientes» cuenta personas: a quien se cortó dos veces en el periodo se le cuentan dos cortes y un cliente.',
    'El router sólo confirma internet. Registra lo que hizo el sistema; lo que el legacy o alguien por Winbox hizo directo en el router no deja registro (hasta el 21-09-2026 el corte masivo lo hacía el legacy). «Sin registro» no prueba que no se hiciera.',
    'La TV se corta en la OLT y el cambio por TR-069 está en pausa: en TV sólo cuenta la orden.',
  ];
  if (d.duplicadas) notas.push(`${n(d.duplicadas)} órdenes repetidas (mismo cliente, mismo tipo, mismo día) se contaron una sola vez.`);
  if (d.pruebas) notas.push(`${n(d.pruebas)} órdenes del perfil de prueba no se contaron.`);
  if (d.retirosSinOrden) notas.push(`${n(d.retirosSinOrden)} retiros no tienen orden (devolución de equipo o cambio manual del estado): salen del historial del cliente.`);
  if (sinOrden.cortes || sinOrden.reconexiones) {
    notas.push(`Aparte, el router registró ${n(sinOrden.cortes)} cortes y ${n(sinOrden.reconexiones)} reconexiones sin una orden de ese cliente (activaciones masivas, pasos a MOROSOS a mano). No suman a los totales.`);
  }
  return notas;
}

const ordenEvento = (e: Evento) => EVENTOS.findIndex((x) => x.key === e);

function sumar(m: Map<Evento, Set<string>>, e: Evento, id: string) {
  let s = m.get(e);
  if (!s) m.set(e, (s = new Set()));
  s.add(id);
}

function diaDe(m: Map<string, Record<Evento, number>>, fecha: string) {
  let d = m.get(fecha);
  if (!d) m.set(fecha, (d = { CORTE: 0, RECONEXION: 0, SUSPENSION: 0, RETIRO: 0, INSTALACION: 0 }));
  return d;
}
