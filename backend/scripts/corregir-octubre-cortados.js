#!/usr/bin/env node
/**
 * Corrección de la corrida del 01-10-2026: le facturó el mes a abonados CORTADOS.
 *
 * La causa y la regla están en `src/billing/servicios-cortados.ts` (la corrida ya no
 * lo hace). Esto deshace lo que aquella corrida emitió de más, con la MISMA regla:
 * manda `estadoTv`/`estadoCombo` de la última recurrente anterior a octubre.
 *
 *   · todo lo suyo cortado        → la factura de octubre se ELIMINA (reverso del
 *                                    asiento + lápida, para que el writeback la borre
 *                                    también en el legacy);
 *   · un servicio cortado y otro no → se le QUITA el renglón del cortado por el camino
 *                                    de "Editar factura" y la factura hereda el corte.
 *
 * NO se toca (y se lista aparte, para una persona):
 *   · la que ya tiene pagos, recibos, e-factura, notas o una edición a mano;
 *   · el abonado reconectado después de la corrida (ya está gozando octubre);
 *   · el CORTADO que no debía ni 10.000 de meses anteriores: corte fantasma probable
 *     (pagó y la marca se quedó pegada), quitarle la factura sería regalarle el mes.
 *
 *   node scripts/corregir-octubre-cortados.js            # en seco: sólo el plan
 *   node scripts/corregir-octubre-cortados.js --apply    # escribe
 *
 * Necesita `npm run build` (usa los servicios compilados). Respaldo en /home/dev/backups.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { PrismaService } = require('../dist/src/prisma/prisma.service');
const { PeriodsService } = require('../dist/src/accounting/periods.service');
const { JournalService } = require('../dist/src/accounting/journal.service');
const { MappingsService } = require('../dist/src/accounting/mappings.service');
const { PostingService } = require('../dist/src/accounting/posting.service');
const { FacturasService } = require('../dist/src/billing/facturas.service');
const { serviciosCaidos } = require('../dist/src/billing/servicios-cortados');
const { servicioDeRenglon } = require('../dist/src/billing/servicio-de-renglon');
const { anotarBorradoLegacy } = require('../dist/src/common/legacy-deletion');

const APPLY = process.argv.includes('--apply');
const MES = new Date('2026-10-01T00:00:00Z');
const CORRIDA = [new Date('2026-10-01T07:00:00Z'), new Date('2026-10-01T07:07:00Z')];
const DEUDA_MINIMA_CORTE = 10000;
const QUIEN = 'Corrección corrida 01-10 (servicio cortado)';
const USER = { id: 'script', email: 'soporte@vestel.com.co', name: QUIEN, roles: ['superadmin'], permissions: ['*'], sedes: [] };
const MOTIVO = 'Servicio cortado antes de la corrida del 01-10-2026: no se factura lo que no se presta.';

function env() {
  const e = {};
  for (const l of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const i = l.indexOf('=');
    if (i > 0 && !l.trim().startsWith('#')) e[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return e;
}
const n = (v) => Number(v ?? 0);
const igual = (a, b) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

async function main() {
  const prisma = new PrismaService();
  const posting = new PostingService(new JournalService(prisma, new PeriodsService(prisma)), new MappingsService(prisma), prisma);
  const facturas = new FacturasService(prisma, posting, undefined, undefined);

  const oct = await prisma.subInvoice.findMany({
    where: { invoiceDate: MES, kind: 'RECURRENTE', status: { not: 'CANCELED' }, createdAt: { gte: CORRIDA[0], lte: CORRIDA[1] } },
    include: {
      items: { orderBy: { id: 'asc' } },
      subscriber: { select: { abonado: true, status: true, firstName: true, lastName1: true, branch: { select: { name: true } } } },
      _count: { select: { transactions: true, receipts: true, additionalServices: true, electronicInvoices: true } },
    },
  });
  const ids = oct.map((f) => f.subscriberId);

  const prev = new Map((await prisma.$queryRawUnsafe(`
    SELECT DISTINCT ON (i."subscriberId") i."subscriberId", i.tid, i."serviceCombo", i."serviceTv",
           i."estadoCombo"::text AS "estadoCombo", i."estadoTv"::text AS "estadoTv"
      FROM "SubInvoice" i
     WHERE i."subscriberId" = ANY($1::text[]) AND i.kind='RECURRENTE' AND i.status<>'CANCELED' AND i."invoiceDate" < $2::date
     ORDER BY i."subscriberId", i."invoiceDate" DESC, i.tid DESC`, ids, '2026-10-01')).map((r) => [r.subscriberId, r]));
  const deuda = new Map((await prisma.$queryRawUnsafe(`
    SELECT "subscriberId", SUM(total - "paidAmount")::float AS d FROM "SubInvoice"
     WHERE "subscriberId" = ANY($1::text[]) AND status IN ('DUE','PARTIAL') AND "invoiceDate" < $2::date
     GROUP BY 1`, ids, '2026-10-01')).map((r) => [r.subscriberId, r.d]));
  const reconectados = new Set((await prisma.ticket.findMany({
    where: { subscriberId: { in: ids }, type: { startsWith: 'Reconexion', mode: 'insensitive' }, status: { not: 'ANULADA' }, createdAt: { gte: CORRIDA[0] } },
    select: { subscriberId: true },
  })).map((t) => t.subscriberId));

  const plan = [];
  for (const f of oct) {
    const c = prev.get(f.subscriberId);
    const k = serviciosCaidos(c);
    if (!k.INTERNET && !k.TV) continue;
    const tipo = (it) => (igual(it.productName, c.serviceCombo) ? 'INTERNET'
      : igual(it.productName, c.serviceTv) ? 'TV'
        : { internet: 'INTERNET', television: 'TV', otro: 'OTRO' }[servicioDeRenglon(it.productName)]);
    const fuera = f.items.filter((it) => (tipo(it) === 'INTERNET' && k.INTERNET) || (tipo(it) === 'TV' && k.TV));
    const quedan = f.items.filter((it) => !fuera.includes(it));
    const fila = {
      id: f.id, tid: f.tid, legacyId: f.legacyId, subscriberId: f.subscriberId, abonado: f.subscriber.abonado,
      nombre: `${f.subscriber.firstName ?? ''} ${f.subscriber.lastName1 ?? ''}`.trim(), sede: f.subscriber.branch?.name ?? null,
      total: n(f.total), corte: { internet: k.INTERNET ? c.estadoCombo : null, tv: k.TV ? c.estadoTv : null, facturaAnterior: c.tid },
      quita: fuera.map((it) => it.productName), valorQuitado: fuera.reduce((s, it) => s + n(it.price) * it.qty * (1 + n(it.taxRate) / 100), 0),
      deudaAnterior: deuda.get(f.subscriberId) ?? 0,
    };
    const cnt = f._count;
    const soloCortado = [k.INTERNET && c.estadoCombo, k.TV && c.estadoTv].filter(Boolean).every((e) => e === 'CORTADO');
    let freno = null;
    if (!fuera.length) freno = 'la factura no trae el renglón del servicio cortado';
    else if (n(f.paidAmount) > 0 || cnt.transactions || cnt.receipts) freno = 'ya tiene pagos o recibos';
    else if (cnt.electronicInvoices) freno = 'tiene e-factura';
    else if (cnt.additionalServices) freno = 'tiene servicios adicionales';
    else if (f.editedAt || f.items.some((it) => /^nota (credito|debito)$/i.test(it.productName ?? ''))) freno = 'ya fue editada o tiene notas';
    else if (reconectados.has(f.subscriberId)) freno = 'reconectado después de la corrida';
    else if (soloCortado && fila.deudaAnterior < DEUDA_MINIMA_CORTE) freno = 'cortado sin deuda anterior (corte fantasma probable)';
    plan.push({ ...fila, accion: freno ? 'REVISAR' : quedan.length ? 'QUITAR_RENGLON' : 'ELIMINAR', freno, _f: f, _quedan: quedan, _fuera: fuera, _c: c, _k: k });
  }

  const de = (a) => plan.filter((p) => p.accion === a);
  const suma = (l, campo) => Math.round(l.reduce((s, p) => s + p[campo], 0));
  console.log(`Facturas de la corrida: ${oct.length} · con servicio cortado: ${plan.length}`);
  console.log(`  ELIMINAR        ${de('ELIMINAR').length}  ($${suma(de('ELIMINAR'), 'total').toLocaleString('es-CO')})`);
  console.log(`  QUITAR_RENGLON  ${de('QUITAR_RENGLON').length}  ($${suma(de('QUITAR_RENGLON'), 'valorQuitado').toLocaleString('es-CO')})`);
  console.log(`  REVISAR         ${de('REVISAR').length}`);
  const porFreno = {};
  for (const p of de('REVISAR')) porFreno[p.freno] = (porFreno[p.freno] ?? 0) + 1;
  for (const [m, c] of Object.entries(porFreno)) console.log(`     · ${m}: ${c}`);

  const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const limpio = plan.map(({ _f, _quedan, _fuera, _c, _k, ...p }) => p);
  const informe = `/home/dev/backups/octubre-cortados-${APPLY ? 'aplicado' : 'plan'}-${sello}.json`;

  if (!APPLY) {
    fs.writeFileSync(informe, JSON.stringify(limpio, null, 1));
    console.log(`\nEn seco. Plan en ${informe}. Con --apply se escribe.`);
    await prisma.$disconnect();
    return;
  }

  // Respaldo completo ANTES de tocar: la factura y sus renglones de los dos lados.
  const e = env();
  const my = await mysql.createConnection({
    host: e.LEGACY_DB_HOST || '127.0.0.1', port: Number(e.LEGACY_DB_PORT || 3306),
    user: e.LEGACY_DB_USER, password: e.LEGACY_DB_PASSWORD, database: e.LEGACY_DB_NAME || e.LEGACY_DB_DATABASE,
  });
  const tocar = plan.filter((p) => p.accion !== 'REVISAR');
  const tids = tocar.map((p) => p.tid);
  const [lgInv] = tids.length ? await my.query('SELECT * FROM invoices WHERE tid IN (?)', [tids]) : [[]];
  const [lgItems] = tids.length ? await my.query('SELECT * FROM invoice_items WHERE tid IN (?)', [tids]) : [[]];
  await my.end();
  const asientos = await prisma.journalEntry.findMany({ where: { sourceType: 'SALES_INVOICE', sourceId: { in: tocar.map((p) => p.id) } }, include: { lines: true } });
  fs.writeFileSync(informe, JSON.stringify({
    plan: limpio,
    postgres: tocar.map((p) => { const { subscriber, _count, ...f } = p._f; return f; }),
    asientos, legacy: { invoices: lgInv, invoice_items: lgItems },
  }, null, 1));
  console.log(`\nRespaldo en ${informe}`);

  let eliminadas = 0, editadas = 0; const fallos = [];
  for (const p of tocar) {
    const f = p._f;
    try {
      if (p.accion === 'ELIMINAR') {
        // Reverso del asiento de la corrida (mismo camino que una edición a cero).
        await posting.postSalesInvoiceAdjustment({
          sourceId: f.id, date: f.invoiceDate, number: f.tid, edit: (f.editCount ?? 0) + 1,
          deltaSubtotal: -n(f.subtotal), deltaTax: -n(f.tax),
          costCenterId: await posting.centroDeAbonado(f.subscriberId), createdBy: QUIEN,
        });
        await prisma.auditLog.create({ data: {
          action: 'DELETE', entity: 'SubInvoice', entityId: f.id,
          before: { tid: f.tid, subscriberId: f.subscriberId, total: n(f.total), items: f.items.map((it) => ({ product: it.productName, price: n(it.price), taxRate: n(it.taxRate) })) },
          after: { reason: MOTIVO, by: QUIEN, corte: p.corte },
        } });
        await anotarBorradoLegacy(prisma, 'subInvoice', f, { label: `Factura #${f.tid}`, deletedBy: QUIEN });
        await prisma.subInvoice.delete({ where: { id: f.id } });
        eliminadas++;
      } else {
        await facturas.updateInvoice(f.id, {
          reason: MOTIVO,
          items: p._quedan.map((it) => ({
            productName: it.productName ?? undefined, productId: it.productId ?? 0,
            description: it.description ?? it.productName ?? 'Servicio', qty: it.qty, price: n(it.price), taxRate: n(it.taxRate),
          })),
        }, USER);
        // La factura de octubre es ahora la vigente: hereda el corte, como en el legacy.
        await prisma.subInvoice.update({ where: { id: f.id }, data: {
          ...(p._k.INTERNET ? { estadoCombo: p._c.estadoCombo, serviceCombo: f.serviceCombo ?? p._c.serviceCombo } : {}),
          ...(p._k.TV ? { estadoTv: p._c.estadoTv, serviceTv: f.serviceTv ?? p._c.serviceTv, puntos: null } : {}),
          serviceStatusAt: new Date(), serviceStatusBy: QUIEN,
        } });
        editadas++;
      }
    } catch (err) {
      fallos.push({ tid: p.tid, error: err.message });
    }
  }
  console.log(`Eliminadas ${eliminadas} · con renglón quitado ${editadas} · fallos ${fallos.length}`);
  for (const x of fallos) console.log(`  #${x.tid}: ${x.error}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
