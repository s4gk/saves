/**
 * Corrección puntual (2026-10-03): INVERSIONES DEL ORIENTE (NIT 901784975, legacy
 * customers.id 19494, sede Villanueva, nexus cmr3j3jg90eubdz33fkxmou6j).
 *
 * La factura de septiembre #503522 se editó en el legacy el 04-sep con «Editar factura»
 * y le metieron a mano las tres retenciones como renglones negativos (RETEFUENTE 4%
 * −10.391, RETEICA 10*1000 −2.598, RETENCION ICA AVISOS −650 = −13.639). El editor del
 * legacy guarda los renglones pero NO recalcula el total: quedó en 264.000 en vez de
 * 250.361, y los renglones sin `tipo_retencion`. Agosto y octubre se hicieron con la nota
 * crédito de retención y sí quedaron bien.
 *
 * El cliente pagó los 264.000 por Wompi el 21-sep (movimiento 514747) → 13.639 de más.
 *
 * Qué hace, en los dos sistemas:
 *   1. #503522: subtotal 246.130 · total 250.361 (misma convención que agosto: el
 *      subtotal ya trae las notas restadas) y los tres renglones marcados
 *      'Retefuente Servicios', como la nota crédito.
 *   2. Parte el pago Wompi 514747 en 250.361 + 13.639 y re-etiqueta los 13.639 a la
 *      factura de octubre #508760 (mismo mecanismo que `corregir-sobrepago-6880.js`).
 *      El hijo hereda fecha, cuenta y método del padre: el cierre del 21-sep no se mueve.
 *   Resultado: #503522 PAID saldada; #508760 PARTIAL, le faltan 236.722.
 *   Si la plata del cliente cambia o los dos lados no quedan iguales, se revierte todo.
 *
 * Uso: node scripts/corregir-retencion-503522.js [--live]   (sin --live no escribe nada)
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

try {
  const envFile = path.join(__dirname, '..', '.env');
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
} catch {}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { mapTx } = require('./lib/vestel-map');

const LIVE = process.argv.includes('--live');
const CSD = 19494;
const SEP = 503522, OCT = 508760, TX = 514747;
const MONTO = 13639;
/** Renglones de retención de septiembre (legacy invoice_items.id). */
const RENGLONES_RETENCION = [6638503, 6638504, 6638505];
const NUEVO_SUBTOTAL_SEP = 246130, NUEVO_TOTAL_SEP = 250361;
/** Cómo tiene que estar todo ANTES; si algo cambió, no se toca nada. */
const ESPERADO = {
  [SEP]: { total: 264000, pamnt: 264000 },
  [OCT]: { total: 250361, pamnt: 0 },
};
const ESPERADO_CREDIT = 264000;

const num = (v) => Number(v ?? 0);
const cop = (n) => '$' + Math.round(n).toLocaleString('es-CO');
const mismoDinero = (a, b) => Math.abs(Number(a) - Number(b)) < 1;

function notaHija(nota, idPadre) {
  const base = String(nota ?? '').replace(new RegExp(String(SEP), 'g'), String(OCT));
  return `${base} #adelantado_de_tr_id=${idPadre} (retención no descontada en #${SEP})`.slice(0, 255);
}
function notaPadre(nota, creditOriginal) {
  const s = String(nota ?? '');
  if (s.toLowerCase().includes('credito_inicial')) return s;
  return `${s} #credito_inicial=${creditOriginal}`.slice(0, 255);
}

async function dineroLegacy(my) {
  const [[t]] = await my.query(
    `SELECT COALESCE(SUM(credit),0) c FROM transactions WHERE payerid=? AND (estado IS NULL OR estado='')`, [CSD]);
  return num(t.c);
}
async function dineroNexus(db, subscriberId) {
  const r = await db.transaction.aggregate({ where: { subscriberId, status: 'VIGENTE' }, _sum: { credit: true } });
  return num(r._sum.credit);
}

async function main() {
  const my = await mysql.createConnection({
    host: process.env.LEGACY_DB_HOST, port: Number(process.env.LEGACY_DB_PORT || 3306),
    user: process.env.LEGACY_DB_USER, password: process.env.LEGACY_DB_PASSWORD,
    database: process.env.LEGACY_DB_NAME, dateStrings: true,
  });

  // ── Frenos ─────────────────────────────────────────────────────────────────────
  const tids = [SEP, OCT];
  const [facts] = await my.query('SELECT * FROM invoices WHERE tid IN (?) AND csd=?', [tids, CSD]);
  const fLeg = new Map(facts.map((f) => [f.tid, f]));
  const fPg = new Map((await prisma.subInvoice.findMany({ where: { tid: { in: tids } } })).map((f) => [f.tid, f]));
  for (const tid of tids) {
    const l = fLeg.get(tid), p = fPg.get(tid);
    if (!l || !p) throw new Error(`factura #${tid} falta en ${!l ? 'legacy' : 'nexus'}`);
    if (p.legacyId !== l.id) throw new Error(`factura #${tid}: legacyId ${p.legacyId} ≠ ${l.id}`);
    if (p.eInvoiceFlag || l.facturacion_electronica) throw new Error(`factura #${tid} tiene factura electrónica`);
    const e = ESPERADO[tid];
    if (!mismoDinero(l.total, e.total) || !mismoDinero(p.total, e.total)) throw new Error(`#${tid}: total legacy ${l.total} / nexus ${p.total} ≠ ${e.total}`);
    if (!mismoDinero(l.pamnt, e.pamnt) || !mismoDinero(p.paidAmount, e.pamnt)) throw new Error(`#${tid}: pagado legacy ${l.pamnt} / nexus ${p.paidAmount} ≠ ${e.pamnt}`);
  }
  if (await prisma.electronicInvoice.count({ where: { invoiceId: { in: tids.map((t) => fPg.get(t).id) } } })) {
    throw new Error('alguna de las facturas tiene emisión electrónica');
  }
  const [renglones] = await my.query('SELECT id, subtotal FROM invoice_items WHERE tid=? AND id IN (?)', [SEP, RENGLONES_RETENCION]);
  if (renglones.length !== 3 || !mismoDinero(renglones.reduce((s, r) => s + num(r.subtotal), 0), -MONTO)) {
    throw new Error('los renglones de retención de septiembre no son los diagnosticados');
  }
  const [[t]] = await my.query('SELECT * FROM transactions WHERE id=?', [TX]);
  const tPg = await prisma.transaction.findUnique({ where: { legacyId: TX } });
  if (!t || !tPg) throw new Error(`movimiento ${TX} falta en ${!t ? 'legacy' : 'nexus'}`);
  if (t.estado) throw new Error(`movimiento ${TX} está ${t.estado}`);
  if (Number(t.tid) !== SEP) throw new Error(`movimiento ${TX} es de la factura ${t.tid}`);
  if (!mismoDinero(t.credit, ESPERADO_CREDIT) || !mismoDinero(tPg.credit, ESPERADO_CREDIT)) throw new Error(`movimiento ${TX}: legacy ${t.credit} / nexus ${tPg.credit} ≠ ${ESPERADO_CREDIT}`);
  const subscriberId = fPg.get(SEP).subscriberId;

  console.log(`${LIVE ? 'APLICANDO' : 'EN SECO (no se escribe nada)'} — cliente ${CSD} (INVERSIONES DEL ORIENTE)`);
  console.log(`  #${SEP}: total ${cop(264000)} → ${cop(NUEVO_TOTAL_SEP)} (retenciones ${cop(-MONTO)})`);
  console.log(`  parte el movimiento ${TX} (${cop(ESPERADO_CREDIT)}) → ${cop(ESPERADO_CREDIT - MONTO)} a #${SEP} + ${cop(MONTO)} a #${OCT}`);
  const antesLeg = await dineroLegacy(my), antesPg = await dineroNexus(prisma, subscriberId);
  console.log(`  plata vigente del cliente: legacy ${cop(antesLeg)} · nexus ${cop(antesPg)}`);
  if (!LIVE) { await my.end(); await prisma.$disconnect(); return; }

  // ── Escritura: legacy y nexus en la misma jugada ───────────────────────────────
  await my.beginTransaction();
  try {
    // 1. Septiembre: total con las retenciones y renglones marcados.
    await my.execute('UPDATE invoices SET subtotal=?, total=? WHERE id=?', [NUEVO_SUBTOTAL_SEP, NUEVO_TOTAL_SEP, fLeg.get(SEP).id]);
    await my.query(`UPDATE invoice_items SET tipo_retencion='Retefuente Servicios' WHERE tid=? AND id IN (?)`, [SEP, RENGLONES_RETENCION]);

    // 2. Partir el pago.
    const [ins] = await my.execute(
      `INSERT INTO transactions (acid, account, type, cat, debit, credit, payer, payerid, method, date,
                                 tid, eid, note, ext, nombre_banco, id_banco, estado, no_mostrar, id_orden_payu)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t.acid, t.account, t.type, t.cat, t.debit, MONTO, t.payer, t.payerid, t.method, t.date,
        OCT, t.eid, notaHija(t.note, t.id), t.ext, t.nombre_banco, t.id_banco, t.estado, t.no_mostrar, t.id_orden_payu]);
    const creditPadre = num(t.credit) - MONTO;
    await my.execute('UPDATE transactions SET credit=?, note=? WHERE id=?', [creditPadre, notaPadre(t.note, num(t.credit)), TX]);
    await my.execute(`UPDATE invoices SET pamnt=?, status='paid' WHERE id=?`, [NUEVO_TOTAL_SEP, fLeg.get(SEP).id]);
    await my.execute(`UPDATE invoices SET pamnt=?, status='partial', pmethod=? WHERE id=?`, [MONTO, t.method, fLeg.get(OCT).id]);

    await prisma.$transaction(async (tx) => {
      await tx.subInvoice.update({
        where: { tid: SEP },
        data: { subtotal: NUEVO_SUBTOTAL_SEP, total: NUEVO_TOTAL_SEP, paidAmount: NUEVO_TOTAL_SEP, status: 'PAID' },
      });
      const r = await tx.subInvoiceItem.updateMany({
        where: { invoiceId: fPg.get(SEP).id, legacyId: { in: RENGLONES_RETENCION } },
        data: { retentionType: 'RETEFUENTE_SERVICIOS' },
      });
      if (r.count !== 3) throw new Error(`renglones marcados en nexus: ${r.count} ≠ 3`);
      await tx.subInvoice.update({ where: { tid: OCT }, data: { paidAmount: MONTO, status: 'PARTIAL', paymentMethod: t.method } });
      await tx.transaction.update({ where: { legacyId: TX }, data: { credit: creditPadre, note: notaPadre(t.note, num(t.credit)) } });
      const [[fila]] = await my.query('SELECT * FROM transactions WHERE id=?', [ins.insertId]);
      await tx.transaction.create({ data: mapTx(fila, subscriberId, fPg.get(OCT).id, null) });

      // Invariantes.
      const despuesLeg = await dineroLegacy(my), despuesPg = await dineroNexus(tx, subscriberId);
      if (!mismoDinero(antesLeg, despuesLeg)) throw new Error(`legacy pasó de ${cop(antesLeg)} a ${cop(despuesLeg)}`);
      if (!mismoDinero(antesPg, despuesPg)) throw new Error(`nexus pasó de ${cop(antesPg)} a ${cop(despuesPg)}`);
      for (const tid of tids) {
        const [[f]] = await my.query('SELECT pamnt, total FROM invoices WHERE tid=?', [tid]);
        const p = await tx.subInvoice.findUnique({ where: { tid }, select: { paidAmount: true, total: true } });
        if (!mismoDinero(f.pamnt, p.paidAmount) || !mismoDinero(f.total, p.total)) {
          throw new Error(`#${tid}: legacy ${f.pamnt}/${f.total} ≠ nexus ${p.paidAmount}/${p.total}`);
        }
      }
      const [[s]] = await my.query('SELECT SUM(subtotal) s FROM invoice_items WHERE tid=?', [SEP]);
      // Renglones: 157.500 + 80.000 + 26.500 (TV con IVA) − 13.639 = 250.361.
      if (!mismoDinero(s.s, NUEVO_TOTAL_SEP)) throw new Error(`renglones de #${SEP} suman ${s.s}`);
      await my.commit();
    });
    console.log(`  ✔ aplicado · movimiento nuevo en el legacy: ${ins.insertId}`);
  } catch (e) {
    await my.rollback().catch(() => {});
    console.error(`  ✘ revertido: ${e.message}`);
    process.exitCode = 1;
  }
  await my.end();
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
