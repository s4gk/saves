import 'reflect-metadata';
/**
 * Cierre masivo de las órdenes 'Corte Television' que deja abiertas un lote de TV.
 * Nació para el lote del 30-09-2026 en Monterrey (29 órdenes, #510560 … #510624) y
 * desde el 01-10-2026 recibe el lote por parámetro (ese día: 12 de Villanueva).
 *
 * Sólo toca las del LOTE (`createdBySource = 'SISTEMA'`): las 'Corte Television' que
 * alguien abrió a mano desde la ficha se quedan como están.
 *
 * POR QUÉ EXISTE. Con `network.tvSoloSistema` encendido (TR-069 en pausa), el lote
 * de TV marca el corte en el sistema y abre la orden PENDIENTE a propósito: el corte
 * físico lo hace un técnico en sitio y la cierra él (ver `registrarCorteDeTv` en
 * genieacs.service.ts, 23-09-2026). Cuando el corte ya se hizo, las órdenes son papeleo
 * pendiente: el corte está escrito en la factura (`estadoTv = CORTADO`) y lo único que
 * falta es la constancia de que el trabajo se hizo.
 *
 * NO se reimplementa el cierre: se llama a `updateStatus`, el mismo camino que la
 * pantalla, para que la cascada haga lo suyo (marca la línea de TV, reescribe el
 * corte en la factura y lo empuja al legacy). Si el rescate pasara por otro lado
 * probaría otra cosa distinta de la que corre todos los días.
 *
 * LA FIRMA. Cerrar una orden pide la firma de quien recibe, y en un corte no hay
 * nadie enfrente que firme —el mismo motivo por el que las reconexiones están
 * exentas (`esReconexion`)—. Aquí se apaga el requisito SOLO en este proceso: el
 * servidor de PM2 la sigue pidiendo. El día que se quiera arreglar de raíz, la
 * exención va en `order-types.ts` junto a la de las reconexiones y este script
 * sobra.
 *
 * Uso:  npx ts-node --transpile-only scripts/cerrar-cortes-tv-lote.ts --lote=2026-10-01 --esperadas=12 [--aplicar]
 * Sin `--aplicar` sólo dice qué haría.
 */

// Antes de cualquier llamada al servicio: `updateStatus` lee la variable en el
// momento de cerrar, y este proceso es el único que la ve apagada.
process.env.TICKET_REQUIRE_SIGNATURE = 'false';

import { prismaService, supportWriteService } from '../src/core/contenedor';
import type { AuthUser } from '../src/auth/current-user.decorator';

const arg = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1];

/**
 * `finalDate` = el día del corte, no hoy: es la fecha del trabajo y es la que leen los
 * informes de cortes mes a mes. El sello de cuándo se cerró de verdad lo pone el
 * sistema aparte en `resolvedAt`, que no se puede escribir a mano.
 */
const FECHA_DEL_TRABAJO = arg('lote') ?? '';
if (!/^\d{4}-\d{2}-\d{2}$/.test(FECHA_DEL_TRABAJO) || !/^\d+$/.test(arg('esperadas') ?? '')) {
  console.error('Faltan --lote=AAAA-MM-DD (día en que se corrió el lote) y --esperadas=N (cuántas órdenes se revisaron).');
  process.exit(1);
}

/** El lote que se está cerrando: un día y sólo lo que abrió el lote. */
const LOTE = {
  tipo: 'Corte Television',
  creadas: new Date(`${FECHA_DEL_TRABAJO}T00:00:00.000Z`),
  fuente: 'SISTEMA',
  /** Cuántas se esperan. Si no cuadra, el script no escribe: algo cambió. */
  esperadas: Number(arg('esperadas')),
};
const DIA_SIGUIENTE = new Date(LOTE.creadas.getTime() + 24 * 60 * 60 * 1000);

const ddmmaaaa = (iso: string) => iso.split('-').reverse().join('-');

/** La constancia que queda escrita en cada orden. */
const CONSTANCIA =
  `Cerrada en el cierre masivo del ${ddmmaaaa(new Date().toISOString().slice(0, 10))}, por solicitud del dueño: el corte de `
  + `televisión del lote del ${ddmmaaaa(FECHA_DEL_TRABAJO)} ya estaba aplicado (la factura venía con la TV `
  + 'en CORTADO) y la orden quedó abierta sólo por el papeleo del corte en sitio.';

/**
 * Quien firma el cierre. Con nombre propio y no 'Sistema': quedan órdenes
 * resueltas en el historial de los clientes y tiene que poder preguntarse quién las
 * cerró y por qué.
 */
const USUARIO: AuthUser = {
  id: 'script-cierre-cortes-tv',
  name: `Cierre masivo cortes de TV (${ddmmaaaa(FECHA_DEL_TRABAJO).slice(0, 5)})`,
  email: 'soporte@vestel.com.co',
  areas: [], sedes: [], superuser: true,
} as unknown as AuthUser;

const APLICAR = process.argv.includes('--aplicar');

/**
 * ¿Hay que dejar esta orden quieta? El caso que importa: el cliente YA volvió al
 * aire —pagó y lo reconectaron, o alguien le devolvió la televisión— y entonces
 * cerrar su corte sería cortarle la TV a quien está al día. Hoy no hay ninguno, pero
 * entre esta lectura y la corrida puede entrar un pago en caja.
 *
 * El sistema ya tiene esta regla para el camino del pago: `ReconexionService` ANULA
 * la 'Corte Television' pendiente de quien pagó antes del corte. Aquí sólo se
 * respeta: lo que haya que anular no se cierra, se deja para esa puerta.
 */
async function razonParaSaltar(sid: string | null): Promise<string | null> {
  if (!sid) return 'la orden no tiene cliente';
  const reconectado = await prismaService.mikrotikActionLog.findFirst({
    where: { subscriberId: sid, action: 'RECONNECT', ok: true, createdAt: { gte: LOTE.creadas } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (reconectado) {
    return `lo reconectaron el ${reconectado.createdAt.toISOString().slice(0, 16).replace('T', ' ')} (pagó): su corte se ANULA, no se cierra`;
  }
  const reconexionTv = await prismaService.ticket.findFirst({
    where: { subscriberId: sid, type: { contains: 'econexion Television' }, created: { gte: LOTE.creadas } },
    select: { code: true, status: true },
  });
  if (reconexionTv) {
    return `tiene una Reconexion Television #${reconexionTv.code} (${reconexionTv.status}): su TV ya volvió`;
  }
  return null;
}

async function main() {
  const abiertas = await prismaService.ticket.findMany({
    where: {
      type: LOTE.tipo,
      status: 'PENDIENTE',
      // Rango y no igualdad: `Ticket.created` es un `@db.Date` y comparar una fecha
      // con hora contra una columna sin hora es justamente lo que corre un día.
      created: { gte: LOTE.creadas, lt: DIA_SIGUIENTE },
      createdBySource: LOTE.fuente,
    },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, subscriberId: true, section: true, createdByName: true },
  });

  console.log(`\n${LOTE.tipo} PENDIENTES del lote del ${FECHA_DEL_TRABAJO}: ${abiertas.length} (se esperaban ${LOTE.esperadas})`);
  if (!abiertas.length) { console.log('No hay nada que cerrar.'); return; }
  if (abiertas.length !== LOTE.esperadas) {
    console.log(
      `\n⚠ El número no cuadra con lo revisado con el dueño (${LOTE.esperadas}). Alguien cerró, anuló o abrió órdenes`
      + ' desde entonces. Revisa la lista antes de aplicar; el script no escribe nada así.',
    );
    if (APLICAR) { process.exitCode = 1; return; }
  }

  let cerradas = 0;
  let saltadas = 0;
  for (const t of abiertas) {
    const sub = t.subscriberId
      ? await prismaService.subscriber.findUnique({
          where: { id: t.subscriberId },
          select: { abonado: true, legacyId: true, fullName: true },
        })
      : null;
    const quien = sub ? `abonado ${sub.legacyId ?? sub.abonado}${sub.fullName ? ` · ${sub.fullName}` : ''}` : 'sin cliente';
    console.log(`\n── #${t.code} · ${quien}`);

    const salta = await razonParaSaltar(t.subscriberId);
    if (salta) { console.log(`   ⏭ se deja abierta: ${salta}`); saltadas++; continue; }

    if (!APLICAR) { console.log('   (en seco: se cerraría con fecha ' + FECHA_DEL_TRABAJO + ')'); continue; }

    // La constancia va ANTES del cierre: si el cierre falla, queda escrito el intento.
    await prismaService.ticket
      .update({
        where: { id: t.id },
        data: { section: [t.section, CONSTANCIA].filter(Boolean).join(' ') },
      })
      .catch((e) => console.log(`   ⚠ no se pudo escribir la constancia: ${(e as Error).message}`));

    try {
      const r: any = await supportWriteService.updateStatus(
        t.id,
        { status: 'RESUELTO', finalDate: FECHA_DEL_TRABAJO } as any,
        USUARIO,
      );
      cerradas++;
      const tv = r?.cascade?.tv;
      const factura = r?.cascade?.factura;
      console.log(
        `   ✅ RESUELTO · TV: ${tv ? `${tv.ok ? 'aplicada' : 'no por red'} (${tv.detalle})` : 'sin cascada'}`
        + ` · factura: ${factura ? (factura.ok ? 'corte anotado' : factura.detalle ?? 'sin cambio') : 'sin cambio'}`,
      );
    } catch (e) {
      console.log(`   ❌ no se pudo cerrar: ${(e as Error).message}`);
    }
  }

  console.log(
    `\n${APLICAR ? 'Cerradas' : 'Se cerrarían'}: ${APLICAR ? cerradas : abiertas.length - saltadas}`
    + ` · se dejan abiertas: ${saltadas} · total revisadas: ${abiertas.length}`,
  );
  if (!APLICAR) console.log('Nada se escribió. Vuelve a correrlo con --aplicar.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prismaService.$disconnect());
