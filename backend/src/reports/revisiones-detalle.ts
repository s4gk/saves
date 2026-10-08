import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hoyEnColombia } from '../common/fecha-colombia';

/**
 * El detalle de las REVISIONES, que son la mayoría de las órdenes: 673 de las 1.001
 * de septiembre (378 de internet, 173 de TV, 121 de las dos). Hasta ahora el reporte
 * de órdenes decía cuántas revisiones hubo y nada más, y "cuántas" no se puede
 * arreglar: lo que se arregla es *de qué* se queja la gente y *dónde* está pasando.
 *
 * Son cuatro preguntas, y cada una se contesta con un dato que ya existe en la base
 * pero que ninguna pantalla cruzaba:
 *
 *   · de qué    → el texto del reclamo (`Ticket.section`), clasificado en síntomas
 *   · de dónde  → el barrio del abonado
 *   · por dónde → la caja NAP y la VLAN por donde entra ese abonado
 *   · a quién   → los clientes que llamaron tres veces o más en el periodo
 *
 * Las dos del medio son las que convierten el reporte en algo accionable: veinte
 * revisiones repartidas por toda la ciudad son veinte casas; cinco en la misma caja
 * son UNA caja. Es la diferencia entre mandar cinco técnicos y mandar uno.
 */

/** Las órdenes que son una revisión (de internet, de TV, de las dos, de red LAN). */
export const ES_REVISION = Prisma.sql`t.type ~* 'revisi'`;

/**
 * Síntoma de cada revisión, deducido del texto que escribe la cajera al abrirla.
 *
 * Es texto libre de verdad ("indica servicio es demasiado intermitente todo el
 * tiempo falla bastante"), así que esto NO es una clasificación exacta y no se
 * presenta como tal: es la forma de ver que un tercio de las revisiones son
 * intermitencia y no equipos quemados, que es una decisión de red distinta.
 *
 * ORDEN IMPORTA: gana el primero que coincida. "sin señal de TV desde ayer" es
 * quedarse sin servicio, no una falla de señal intermitente, y por eso «Sin
 * servicio» va antes que «Intermitencia». Los patrones llevan las dos escrituras
 * de cada palabra (`se[nñ]al`, `conexi[oó]n`) porque el legacy trae de todo —ver
 * caracteres-perdidos-legacy— y una tilde perdida no debe mover el conteo.
 */
const SINTOMAS: { nombre: string; patron: string }[] = [
  // Va primero porque es la que NO es un problema de red: el cliente pagó y el
  // sistema no lo reconectó, así que la visita del técnico sobra (ver
  // reconexion-automatica-pago y pago-anterior-al-corte). Verlas juntas es poder
  // decir cuántas revisiones no debieron existir.
  { nombre: 'Pagó y no le volvió',
    patron: 'pag(o|ó|aron|u[eé]) .{0,40}(no|sin) .{0,25}(activ|reconect|servicio|lleg|volvi)|ya pag[oó]' },
  { nombre: 'Sin servicio',
    patron: 'sin servicio|sin internet|sin se[nñ]al|sin tv|sin televisi[oó]n|sin canales|sin conexi[oó]n|sin red|no (tienen?|cuenta con|puede acceder a|hay|tengo) (el |la |de |a )*(servicio|internet|se[nñ]al|tv|televisi[oó]n|red)|no (le )?llega (el |la )?(servicio|se[nñ]al|internet)|no navega|offline|fuera de (linea|línea)|se qued[oó] sin|nunca (a|ha) tenido' },
  { nombre: 'Intermitencia',
    patron: 'intermit|se (va|cae|corta)|falla|fallas|por ratos|a cada rato|se desconecta|inestable|parpade' },
  { nombre: 'Lentitud',
    patron: 'lent|velocidad|no (le )?da (la )?veloc|baja (la )?veloc|demor' },
  // Antes que WiFi y que Equipo: "configurar el wifi" y "sincronizar el deco" son
  // trabajo de configuración, no una falla del servicio.
  { nombre: 'Configuración y sincronización',
    patron: 'sincroniz|configur|se activa|activar (la |el )?(zona|cav|tv)|instalar tdt|acomodar|ense[nñ]ar|explicar|no sabe' },
  { nombre: 'WiFi y cobertura',
    patron: 'wifi|wi-?fi|clave|contrase[nñ]a|cobertura|alcance|no coge|repetidor|extensor|cuartos' },
  { nombre: 'Equipo del cliente',
    patron: 'equipo|router|onu|ont|modem|m[oó]dem|decodificador|deco|control|bombillo|no prende|apagad|quemad|rayo|da[nñ]ad|wan' },
  { nombre: 'Imagen y canales de TV',
    patron: 'canal|imagen|pixel|congel|se ve mal|audio|sonido' },
  { nombre: 'Acometida y cableado',
    patron: 'cable|acometida|fibra|poste|tensionad|mordi|roedor|empalme|revent|cortad[oa]' },
];

/** El `CASE` que pinta el síntoma, armado de `SINTOMAS` para no repetir la lista. */
const sintomaSql = Prisma.sql`CASE ${Prisma.join(
  SINTOMAS.map((s) => Prisma.sql`WHEN t.section ~* ${s.patron} THEN ${s.nombre}`),
  ' ',
)} ELSE ${'Sin clasificar'} END`;

/**
 * Qué servicio se revisa, sacado del tipo de la orden. El combo va PRIMERO: su tipo
 * ("Revision tv e internet") contiene las dos palabras y cualquier otro orden lo
 * contaría como internet y escondería que es una revisión doble.
 */
const servicioSql = Prisma.sql`CASE
  WHEN t.type ~* '(tv|televis).*internet|internet.*(tv|televis)' THEN 'combo'
  WHEN t.type ~* 'internet' THEN 'internet'
  WHEN t.type ~* 'tv|televis' THEN 'tv'
  ELSE 'otro' END`;

export type RevisionesDetalle = {
  total: number;
  sinBarrio: number;
  sinCaja: number;
  porSintoma: { sintoma: string; total: number; internet: number; tv: number; combo: number }[];
  porBarrio: { barrio: string; sede: string | null; revisiones: number; clientes: number; abonados: number | null; por100: number | null }[];
  /**
   * Revisiones por cada 100 abonados de TODA la base medida, que es con lo que hay
   * que comparar la cifra de cada barrio. Un umbral fijo no sirve: en un mes la media
   * anda por 3 y en doce meses por 35, así que "15 es mucho" sería verdad en marzo y
   * mentira en el acumulado del año.
   */
  por100Promedio: number | null;
  porCaja: { caja: string; vlan: number | null; detalle: string | null; sede: string | null; puertos: number | null; revisiones: number; clientes: number }[];
  porVlan: { vlan: number | null; detalle: string | null; olt: string | null; sede: string | null; revisiones: number; clientes: number }[];
  porTecnologia: { tecnologia: string; revisiones: number }[];
  reincidentes: { id: string; abonado: number; nombre: string | null; barrio: string; caja: string | null; sede: string | null; revisiones: number; sintomas: string | null; ultima: string }[];
  /** Ventana que se midió de verdad, para que la pantalla la pueda decir. */
  desde: string;
  hasta: string;
};

/**
 * Todo el bloque en UNA consulta. Son siete agregados sobre el mismo conjunto de
 * órdenes, y resolver ese conjunto es la parte cara (el barrio, la caja y la VLAN
 * del abonado son cuatro joins); repetirlo siete veces era pagarlo siete veces en un
 * reporte que ya hace nueve consultas. Ver postgres-conexiones-compartidas: la base
 * la comparten el legacy y el ERP, y una consulta de reporte menos es una conexión
 * menos ocupada.
 *
 * Las fechas viajan como texto `::date` a propósito (ver sql-crudo-fechas-date: un
 * `Date` atado se corre un día), y `Ticket.created` es `@db.Date`, sin hora.
 */
export async function revisionesDetalle(
  prisma: PrismaService,
  from?: string,
  to?: string,
  sede?: string,
): Promise<RevisionesDetalle> {
  // Sin fechas, los últimos 12 meses: los mismos que la tabla "Mes a mes" de arriba.
  // Es a propósito que este bloque NO abarque toda la historia cuando el filtro está
  // vacío: una caja que dio guerra en 2023 y se cambió el año pasado seguiría arriba
  // de la lista tapando la que está mala HOY, que es para lo que se mira esto. La
  // ventana viaja en la respuesta y la pantalla la dice.
  const hasta = to ?? hoyEnColombia().toISOString().slice(0, 10);
  const [anio, mes] = hasta.split('-').map(Number);
  // Primer día del mes 11 meses atrás = 12 meses contando el de `hasta`, igual que
  // `date_trunc('month', fin) - interval '11 months'` en ordenesMesAMes.
  const desde = from ?? new Date(Date.UTC(anio, mes - 12, 1)).toISOString().slice(0, 10);
  const fSede = sede ? Prisma.sql`AND s."branchId" = ${sede}` : Prisma.empty;
  const fSedeBase = sede ? Prisma.sql`AND s."branchId" = ${sede}` : Prisma.empty;

  const [row] = await prisma.$queryRaw<{ r: RevisionesDetalle }[]>`
    WITH rev AS (
      SELECT t.id,
             t.created,
             s.id   AS sid,
             s.abonado,
             -- fullName es un cache y está lleno en 7 de 21.828 fichas: el nombre
             -- se recompone, igual que en topDeudores y en rendimiento de técnicos.
             COALESCE(
               NULLIF(btrim(s."companyName"), ''),
               NULLIF(btrim(s."fullName"), ''),
               NULLIF(btrim(concat_ws(' ', s."firstName", s."lastName1", s."lastName2")), '')
             ) AS nombre,
             COALESCE(NULLIF(trim(n.name), ''), 'Sin barrio') AS barrio,
             b.name AS sede,
             nap.name AS caja,
             nap."portCount" AS puertos,
             v.vlan,
             NULLIF(trim(COALESCE(v.detail, '')), '') AS vlan_detalle,
             COALESCE(o.name, NULLIF(trim(COALESCE(v.olt, '')), '')) AS olt,
             COALESCE(s."installTech"::text, 'Sin dato') AS tecnologia,
             ${sintomaSql} AS sintoma,
             ${servicioSql} AS servicio
      FROM "Ticket" t
      -- Sin abonado no hay barrio, ni caja, ni VLAN: una revisión suelta no se puede
      -- ubicar y no entra a este bloque (son 7 en toda la base; el total de arriba
      -- sí las cuenta).
      JOIN "Subscriber" s ON s.id = t."subscriberId"
      LEFT JOIN "Neighborhood" n ON n."legacyId"::text = s.neighborhood
      LEFT JOIN "Branch" b ON b.id = s."branchId"
      -- Un puerto por abonado: hay 9 con dos puertos asignados y un JOIN normal los
      -- contaría dos veces, inflando justo las filas que se van a mirar primero.
      LEFT JOIN LATERAL (
        SELECT p."napId" FROM "Port" p
        WHERE p."subscriberId" = s.id AND p."napId" IS NOT NULL
        ORDER BY p.port LIMIT 1
      ) pp ON TRUE
      LEFT JOIN "Nap" nap ON nap.id = pp."napId"
      LEFT JOIN "Vlan" v  ON v.id = nap."vlanId"
      LEFT JOIN "Olt" o   ON o.id = v."oltId"
      WHERE ${ES_REVISION}
        -- Una orden anulada no es una revisión: se abrió por error o se duplicó.
        AND t.status <> 'ANULADA'
        AND t.created >= ${desde}::date
        AND t.created <= ${hasta}::date
        ${fSede}
    ),
    -- Cuántos abonados vivos tiene cada barrio, para poder decir "27 revisiones" y
    -- "cuántas por cada 100 clientes" en la misma fila. Sin esa segunda cifra el
    -- reporte sólo señala a los barrios grandes, que es paridad-legacy-vs-claridad:
    -- el número es correcto y la conclusión que sugiere es falsa.
    base AS (
      SELECT COALESCE(NULLIF(trim(n.name), ''), 'Sin barrio') AS barrio,
             b.name AS sede,
             COUNT(*)::int AS abonados
      FROM "Subscriber" s
      LEFT JOIN "Neighborhood" n ON n."legacyId"::text = s.neighborhood
      LEFT JOIN "Branch" b ON b.id = s."branchId"
      WHERE (s.status IS NULL OR s.status::text NOT IN ('RETIRADO', 'DEPURADO'))
        ${fSedeBase}
      GROUP BY 1, 2
    )
    SELECT json_build_object(
      'total', (SELECT COUNT(*)::int FROM rev),
      'sinBarrio', (SELECT COUNT(*)::int FROM rev WHERE barrio = 'Sin barrio'),
      'sinCaja', (SELECT COUNT(*)::int FROM rev WHERE caja IS NULL),
      'por100Promedio', (SELECT CASE WHEN SUM(abonados) > 0
                                     THEN round(100.0 * (SELECT COUNT(*) FROM rev) / SUM(abonados), 1)::float
                                     END FROM base),
      'porSintoma', COALESCE((SELECT json_agg(x) FROM (
        SELECT sintoma,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE servicio = 'internet')::int AS internet,
               COUNT(*) FILTER (WHERE servicio = 'tv')::int AS tv,
               COUNT(*) FILTER (WHERE servicio = 'combo')::int AS combo
        FROM rev GROUP BY 1 ORDER BY 2 DESC
      ) x), '[]'::json),
      'porBarrio', COALESCE((SELECT json_agg(x) FROM (
        SELECT r.barrio, r.sede,
               COUNT(*)::int AS revisiones,
               COUNT(DISTINCT r.sid)::int AS clientes,
               ba.abonados,
               CASE WHEN COALESCE(ba.abonados, 0) > 0
                    THEN round(100.0 * COUNT(*) / ba.abonados, 1)::float
                    ELSE NULL END AS "por100"
        FROM rev r
        LEFT JOIN base ba ON ba.barrio = r.barrio AND ba.sede IS NOT DISTINCT FROM r.sede
        GROUP BY r.barrio, r.sede, ba.abonados
        ORDER BY 3 DESC, 4 DESC LIMIT 25
      ) x), '[]'::json),
      'porCaja', COALESCE((SELECT json_agg(x) FROM (
        SELECT caja, vlan, vlan_detalle AS detalle, sede, puertos,
               COUNT(*)::int AS revisiones,
               COUNT(DISTINCT sid)::int AS clientes
        FROM rev WHERE caja IS NOT NULL
        GROUP BY 1, 2, 3, 4, 5 ORDER BY 6 DESC, 7 DESC LIMIT 25
      ) x), '[]'::json),
      'porVlan', COALESCE((SELECT json_agg(x) FROM (
        SELECT vlan, vlan_detalle AS detalle, olt, sede,
               COUNT(*)::int AS revisiones,
               COUNT(DISTINCT sid)::int AS clientes
        FROM rev WHERE vlan IS NOT NULL
        GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC, 6 DESC LIMIT 20
      ) x), '[]'::json),
      'porTecnologia', COALESCE((SELECT json_agg(x) FROM (
        SELECT tecnologia, COUNT(*)::int AS revisiones
        FROM rev GROUP BY 1 ORDER BY 2 DESC
      ) x), '[]'::json),
      -- Tres visitas al mismo cliente en el periodo es una falla que no se arregló.
      -- Es la fila que más duele y la que nadie podía ver sin abrir ficha por ficha.
      'reincidentes', COALESCE((SELECT json_agg(x) FROM (
        SELECT sid AS id, abonado, nombre, barrio, caja, sede,
               COUNT(*)::int AS revisiones,
               string_agg(DISTINCT sintoma, ' · ' ORDER BY sintoma) AS sintomas,
               to_char(MAX(created), 'YYYY-MM-DD') AS ultima
        FROM rev
        GROUP BY 1, 2, 3, 4, 5, 6
        HAVING COUNT(*) >= 3
        ORDER BY 7 DESC, 9 DESC LIMIT 30
      ) x), '[]'::json)
    ) AS r`;

  return { ...row.r, desde, hasta };
}
