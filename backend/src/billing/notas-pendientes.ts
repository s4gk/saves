import { Prisma } from '@prisma/client';
import { num, round2 } from '../common/money';
import { aplicarNotaEnTx } from './nota-en-tx';
import type { RETENTION_LABEL_TO_ENUM } from './retenciones';

/**
 * NOTAS PENDIENTES: la nota crédito/débito que se deja para la PRÓXIMA factura.
 *
 * El caso real (pedido del 2026-10-03): una nota sólo se podía aplicar sobre una
 * factura que ya existiera, así que cuando el cliente estaba al día —o la rebaja era
 * por algo del mes que todavía no se ha facturado— había que acordarse de volver el
 * día 1 a aplicarla. Ahora se deja escrita y se aplica sola cuando la factura nace:
 * en la corrida del mes y en la factura manual, dentro del MISMO commit que la crea
 * (igual que los anticipos, ver `aplicarAnticipos`), y ANTES del anticipo, para que
 * el saldo a favor pague el total ya rebajado.
 *
 * Reglas:
 *   · Débito: entra entero en la primera factura que nazca.
 *   · Crédito: rebaja hasta dejar la factura en cero; lo que sobre sigue pendiente
 *     para la siguiente. Una crédito mayor que la mensualidad no se pierde (aplicada
 *     directo sobre una factura, `aplicarNotaEnTx` deja el total en cero y el resto
 *     se esfuma).
 *   · Primero los débitos y luego los créditos: así un crédito puede absorber un
 *     recargo que caiga en la misma factura.
 *   · Las anuladas (`CANCELED`) no reciben nada.
 *
 * El renglón que queda en la factura es una nota normal (`Nota Credito`/`Nota Debito`,
 * firmada por quien la dejó y con su observación): sale en el historial, en el listado
 * de notas y viaja al legacy como cualquier otra.
 */

/** Por debajo de esto no se aplica un crédito: calderilla (mismo umbral del redondeo). */
const MINIMO = 1;

export type NotaPendientePlan = { id: string; type: 'CREDITO' | 'DEBITO'; queda: number };

/**
 * Cuánto de cada nota pendiente cae sobre una factura con `saldo` por cobrar. Puro,
 * para poder probarlo (ver notas-pendientes.spec.ts).
 */
export function repartirNotasPendientes(
  notas: NotaPendientePlan[],
  saldo: number,
): { id: string; type: 'CREDITO' | 'DEBITO'; amount: number }[] {
  const salida: { id: string; type: 'CREDITO' | 'DEBITO'; amount: number }[] = [];
  let queda = round2(Math.max(saldo, 0));
  const orden = [...notas.filter((n) => n.type === 'DEBITO'), ...notas.filter((n) => n.type === 'CREDITO')];
  for (const n of orden) {
    const pendiente = round2(n.queda);
    if (pendiente <= 0) continue;
    if (n.type === 'DEBITO') {
      salida.push({ id: n.id, type: n.type, amount: pendiente });
      queda = round2(queda + pendiente);
      continue;
    }
    const dar = round2(Math.min(pendiente, queda));
    if (dar < MINIMO) continue;
    salida.push({ id: n.id, type: n.type, amount: dar });
    queda = round2(queda - dar);
  }
  return salida;
}

/**
 * Aplica a `invoiceId` las notas pendientes del abonado. Corre DENTRO de la
 * transacción que crea la factura. Devuelve lo aplicado (vacío si no había nada).
 */
export async function aplicarNotasPendientes(
  tx: Prisma.TransactionClient,
  subscriberId: string,
  invoiceId: string,
) {
  const notas = await tx.pendingNote.findMany({
    where: { subscriberId, status: 'PENDIENTE' },
    orderBy: { createdAt: 'asc' },
  });
  if (!notas.length) return [];

  const inv = await tx.subInvoice.findUnique({
    where: { id: invoiceId },
    select: { total: true, paidAmount: true, status: true },
  });
  if (!inv || inv.status === 'CANCELED') return [];

  const reparto = repartirNotasPendientes(
    notas.map((n) => ({ id: n.id, type: n.type as 'CREDITO' | 'DEBITO', queda: round2(num(n.amount) - num(n.applied)) })),
    round2(num(inv.total) - num(inv.paidAmount)),
  );

  const aplicadas: { noteId: string; type: 'CREDITO' | 'DEBITO'; amount: number }[] = [];
  for (const r of reparto) {
    const n = notas.find((x) => x.id === r.id)!;
    await aplicarNotaEnTx(tx, invoiceId, {
      type: r.type,
      amount: r.amount,
      description: n.description,
      retentionType: (n.retentionType as keyof typeof RETENTION_LABEL_TO_ENUM | null) ?? null,
      authorLegacyId: n.authorLegacyId,
      editedBy: `${n.createdByName} (nota pendiente)`,
    });
    await tx.pendingNoteApplication.create({ data: { noteId: n.id, invoiceId, amount: r.amount } });
    const applied = round2(num(n.applied) + r.amount);
    await tx.pendingNote.update({
      where: { id: n.id },
      data: { applied, ...(applied >= round2(num(n.amount)) - 0.005 ? { status: 'APLICADA' } : {}) },
    });
    aplicadas.push({ noteId: n.id, type: r.type, amount: r.amount });
  }
  return aplicadas;
}
