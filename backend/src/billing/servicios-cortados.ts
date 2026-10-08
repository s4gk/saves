import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { contratadoEnFactura } from '../common/servicios-del-abonado';

/**
 * SERVICIO CORTADO NO SE FACTURA.
 *
 * La corrida del 01-10-2026 le cobró el servicio a 223 abonados que lo tenían
 * cortado (caso que lo destapó: abonado 56671, cortado el 30-09 y facturado por
 * 77.000 al día siguiente). Dos cosas se juntaban:
 *
 *   · el corte por servicio —el masivo del Mikrotik, el de TV, el cierre de una orden
 *     de corte— NO cambia `Subscriber.status`: el abonado sigue ACTIVO y entra a la
 *     población de la corrida;
 *   · la corrida sólo cargaba los `SubscriberService` en ACTIVO, y al no encontrar
 *     ninguno lo tomaba por un abonado "sin filas" (el hueco de la migración) y le
 *     deducía el plan de sus facturas viejas: el servicio cortado volvía a cobrarse.
 *
 * El legacy nunca lo hizo: `Invoices_model::generar_facturas_logica` emite el renglón
 * de un servicio sólo si `estado_tv` / `estado_combo` de la última recurrente está en
 * NULL, y copia esas dos columnas a la factura nueva. Esto es esa misma regla.
 *
 * LA FUENTE ES LA FACTURA, no `SubscriberService.status`, igual que en la ficha (ver
 * `SubscribersService.estadoPorServicio`). La fila no es de fiar en ninguna de las dos
 * direcciones: el lote de TV del 21-09 dejó 115 filas en CORTADO de clientes que
 * pagaron y a los que la factura ya les levantó el corte. Decidir por la fila les
 * habría quitado la televisión de la factura estando al día.
 */
export type Corte = {
  /** Nombre del plan y estado tal como los trae la factura que dicta el corte. */
  serviceCombo: string | null;
  serviceTv: string | null;
  estadoCombo: string | null;
  estadoTv: string | null;
};

const caido = (v?: string | null) => !!v && v !== 'ACTIVO';

/** ¿Qué servicios da por caídos esa factura? Sólo los que NOMBRA (candado del 'no'). */
export function serviciosCaidos(c?: Corte | null): { INTERNET: boolean; TV: boolean } {
  return {
    INTERNET: !!c && contratadoEnFactura(c.serviceCombo) && caido(c.estadoCombo),
    TV: !!c && contratadoEnFactura(c.serviceTv) && caido(c.estadoTv),
  };
}

/**
 * Aparta de lo facturable lo que está cortado. Los PUNTOS son decos de televisión:
 * corren la suerte de la TV. El STREAMING y lo demás no tienen corte propio.
 */
export function quitarCortados<T extends { kind: string }>(
  servicios: T[],
  c?: Corte | null,
): { cobrables: T[]; cortados: T[] } {
  const k = serviciosCaidos(c);
  const cortado = (s: T) =>
    (s.kind === 'INTERNET' && k.INTERNET) || ((s.kind === 'TV' || s.kind === 'PUNTOS') && k.TV);
  return { cobrables: servicios.filter((s) => !cortado(s)), cortados: servicios.filter(cortado) };
}

/**
 * Lo que dicen las ÓRDENES: por servicio, ¿la última orden RESUELTA que habla de él
 * es un corte? Sólo las órdenes no bastan para decir que alguien está cortado (las
 * reconexiones no siempre dejan orden), por eso quien llama exige además que no haya
 * pagado nada desde el corte.
 */
export type CorteSegunOrdenes = { INTERNET: boolean; TV: boolean };

/**
 * Le suma a la factura el corte que dicen las órdenes y que ELLA perdió.
 *
 * Sólo AÑADE cortes, nunca los quita: si la factura dice cortado, cortado está. Y sólo
 * en el servicio que la factura nombra (el candado del 'no' de `serviciosCaidos`): una
 * 'Corte Combo' a quien sólo tiene televisión no le inventa un internet cortado.
 */
export function sumarCortesDeOrdenes(c: Corte | null | undefined, o?: CorteSegunOrdenes | null): Corte | null {
  if (!c) return null;
  if (!o || (!o.INTERNET && !o.TV)) return c;
  return {
    ...c,
    estadoCombo: o.INTERNET && !caido(c.estadoCombo) ? 'CORTADO' : c.estadoCombo,
    estadoTv: o.TV && !caido(c.estadoTv) ? 'CORTADO' : c.estadoTv,
  };
}

/** Cuántos días hacia atrás cuenta una orden de corte (igual que `cortes-deshechos`). */
export const DIAS_CORTE_POR_ORDEN = 60;

/**
 * El corte vigente de cada abonado: `estadoTv`/`estadoCombo` de su última factura
 * RECURRENTE viva anterior a `before` (el mes que se va a facturar). Sólo devuelve a
 * quienes tienen algo caído.
 *
 * SEGUNDA FUENTE, LAS ÓRDENES (07-10-2026). La marca de la factura se puede perder
 * por el camino —el writeback de reconexiones se la borraba en el legacy con una
 * reconexión ANTERIOR al corte y la ida la traía de vuelta vacía—, y entonces la
 * corrida le cobraba el mes completo a quien tenía la orden de corte cerrada: abonado
 * 51854, «Corte Combo» #510765 cerrada el 30-09 y octubre facturado por 77.000 (50
 * casos en octubre). Por eso, además de la factura, se mira el rastro de órdenes: si
 * la última orden RESUELTA de un servicio en los últimos `DIAS_CORTE_POR_ORDEN` días es
 * un 'Corte …' y el cliente NO ha pagado nada desde ese día, el servicio está cortado
 * aunque la factura lo haya olvidado. El pago es el freno: quien paga se reconecta (y
 * si no se pudo, queda una 'Reconexion …' pendiente, que no cuenta como reconectado).
 */
export async function cortesVigentes(
  prisma: PrismaService,
  ids: string[],
  before: Date,
): Promise<Map<string, Corte>> {
  const por = new Map<string, Corte>();
  if (!ids.length) return por;
  // Como texto y con `::date`: un `Date` de JS viaja como `timestamptz` y la sesión
  // de Postgres (Europe/Berlin) corre el corte un día — la factura del día 1 del
  // propio mes pasaría por "anterior" y, recién nacida, no trae ningún corte.
  const antes = before.toISOString().slice(0, 10);
  const [filas, ordenes] = await Promise.all([
    prisma.$queryRaw<({ subscriberId: string } & Corte)[]>`
      SELECT DISTINCT ON (i."subscriberId")
             i."subscriberId", i."serviceCombo", i."serviceTv",
             i."estadoCombo"::text AS "estadoCombo", i."estadoTv"::text AS "estadoTv"
        FROM "SubInvoice" i
       WHERE i."subscriberId" IN (${Prisma.join(ids)})
         AND i.kind = 'RECURRENTE'
         AND i.status <> 'CANCELED'
         AND i."invoiceDate" < ${antes}::date
       ORDER BY i."subscriberId", i."invoiceDate" DESC, i.tid DESC`,
    cortesSegunOrdenes(prisma, ids, antes),
  ]);
  for (const { subscriberId, ...factura } of filas) {
    const c = sumarCortesDeOrdenes(factura, ordenes.get(subscriberId))!;
    const k = serviciosCaidos(c);
    if (k.INTERNET || k.TV) por.set(subscriberId, c);
  }
  return por;
}

/**
 * Por abonado, qué servicios da por cortados el rastro de órdenes (ver arriba). Sólo
 * devuelve a quienes tienen alguno. `antes` es 'AAAA-MM-DD' (el día 1 del mes).
 *
 * La última orden se elige por `created` y, en el mismo día, por `code` (el
 * consecutivo, compartido con el legacy): un corte y su reconexión suelen caer el
 * mismo día. Sólo cuentan las RESUELTAS: un corte pendiente no se ha hecho, y una
 * reconexión pendiente no ha devuelto nada.
 */
async function cortesSegunOrdenes(
  prisma: PrismaService,
  ids: string[],
  antes: string,
): Promise<Map<string, CorteSegunOrdenes>> {
  const filas = await prisma.$queryRaw<{ sid: string; svc: 'INTERNET' | 'TV' }[]>`
    WITH o AS (
      SELECT t."subscriberId" AS sid, t.code, t.type, t.created
        FROM "Ticket" t
       WHERE t."subscriberId" IN (${Prisma.join(ids)})
         AND t.status = 'RESUELTO'
         AND t.created >= ${antes}::date - ${DIAS_CORTE_POR_ORDEN}::int
         AND t.created < ${antes}::date
         AND (t.type ILIKE 'corte%' OR t.type ILIKE 'reconex%')
    ), ult AS (
      (SELECT DISTINCT ON (sid) sid, 'INTERNET' AS svc, type, created
         FROM o WHERE type ~* 'internet|combo'
        ORDER BY sid, created DESC, code DESC NULLS LAST)
      UNION ALL
      (SELECT DISTINCT ON (sid) sid, 'TV' AS svc, type, created
         FROM o WHERE type ~* 'television|combo'
        ORDER BY sid, created DESC, code DESC NULLS LAST)
    )
    SELECT u.sid, u.svc
      FROM ult u
     WHERE u.type ILIKE 'corte%'
       AND NOT EXISTS (
         SELECT 1 FROM "Transaction" x
          WHERE x."subscriberId" = u.sid
            AND x.type = 'INCOME' AND x.status = 'VIGENTE'
            AND x.date >= u.created)`;
  const por = new Map<string, CorteSegunOrdenes>();
  for (const { sid, svc } of filas) {
    const c = por.get(sid) ?? { INTERNET: false, TV: false };
    c[svc] = true;
    por.set(sid, c);
  }
  return por;
}
