/**
 * Smoke de NOTAS PENDIENTES contra la base de verdad, sin dejar rastro: todo corre
 * dentro de una transacción que al final se revienta a propósito.
 *
 *   npx ts-node --transpile-only scripts/smoke-notas-pendientes.ts
 *
 * Toma una mensualidad pendiente real y le deja a su cliente una crédito MAYOR que
 * la factura más una débito; comprueba que al "nacer" la factura (se llama a
 * `aplicarNotasPendientes` como lo hacen la corrida y la factura manual):
 *   1. la débito entra entera y la crédito deja la factura en cero (PAGADA),
 *   2. lo que sobró de la crédito sigue PENDIENTE y la débito queda APLICADA,
 *   3. quedan los renglones "Nota Credito"/"Nota Debito" y sus aplicaciones,
 *   4. una segunda pasada no vuelve a aplicar nada sobre la misma factura en cero.
 */
import { PrismaClient } from '@prisma/client';
import { aplicarNotasPendientes } from '../src/billing/notas-pendientes';

const prisma = new PrismaClient();
const ROLLBACK = 'SMOKE_ROLLBACK';
let fallos = 0;
const check = (ok: boolean, t: string) => { console.log(`${ok ? '  ✓' : '  ✗'} ${t}`); if (!ok) fallos++; };

async function main() {
  const f = await prisma.subInvoice.findFirst({
    where: { status: 'DUE', kind: 'RECURRENTE', paidAmount: 0, total: { gt: 1000 } },
    orderBy: { invoiceDate: 'desc' },
    select: { id: true, tid: true, total: true, subscriberId: true },
  });
  if (!f) return console.log('Sin mensualidad pendiente con la que probar.');
  const total = Number(f.total);
  console.log(`Factura #${f.tid} · total ${total}\n`);
  try {
    await prisma.$transaction(async (tx) => {
      const yaHabia = await tx.pendingNote.count({ where: { subscriberId: f.subscriberId, status: 'PENDIENTE' } });
      check(yaHabia === 0, 'el cliente no traía notas pendientes');
      const cred = await tx.pendingNote.create({ data: {
        subscriberId: f.subscriberId, type: 'CREDITO', amount: total + 30000 + 10000,
        description: 'smoke crédito', createdByName: 'smoke',
      } });
      const deb = await tx.pendingNote.create({ data: {
        subscriberId: f.subscriberId, type: 'DEBITO', amount: 30000,
        description: 'smoke débito', createdByName: 'smoke',
      } });

      const r = await aplicarNotasPendientes(tx, f.subscriberId, f.id);
      check(r.length === 2, `se aplicaron 2 notas (${r.length})`);
      const inv = await tx.subInvoice.findUniqueOrThrow({ where: { id: f.id } });
      check(Number(inv.total) === 0 && inv.status === 'PAID', `factura en cero y PAGADA (total ${inv.total}, ${inv.status})`);
      check(inv.editedAt != null, 'factura blindada del sync (editedAt)');

      const c = await tx.pendingNote.findUniqueOrThrow({ where: { id: cred.id } });
      const d = await tx.pendingNote.findUniqueOrThrow({ where: { id: deb.id } });
      check(d.status === 'APLICADA' && Number(d.applied) === 30000, 'débito APLICADA entera');
      check(c.status === 'PENDIENTE' && Number(c.amount) - Number(c.applied) === 10000,
        `crédito sigue PENDIENTE con 10.000 (le quedan ${Number(c.amount) - Number(c.applied)})`);

      const renglones = await tx.subInvoiceItem.findMany({ where: { invoiceId: f.id, description: { startsWith: 'smoke' } } });
      check(renglones.length === 2, 'dos renglones de nota en la factura');
      const apps = await tx.pendingNoteApplication.count({ where: { invoiceId: f.id } });
      check(apps === 2, 'dos aplicaciones registradas');

      const r2 = await aplicarNotasPendientes(tx, f.subscriberId, f.id);
      check(r2.length === 0, 'segunda pasada sobre la factura en cero: nada');
      throw new Error(ROLLBACK);
    }, { timeout: 30_000 });
  } catch (e) {
    if ((e as Error).message !== ROLLBACK) throw e;
  }
  const quedo = await prisma.pendingNote.count({ where: { description: { startsWith: 'smoke' } } });
  check(quedo === 0, 'no quedó rastro (transacción revertida)');
  console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien.');
  process.exitCode = fallos ? 1 : 0;
}
main().finally(() => prisma.$disconnect());
