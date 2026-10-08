import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { num, round2 } from '../common/money';
import { traductorDeTecnicos } from '../staff/nombre-tecnico';
import { gestionar, seguimientoCartera } from './cartera-seguimiento';
import { hoyEnColombia } from '../common/fecha-colombia';
import { whereAbonadoNuevo } from '../common/abonado-nuevo';
import { whereRetiro } from '../common/abonado-retirado';
import {
  armarCortesActivaciones, TIPOS_SQL, type AccionRouterSinOrden, type FilaOrden, type RetiroSinOrden,
} from './cortes-activaciones';
import { revisionesDetalle } from './revisiones-detalle';
import { SEDE_ACTIVA } from '../common/sedes-activas';


/** Fila cruda del reporte de IVA (una por documento). */
type IvaRow = {
  numero: number; fecha: Date; tercero: string; documento: string | null;
  base_gravable: number; base_exenta: number; ajustes: number; iva: number; total: number;
  retencion_tipo: string | null; retencion: number;
};
/** Fila cruda del resumen por tarifa. */
type TarifaRow = { tarifa: number; base: number; iva: number; documentos: number };
/**
 * Rango de fechas a partir de dos `YYYY-MM-DD` inclusivos por los DOS extremos.
 *
 * El `lte` se lleva al final del día a propósito. `new Date('2026-06-30')` es la
 * medianoche de ese día, así que pedir "junio" (01→30) dejaba fuera el 30 entero
 * en todo lo que guarda hora: **98 cortes y activaciones del último día de junio no
 * aparecían** en su reporte. Con las columnas de tipo `date` (facturas, órdenes,
 * transacciones) daba igual, y por eso pasó desapercibido tanto tiempo.
 */
function range(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  const r: { gte?: Date; lte?: Date } = {};
  if (from) r.gte = new Date(`${from}T00:00:00.000Z`);
  if (to) r.lte = new Date(`${to}T23:59:59.999Z`);
  return r;
}

/**
 * La sede de CUALQUIER cosa cuelga siempre del abonado: `Subscriber.branchId`. Ni
 * la transacción, ni la factura, ni la orden llevan sede propia. Por eso todos los
 * recortes por sede de este archivo son el mismo filtro sobre la relación
 * `subscriber`, y por eso todos comparten la misma advertencia: lo que no tiene
 * abonado (un ingreso suelto, un egreso, una compra a proveedor) NO tiene sede y
 * queda fuera al filtrar. Se cuenta y se declara — un total que baila en silencio
 * es peor que un total incompleto.
 */
/**
 * Cortes y reconexiones (de internet, TV, combo, "2" y "por días"): el reporte de
 * órdenes los deja fuera. Todos los tipos del legacy empiezan así (ver order-types.ts).
 */
const CORTES_Y_RECONEXIONES: Prisma.TicketWhereInput[] = [
  { type: { startsWith: 'corte', mode: 'insensitive' } },
  { type: { startsWith: 'reconex', mode: 'insensitive' } },
];
const SIN_CORTES_NI_RECONEXIONES: Prisma.TicketWhereInput[] = CORTES_Y_RECONEXIONES.map((w) => ({ NOT: w }));

/** `YYYY-MM-DD` válido (lo que manda el filtro de fechas). */
const esFecha = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

const SEDE_NOTA =
  'La sede sale del ABONADO, que es quien la tiene: ni el movimiento ni el documento llevan sede propia. ' +
  'Lo que no está ligado a un abonado no tiene sede y no aparece cuando se filtra.';

export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sedes existentes, para poblar el filtro sin ofrecer una que daría cero. */
  async sedes() {
    const rows = await this.prisma.branch.findMany({ where: SEDE_ACTIVA, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    return rows.map((b) => ({ id: b.id, nombre: b.name }));
  }

  /** Nombre de una sede por id (para titular el reporte), o null si no se filtró. */
  private async nombreSede(sede?: string): Promise<string | null> {
    if (!sede) return null;
    const b = await this.prisma.branch.findUnique({ where: { id: sede }, select: { name: true } });
    return b?.name ?? null;
  }

  /**
   * Recaudo: ingresos vigentes agrupados por caja y por método.
   *
   * Incluye los saldos a favor aplicados a una factura (método `Balance`, sin caja): salen
   * como «Saldos a favor», por decisión de la gerencia (29-sep). Esa plata ya se contó el día del
   * adelanto en la caja por la que entró, así que se devuelven también aparte
   * (`saldosAplicados`) para que la pantalla lo diga y enlace a los movimientos.
   */
  async recaudo(from?: string, to?: string, sede?: string) {
    const base: Prisma.TransactionWhereInput = { status: 'VIGENTE', type: 'INCOME' };
    const dr = range(from, to);
    if (dr) base.date = dr;
    if (sede) base.subscriber = { branchId: sede };
    const where = base;

    const [byAccount, byMethod, total, sinSede, sedes, nombre, saldos, branch] = await Promise.all([
      this.prisma.transaction.groupBy({ by: ['accountName'], _sum: { credit: true }, _count: { _all: true }, where }),
      this.prisma.transaction.groupBy({ by: ['method'], _sum: { credit: true }, _count: { _all: true }, where }),
      this.prisma.transaction.aggregate({ _sum: { credit: true }, _count: { _all: true }, where }),
      // Ingresos del periodo que NO cuelgan de un abonado: hoy son ~0,2%, pero se
      // cuentan para que quien compare el total con el de "todas las sedes" sepa
      // por qué no cuadra.
      sede
        ? this.prisma.transaction.count({ where: { ...where, subscriber: undefined, subscriberId: null } })
        : Promise.resolve(0),
      this.sedes(),
      this.nombreSede(sede),
      this.prisma.transaction.aggregate({ _sum: { credit: true }, _count: { _all: true }, where: { ...base, method: 'Balance' } }),
      sede ? this.prisma.branch.findUnique({ where: { id: sede }, select: { legacyId: true } }) : Promise.resolve(null),
    ]);

    return {
      total: num(total._sum.credit), count: total._count._all,
      sede: nombre, sinSede, notaSede: sede ? SEDE_NOTA : null,
      // `sedeLegacy`: tesorería filtra la sede por el número del legacy, no por el id.
      saldosAplicados: { total: num(saldos._sum.credit), count: saldos._count._all, sedeLegacy: branch?.legacyId ?? null },
      // Lo que no lleva caja son los saldos a favor aplicados (método `Balance`): se rotulan así.
      porCaja: byAccount.map((r) => ({ caja: r.accountName ?? 'Saldos a favor', total: num(r._sum.credit), count: r._count._all })).sort((a, b) => b.total - a.total),
      porMetodo: byMethod.map((r) => ({ metodo: r.method ?? 'Sin método', total: num(r._sum.credit), count: r._count._all })).sort((a, b) => b.total - a.total),
      opciones: { sedes },
    };
  }

  /** Ventas por sede: facturas agrupadas por sede del cliente. */
  async ventasSede(from?: string, to?: string) {
    const dr = range(from, to);
    const rows = await this.prisma.$queryRaw<{ sede: string; total: number; cnt: number }[]>`
      SELECT COALESCE(b.name,'Sin sede') sede, COALESCE(SUM(i.total),0)::float total, COUNT(*)::int cnt
      FROM "SubInvoice" i
      LEFT JOIN "Subscriber" s ON s.id = i."subscriberId"
      LEFT JOIN "Branch" b ON b.id = s."branchId"
      ${dr?.gte ? Prisma.sql`WHERE i."invoiceDate" >= ${dr.gte}` : Prisma.empty}
      ${dr?.lte ? (dr.gte ? Prisma.sql`AND i."invoiceDate" <= ${dr.lte}` : Prisma.sql`WHERE i."invoiceDate" <= ${dr.lte}`) : Prisma.empty}
      GROUP BY b.name ORDER BY total DESC`;
    return { items: rows.map((r) => ({ sede: r.sede, total: Number(r.total), facturas: Number(r.cnt) })) };
  }

  /** Ingresos vs egresos por mes (últimos 12 meses con datos). */
  async ingresosEgresos() {
    const rows = await this.prisma.$queryRaw<{ m: string; income: number; expense: number }[]>`
      SELECT to_char(date_trunc('month', date),'YYYY-MM') m,
             COALESCE(SUM(credit) FILTER (WHERE type='INCOME'),0)::float income,
             COALESCE(SUM(debit) FILTER (WHERE type='EXPENSE'),0)::float expense
      FROM "Transaction" WHERE status='VIGENTE' GROUP BY 1 ORDER BY 1 DESC LIMIT 12`;
    return { items: [...rows].reverse().map((r) => ({ month: r.m, income: Number(r.income), expense: Number(r.expense), balance: Number(r.income) - Number(r.expense) })) };
  }

  /**
   * Órdenes de servicio del periodo: total, y desglose por tipo, estado y técnico.
   *
   * `sede` es un `Branch.id` y recorta por la sede DEL ABONADO de la orden, que es
   * quien tiene sede (la orden no la lleva). Sin este filtro no se podía contestar
   * lo más normal que se pregunta —"las órdenes de Villanueva en junio"— y había que
   * mirar el reporte de otra sección para aproximarlo.
   *
   * `porTipo` ya NO se corta a los 20 primeros: el catálogo tiene 63 tipos y el
   * reporte existe justamente para ver cuántas hubo de CADA uno; recortarlo dejaba
   * fuera la cola larga sin decirlo, que es la peor forma de mentir en un reporte.
   */
  /**
   * Órdenes de servicio del periodo, SIN cortes ni reconexiones (pedido del usuario,
   * 2026-09-29). Esas las abre en lote la cartera —5.297 órdenes en septiembre, de las
   * que 4.253 eran cortes y reconexiones— y ahogaban lo que este reporte quiere mostrar:
   * cómo va el trabajo de la empresa de un mes a otro (reclamos, instalaciones,
   * traslados, cuánto se tarda en resolver). Se cuentan en `excluidas` y se cuentan
   * de verdad en el reporte de cortes y activaciones.
   *
   * `revisiones` es el detalle de lo que queda: dos de cada tres órdenes son una
   * revisión (647 de 1.001 en septiembre) y saber cuántas hubo no sirve para
   * arreglarlas. Ese bloque dice de QUÉ son —del texto del reclamo— y DÓNDE están
   * —barrio, caja NAP y VLAN del abonado—. Ver revisiones-detalle.ts.
   */
  async ordenes(from?: string, to?: string, sede?: string) {
    const where: Prisma.TicketWhereInput = { AND: SIN_CORTES_NI_RECONEXIONES };
    const dr = range(from, to);
    if (dr) where.created = dr;
    if (sede) where.subscriber = { branchId: sede };
    const excluidasWhere: Prisma.TicketWhereInput = { OR: CORTES_Y_RECONEXIONES };
    if (dr) excluidasWhere.created = dr;
    if (sede) excluidasWhere.subscriber = { branchId: sede };

    const [byType, byStatus, byTech, total, sinAbonado, sedes, excluidas, mesAMes, revisiones] = await Promise.all([
      this.prisma.ticket.groupBy({ by: ['type'], _count: { _all: true }, where, orderBy: { _count: { type: 'desc' } } }),
      this.prisma.ticket.groupBy({ by: ['status'], _count: { _all: true }, where }),
      // Se piden más de las 15 que se muestran: un mismo técnico puede venir
      // partido en dos filas (su username en las órdenes viejas y su nombre en las
      // nuevas) y hay que sumarlas ANTES de quedarse con el top.
      this.prisma.ticket.groupBy({ by: ['assigned'], _count: { _all: true }, where, orderBy: { _count: { assigned: 'desc' } }, take: 40 }),
      this.prisma.ticket.count({ where }),
      // Una orden sin abonado no tiene sede: al filtrar, queda fuera. Son 7 en toda
      // la base, pero se cuenta y se dice en vez de que el total baile en silencio.
      this.prisma.ticket.count({ where: { ...where, subscriber: undefined, subscriberId: null } }),
      this.prisma.branch.findMany({ where: SEDE_ACTIVA, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.ticket.count({ where: excluidasWhere }),
      this.ordenesMesAMes(to, sede),
      // De qué y dónde son las revisiones, que son la mayoría de las órdenes. Mismo
      // periodo que el resto del bloque "por tipo / por estado" para que las cifras
      // de la pantalla se puedan sumar entre ellas.
      revisionesDetalle(this.prisma, esFecha(from) ? from : undefined, esFecha(to) ? to : undefined, sede),
    ]);

    // Los técnicos salen con NOMBRE COMPLETO (las órdenes guardan el username del
    // legacy) y solo los que siguen en la empresa: este bloque mide a la gente, y
    // a quien ya no trabaja aquí no se le mide.
    const tr = await traductorDeTecnicos(this.prisma);
    const porTecnico = new Map<string, number>();
    for (const r of byTech) {
      if (!r.assigned || tr.inhabilitado(r.assigned)) continue;
      const nombre = tr.nombre(r.assigned)!;
      porTecnico.set(nombre, (porTecnico.get(nombre) ?? 0) + r._count._all);
    }

    return {
      total,
      excluidas,
      mesAMes,
      revisiones,
      sinAbonado: sede ? sinAbonado : 0,
      sede: sede ? sedes.find((b) => b.id === sede)?.name ?? null : null,
      porTipo: byType.map((r) => ({ tipo: r.type, count: r._count._all })),
      porEstado: byStatus.map((r) => ({ estado: r.status, count: r._count._all })),
      porTecnico: [...porTecnico.entries()]
        .map(([tecnico, count]) => ({ tecnico, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15),
      // Las opciones viajan en la propia respuesta, como en el reporte de técnicos:
      // así el filtro de la web nunca ofrece una sede que daría cero.
      opciones: { sedes: sedes.map((b) => ({ id: b.id, nombre: b.name })) },
    };
  }

  /**
   * Los 12 meses que terminan en el mes de `hasta`, sin cortes ni reconexiones: lo que
   * se compara de un mes a otro. Cada orden cae en el mes en que se CREÓ, así que la
   * fila de un mes no cambia al cerrarse después sus órdenes salvo en resueltas/abiertas.
   *
   * "Días para resolver" = día de cierre (`finalDate`, o `resolvedAt` en Colombia) menos
   * día de creación; 0 = el mismo día. Las resueltas sin ninguna de las dos fechas (435
   * en agosto, por el cierre de esa época) no entran al promedio.
   *
   * El mes en curso se marca `enCurso`: sus órdenes lentas aún no se han cerrado, así
   * que su promedio sale más bajo de lo que va a terminar siendo.
   */
  private async ordenesMesAMes(hasta?: string, sede?: string) {
    const fin = esFecha(hasta) ? hasta! : hoyEnColombia().toISOString().slice(0, 10);
    const hoy = hoyEnColombia().toISOString().slice(0, 7);
    const fSede = sede ? Prisma.sql`AND s."branchId" = ${sede}` : Prisma.empty;
    const cierre = Prisma.sql`COALESCE(t."finalDate", ((t."resolvedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date)`;
    const rows = await this.prisma.$queryRaw<{
      mes: string; creadas: number; resueltas: number; anuladas: number; abiertas: number;
      reclamos: number; instalaciones: number; conCierre: number; diasPromedio: number | null; enDosDias: number;
    }[]>`
      SELECT to_char(date_trunc('month', t.created), 'YYYY-MM') AS mes,
             COUNT(*)::int AS creadas,
             COUNT(*) FILTER (WHERE t.status = 'RESUELTO')::int AS resueltas,
             COUNT(*) FILTER (WHERE t.status = 'ANULADA')::int AS anuladas,
             COUNT(*) FILTER (WHERE t.status IN ('PENDIENTE', 'REALIZANDO'))::int AS abiertas,
             COUNT(*) FILTER (WHERE t.subject = 'reclamo' AND t.status <> 'ANULADA')::int AS reclamos,
             COUNT(*) FILTER (WHERE t.type ~* '^(instalaci[oó]n$|reinstalaci[oó]n)' AND t.status <> 'ANULADA')::int AS instalaciones,
             COUNT(*) FILTER (WHERE t.status = 'RESUELTO' AND ${cierre} IS NOT NULL)::int AS "conCierre",
             AVG(${cierre} - t.created) FILTER (WHERE t.status = 'RESUELTO')::float AS "diasPromedio",
             COUNT(*) FILTER (WHERE t.status = 'RESUELTO' AND ${cierre} - t.created <= 2)::int AS "enDosDias"
      FROM "Ticket" t
      LEFT JOIN "Subscriber" s ON s.id = t."subscriberId"
      WHERE t.type !~* '^(corte|reconex)'
        AND t.created >= (date_trunc('month', ${fin}::date) - interval '11 months')::date
        AND t.created <= ${fin}::date
        ${fSede}
      GROUP BY 1 ORDER BY 1`;
    return rows.map((r) => ({
      mes: r.mes,
      creadas: r.creadas, resueltas: r.resueltas, anuladas: r.anuladas, abiertas: r.abiertas,
      reclamos: r.reclamos, instalaciones: r.instalaciones,
      diasPromedio: r.diasPromedio == null ? null : round2(r.diasPromedio),
      // % de las resueltas CON fecha de cierre que se cerraron en ≤ 2 días.
      pctEnDosDias: r.conCierre ? Math.round((1000 * r.enDosDias) / r.conCierre) / 10 : null,
      enCurso: r.mes === hoy,
    }));
  }

  /** Estadísticas de la base de clientes por estado (y por sede). */
  async estadisticasServicios() {
    const [byStatus, byBranch] = await Promise.all([
      this.prisma.subscriber.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.$queryRaw<{ sede: string; total: number; activos: number; cortados: number; cartera: number }[]>`
        SELECT COALESCE(b.name,'Sin sede') sede, COUNT(*)::int total,
               COUNT(*) FILTER (WHERE s.status='ACTIVO')::int activos,
               COUNT(*) FILTER (WHERE s.status='CORTADO')::int cortados,
               COUNT(*) FILTER (WHERE s.status='CARTERA')::int cartera
        FROM "Subscriber" s LEFT JOIN "Branch" b ON b.id=s."branchId"
        GROUP BY b.name ORDER BY total DESC`,
    ]);
    const estados: Record<string, number> = {};
    for (const r of byStatus) estados[r.status ?? '—'] = r._count._all;
    return { estados, porSede: byBranch.map((r) => ({ sede: r.sede, total: Number(r.total), activos: Number(r.activos), cortados: Number(r.cortados), cartera: Number(r.cartera) })) };
  }

  /**
   * Cortes y activaciones por periodo, contados desde las ÓRDENES resueltas (fecha de
   * cierre) y comprobados en la bitácora del router. Las reglas y el porqué están en
   * `cortes-activaciones.ts`; aquí sólo van las tres consultas.
   *
   * Las fechas viajan como texto `::date` (ver sql-crudo: un `Date` atado se corre un
   * día). Las columnas con hora (`resolvedAt`, `MikrotikActionLog.createdAt`, el
   * historial) se guardan en UTC y se pasan al día de COLOMBIA antes de comparar.
   */
  async cortesActivaciones(from?: string, to?: string, sede?: string) {
    const hoy = hoyEnColombia().toISOString().slice(0, 10);
    const desde = esFecha(from) ? from! : `${hoy.slice(0, 8)}01`;
    const hasta = esFecha(to) ? to! : hoy;
    const fSede = sede ? Prisma.sql`AND s."branchId" = ${sede}` : Prisma.empty;
    // Día de cierre de la orden: `finalDate` (lo pone quien cierra); si falta, el día
    // de `resolvedAt` en Colombia; si sigue abierta, el de creación.
    const fechaOrden = Prisma.sql`COALESCE(t."finalDate", ((t."resolvedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date, t.created)`;
    const diaLog = Prisma.sql`((l."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date`;

    const [ordenes, retiros, router, sedes, nombre] = await Promise.all([
      this.prisma.$queryRaw<FilaOrden[]>`
        SELECT t.id, t.code, t.type AS tipo, t.status::text AS estado, t."createdByName" AS "creadoPor",
               to_char(${fechaOrden}, 'YYYY-MM-DD') AS fecha,
               s.id AS "clienteId", s.abonado, COALESCE(NULLIF(btrim(s."companyName"), ''), NULLIF(btrim(s."fullName"), ''), NULLIF(btrim(concat_ws(' ', s."firstName", s."lastName1", s."lastName2")), '')) AS nombre, b.name AS sede,
               EXISTS (
                 SELECT 1 FROM "MikrotikActionLog" l
                 WHERE l."subscriberId" = t."subscriberId" AND l.ok AND NOT l."dryRun"
                   AND l.action = ANY(CASE WHEN t.type ~* '^corte' THEN ARRAY['CUT','MOROSO_ON'] ELSE ARRAY['RECONNECT','MOROSO_OFF'] END)
                   AND ${diaLog} BETWEEN ${fechaOrden} - 1 AND ${fechaOrden} + 1
               ) AS "enRouter"
        FROM "Ticket" t
        JOIN "Subscriber" s ON s.id = t."subscriberId"
        LEFT JOIN "Branch" b ON b.id = s."branchId"
        WHERE t.type ~* ${TIPOS_SQL}
          AND t.created <= ${hasta}::date
          AND ${fechaOrden} BETWEEN ${desde}::date AND ${hasta}::date
          ${fSede}`,
      this.prisma.$queryRaw<RetiroSinOrden[]>`
        SELECT s.id AS "clienteId", s.abonado, COALESCE(NULLIF(btrim(s."companyName"), ''), NULLIF(btrim(s."fullName"), ''), NULLIF(btrim(concat_ws(' ', s."firstName", s."lastName1", s."lastName2")), '')) AS nombre, b.name AS sede,
               to_char(((h.date AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD') AS fecha, h.note AS nota
        FROM "SubscriberStatusHistory" h
        JOIN "Subscriber" s ON s.id = h."subscriberId"
        LEFT JOIN "Branch" b ON b.id = s."branchId"
        WHERE h.status = 'RETIRADO'
          AND ((h.date AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date BETWEEN ${desde}::date AND ${hasta}::date
          ${fSede}
        ORDER BY h.date`,
      // Lo que el router registró sin una orden de corte/reconexión de internet de ese
      // cliente en ±1 día: activaciones masivas, pasos a MOROSOS a mano, reconexiones
      // por pago que no dejaron orden.
      this.prisma.$queryRaw<{ fecha: string; accion: AccionRouterSinOrden['accion']; acciones: number; clientes: number }[]>`
        SELECT to_char(${diaLog}, 'YYYY-MM-DD') AS fecha, l.action AS accion,
               COUNT(*)::int AS acciones, COUNT(DISTINCT l."subscriberId")::int AS clientes
        FROM "MikrotikActionLog" l
        LEFT JOIN "Subscriber" s ON s.id = l."subscriberId"
        WHERE l.ok AND NOT l."dryRun" AND l.action IN ('CUT', 'RECONNECT', 'MOROSO_ON', 'MOROSO_OFF')
          AND ${diaLog} BETWEEN ${desde}::date AND ${hasta}::date
          ${fSede}
          AND NOT EXISTS (
            SELECT 1 FROM "Ticket" t
            WHERE t."subscriberId" = l."subscriberId" AND t.status <> 'ANULADA'
              AND t.type ~* (CASE WHEN l.action IN ('CUT', 'MOROSO_ON') THEN '^corte (internet|combo)' ELSE '^reconexion (internet|combo)' END)
              AND ${fechaOrden} BETWEEN ${diaLog} - 1 AND ${diaLog} + 1
          )
        GROUP BY 1, 2`,
      this.sedes(),
      this.nombreSede(sede),
    ]);

    return {
      desde, hasta,
      ...armarCortesActivaciones(ordenes, retiros, router),
      sede: nombre, notaSede: sede ? SEDE_NOTA : null,
      opciones: { sedes },
    };
  }

  /** Movimientos de clientes: altas vs retiros por periodo. */
  async movimientos(from?: string, to?: string, sede?: string) {
    // Las MISMAS definiciones que el Tablero ("Abonados nuevos" / "Retiros"): lo que dice
    // este reporte —y el bot por WhatsApp, que lo usa— tiene que ser lo que se ve en SAVES.
    // Antes contaba altas por `entryDate` (2 en un mes con decenas) y retiros por el
    // historial de estados (41 contra los 39 del Tablero). Ver `common/abonado-*.ts`.
    const desde = from ?? '2000-01-01';
    const hasta = to ?? hoyEnColombia().toISOString().slice(0, 10);
    const enSede: Prisma.SubscriberWhereInput = sede ? { branchId: sede } : {};

    // Agrupado por sede: un abonado está en una sola, así que sumar las sedes da el total
    // y la pregunta que sigue siempre ("¿de qué sede?") ya viene contestada.
    const [altasG, retirosG, sedes, nombre] = await Promise.all([
      this.prisma.subscriber.groupBy({ by: ['branchId'], _count: { _all: true }, where: { AND: [whereAbonadoNuevo(desde, hasta), enSede] } }),
      this.prisma.subscriber.groupBy({ by: ['branchId'], _count: { _all: true }, where: { AND: [whereRetiro(desde, hasta), enSede] } }),
      this.sedes(),
      this.nombreSede(sede),
    ]);
    const altasSede = altasG.map((r) => ({ sede: r.branchId, n: r._count._all }));
    const retirosSede = retirosG.map((r) => ({ sede: r.branchId, n: r._count._all }));
    const nombreDe = new Map(sedes.map((x) => [x.id, x.nombre]));
    const porSede = new Map<string, { sede: string; altas: number; retiros: number }>();
    const fila = (id: string | null) => {
      const k = id ?? '';
      if (!porSede.has(k)) porSede.set(k, { sede: (id && nombreDe.get(id)) || 'Sin sede', altas: 0, retiros: 0 });
      return porSede.get(k)!;
    };
    for (const r of altasSede) fila(r.sede).altas += r.n;
    for (const r of retirosSede) fila(r.sede).retiros += r.n;
    const altas = altasSede.reduce((a, r) => a + r.n, 0);
    const retiros = retirosSede.reduce((a, r) => a + r.n, 0);
    return {
      altas, retiros, neto: altas - retiros,
      porSede: [...porSede.values()]
        .map((r) => ({ ...r, neto: r.altas - r.retiros }))
        .sort((a, b) => b.altas - a.altas || b.retiros - a.retiros),
      sede: nombre, notaSede: sede ? SEDE_NOTA : null,
      opciones: { sedes },
    };
  }

  /**
   * Reporte de IVA (ventas o compras).
   *
   * NO replica el legacy (`Export::taxstatement_o` / `Reports::taxviewstatements_load`), que
   * era un listado plano inservible como reporte fiscal: no filtraba por estado (sumaba el
   * IVA de facturas ANULADAS), publicaba `total` con el IVA incluido y como texto
   * (`concat('COP ', total)`), no discriminaba base gravable, no separaba exentos, ignoraba
   * las retenciones y no tenía `ORDER BY` (su acumulado era no determinista).
   *
   * Aquí: se excluyen los documentos anulados, se discrimina base gravable / IVA / tarifa,
   * se separan los exentos, se expone la retención y el orden es estable.
   *
   * Las notas crédito/débito se aíslan en `ajustes` en vez de contaminar las bases: en
   * ventas se reconocen por `productName` (ojo: en `SubInvoiceItem` TODOS los ítems llevan
   * `productId = 0`, no sólo las notas) y en compras por `materialLegacy = 0`.
   */
  async iva(type: string, from?: string, to?: string, sede?: string) {
    const isPurchase = String(type).toLowerCase().startsWith('compra');
    const dr = range(from, to);
    // Fechas como TEXTO 'YYYY-MM-DD'::date: invoiceDate/orderDate son `date` y un Date de JS
    // atado en crudo se convierte a la zona de la sesión (Europe/Berlin) y corre el rango un
    // día — agosto se llevaba las 1.600 facturas del 1 de septiembre y perdía las del 1 de agosto.
    const gte = (dr?.gte ?? new Date('1900-01-01')).toISOString().slice(0, 10);
    const lte = (dr?.lte ?? new Date('2999-12-31')).toISOString().slice(0, 10);
    // La sede solo existe del lado de VENTAS: una compra es a un proveedor, que no
    // pertenece a ninguna sede. Se ignora en compras en vez de devolver vacío, y se
    // dice en la respuesta para que nadie crea que filtró.
    const sedeVentas = isPurchase ? undefined : sede;
    const fSede = sedeVentas ? Prisma.sql`AND s."branchId" = ${sedeVentas}` : Prisma.empty;
    // Solo las facturas que contabilidad decidió facturar electrónicamente: la marca
    // `eInvoiceFlag` se copia del abonado (pantalla de e-factura por sede) al nacer la
    // factura y pasa a 'Factura Electronica Creada' al emitirla. Es la decisión tal como
    // estaba ese mes —no la marca de hoy del abonado—, así que un mes viejo no cambia
    // porque se desmarque a alguien después.
    const fElectronica = Prisma.sql`AND i."eInvoiceFlag" IN ('Crear Factura Electronica', 'Factura Electronica Creada')`;

    const rows = isPurchase
      ? await this.prisma.$queryRaw<IvaRow[]>`
          SELECT o.tid::int AS numero, o."orderDate" AS fecha,
                 COALESCE(NULLIF(TRIM(p.name), ''), 'Sin proveedor') AS tercero, p.nit AS documento,
                 COALESCE(SUM(CASE WHEN it."taxRate" > 0 AND COALESCE(it."materialLegacy", -1) <> 0 THEN it.subtotal ELSE 0 END), 0)::float AS base_gravable,
                 COALESCE(SUM(CASE WHEN it."taxRate" = 0 AND COALESCE(it."materialLegacy", -1) <> 0 THEN it.subtotal ELSE 0 END), 0)::float AS base_exenta,
                 COALESCE(SUM(CASE WHEN it."materialLegacy" = 0 THEN it.subtotal ELSE 0 END), 0)::float AS ajustes,
                 COALESCE(SUM(it."taxTotal"), 0)::float AS iva,
                 o.total::float AS total,
                 o."retentionType" AS retencion_tipo, o.retention::float AS retencion
          FROM "SupplyOrder" o
          LEFT JOIN "Supplier" p ON p.id = o."supplierId"
          LEFT JOIN "SupplyOrderItem" it ON it."orderId" = o.id
          WHERE LOWER(o.status) NOT IN ('canceled', 'cancelada', 'anulada')
            AND o."orderDate" >= ${gte}::date AND o."orderDate" <= ${lte}::date
          GROUP BY o.id, p.name, p.nit
          ORDER BY o."orderDate", o.tid`
      : await this.prisma.$queryRaw<IvaRow[]>`
          SELECT i.tid::int AS numero, i."invoiceDate" AS fecha,
                 -- El nombre del tercero se arma como en topDeudores, y con NULLIF(TRIM(...)):
                 -- en esta base companyName es CADENA VACÍA (no NULL) para las 21.404
                 -- personas naturales, así que un COALESCE a secas nunca caía al
                 -- siguiente campo y la columna "Tercero" salía en blanco en TODO el
                 -- reporte —también en la pantalla web—. El nombre real vive en
                 -- firstName/lastName1: fullName solo está lleno en 7 registros.
                 COALESCE(
                   NULLIF(TRIM(s."companyName"), ''),
                   NULLIF(TRIM(s."fullName"), ''),
                   NULLIF(TRIM(CONCAT(s."firstName", ' ', s."lastName1")), ''),
                   'Sin cliente'
                 ) AS tercero, s."docNumber" AS documento,
                 COALESCE(SUM(CASE WHEN it."taxRate" > 0 AND COALESCE(it."productName", '') NOT IN ('Nota Credito', 'Nota Debito') THEN it.subtotal ELSE 0 END), 0)::float AS base_gravable,
                 COALESCE(SUM(CASE WHEN it."taxRate" = 0 AND COALESCE(it."productName", '') NOT IN ('Nota Credito', 'Nota Debito') THEN it.subtotal ELSE 0 END), 0)::float AS base_exenta,
                 COALESCE(SUM(CASE WHEN it."productName" IN ('Nota Credito', 'Nota Debito') THEN it.subtotal ELSE 0 END), 0)::float AS ajustes,
                 COALESCE(SUM(it."taxTotal"), 0)::float AS iva,
                 i.total::float AS total,
                 i."retentionType"::text AS retencion_tipo, 0::float AS retencion
          FROM "SubInvoice" i
          LEFT JOIN "Subscriber" s ON s.id = i."subscriberId"
          LEFT JOIN "SubInvoiceItem" it ON it."invoiceId" = i.id
          WHERE i.status <> 'CANCELED'
            AND i."invoiceDate" >= ${gte}::date AND i."invoiceDate" <= ${lte}::date
            ${fSede}
            ${fElectronica}
          GROUP BY i.id, s."companyName", s."fullName", s."firstName", s."lastName1", s."docNumber"
          ORDER BY i."invoiceDate", i.tid`;

    // Resumen por tarifa: la tarifa se deriva del IVA sobre la base (una factura puede
    // mezclar líneas al 19% y exentas, así que se reparte por línea, no por documento).
    const porTarifa = isPurchase
      ? await this.prisma.$queryRaw<TarifaRow[]>`
          SELECT it."taxRate"::float AS tarifa,
                 COALESCE(SUM(it.subtotal), 0)::float AS base,
                 COALESCE(SUM(it."taxTotal"), 0)::float AS iva,
                 COUNT(DISTINCT o.id)::int AS documentos
          FROM "SupplyOrder" o
          JOIN "SupplyOrderItem" it ON it."orderId" = o.id
          WHERE LOWER(o.status) NOT IN ('canceled', 'cancelada', 'anulada')
            AND COALESCE(it."materialLegacy", -1) <> 0
            AND o."orderDate" >= ${gte}::date AND o."orderDate" <= ${lte}::date
          GROUP BY it."taxRate" ORDER BY it."taxRate" DESC`
      : await this.prisma.$queryRaw<TarifaRow[]>`
          SELECT it."taxRate"::float AS tarifa,
                 COALESCE(SUM(it.subtotal), 0)::float AS base,
                 COALESCE(SUM(it."taxTotal"), 0)::float AS iva,
                 COUNT(DISTINCT i.id)::int AS documentos
          FROM "SubInvoice" i
          JOIN "SubInvoiceItem" it ON it."invoiceId" = i.id
          -- El JOIN al abonado existe SOLO para poder recortar por sede. Es LEFT y
          -- la relación es 1-1, así que no duplica filas ni altera los totales
          -- cuando no se filtra.
          LEFT JOIN "Subscriber" s ON s.id = i."subscriberId"
          WHERE i.status <> 'CANCELED'
            AND COALESCE(it."productName", '') NOT IN ('Nota Credito', 'Nota Debito')
            AND i."invoiceDate" >= ${gte}::date AND i."invoiceDate" <= ${lte}::date
            ${fSede}
            ${fElectronica}
          GROUP BY it."taxRate" ORDER BY it."taxRate" DESC`;

    const items = rows.map((r) => ({
      numero: Number(r.numero),
      fecha: r.fecha,
      tercero: r.tercero,
      documento: r.documento ?? null,
      baseGravable: Number(r.base_gravable),
      baseExenta: Number(r.base_exenta),
      ajustes: Number(r.ajustes),
      iva: Number(r.iva),
      total: Number(r.total),
      retencionTipo: r.retencion_tipo ?? null,
      retencion: Number(r.retencion),
    }));
    const sum = (k: keyof (typeof items)[number]) => items.reduce((a, b) => a + (Number(b[k]) || 0), 0);

    return {
      tipo: isPurchase ? 'compras' : 'ventas',
      desde: dr?.gte ?? null,
      hasta: dr?.lte ?? null,
      sede: await this.nombreSede(sedeVentas),
      // Se avisa cuando se pidió sede en compras: el reporte NO está filtrado y sin
      // esto parecería que sí (las cifras siempre parecen razonables).
      sedeIgnorada: !!sede && isPurchase,
      opciones: { sedes: await this.sedes() },
      items,
      porTarifa: porTarifa.map((t) => ({
        tarifa: Number(t.tarifa), base: Number(t.base), iva: Number(t.iva), documentos: Number(t.documentos),
      })),
      totales: {
        documentos: items.length,
        baseGravable: round2(sum('baseGravable')),
        baseExenta: round2(sum('baseExenta')),
        ajustes: round2(sum('ajustes')),
        iva: round2(sum('iva')),
        total: round2(sum('total')),
        retencion: round2(sum('retencion')),
      },
    };
  }

  /** Top clientes deudores. */
  /** Seguimiento mensual de la cartera: qué pasó con cada abonado tras la gestión de cobro. */
  carteraSeguimiento(mes?: string, sede?: string, categoria?: string) {
    return seguimientoCartera(this.prisma, { mes, sede, categoria });
  }

  gestionarCartera(mes: string, subscriberId: string, cambios: { categoria?: string | null; observaciones?: string | null }, userId: string) {
    return gestionar(this.prisma, mes, subscriberId, cambios, userId);
  }

  async topDeudores(sede?: string) {
    const fSede = sede ? Prisma.sql`AND s."branchId" = ${sede}` : Prisma.empty;
    const [rows, sedes, nombre] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; name: string; abonado: number; bal: number; facturas: number }[]>`
        SELECT s.id, COALESCE(NULLIF(TRIM(s."fullName"),''), TRIM(CONCAT(s."firstName",' ',s."lastName1")), s."companyName",'—') name,
               s.abonado, SUM(i.total - i."paidAmount")::float bal, COUNT(*)::int facturas
        FROM "SubInvoice" i JOIN "Subscriber" s ON s.id = i."subscriberId"
        WHERE i.status IN ('DUE','PARTIAL') ${fSede}
        GROUP BY s.id, name, s.abonado ORDER BY bal DESC LIMIT 30`,
      this.sedes(),
      this.nombreSede(sede),
    ]);
    return {
      sede: nombre,
      items: rows.map((r) => ({ id: r.id, name: (r.name || '—').trim(), abonado: Number(r.abonado), balance: Number(r.bal), facturas: Number(r.facturas) })),
      opciones: { sedes },
    };
  }
}
