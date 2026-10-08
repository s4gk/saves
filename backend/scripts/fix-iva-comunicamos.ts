/**
 * 2026-09-29 · Comunicamos Telecomunicamos SAS (NIT 860062059, abonados 22167, 22215,
 * 22216): el plan "50 Megas Dedicado" quedó al 0% y sus facturas de ago/sep salieron
 * con 520.000 sin discriminar IVA. El total NO cambia: 436.975 base + 83.025 IVA (19%).
 *
 * Edita cada factura por `updateInvoice` (auditoría, editedAt → writeback al legacy,
 * ajuste contable 4135 → IVA) y deja el plan y los servicios de los tres en base+19%.
 *
 * Uso: npx ts-node --transpile-only scripts/fix-iva-comunicamos.ts [--dry]
 */
import { PrismaClient } from '@prisma/client';
import { FacturasService } from '../src/billing/facturas.service';
import { PostingService } from '../src/accounting/posting.service';
import { JournalService } from '../src/accounting/journal.service';
import { MappingsService } from '../src/accounting/mappings.service';
import { PeriodsService } from '../src/accounting/periods.service';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');
const ABONADOS = [22167, 22215, 22216];
const PLAN = '50 Megas Dedicado';
const BASE = 436975;
const user: any = { id: 'sistema', name: 'Corrección IVA Comunicamos', email: 'soporte@vestel.com.co', permissions: ['system.admin'] };

async function main() {
  const posting = new PostingService(
    new JournalService(prisma as any, new PeriodsService(prisma as any)),
    new MappingsService(prisma as any), prisma as any,
  );
  const svc = new FacturasService(prisma as any, posting, {} as any, {} as any);

  const facturas = await prisma.subInvoice.findMany({
    where: { subscriber: { legacyId: { in: ABONADOS } }, status: { not: 'CANCELED' }, items: { some: { productName: PLAN, taxRate: 0 } } },
    include: { items: true, subscriber: { select: { legacyId: true } } },
    orderBy: [{ subscriberId: 'asc' }, { invoiceDate: 'asc' }],
  });
  for (const f of facturas) {
    const items = f.items.map((it) => it.productName === PLAN && Number(it.taxRate) === 0
      ? { productId: it.productId ?? 0, productName: it.productName, description: it.description, qty: it.qty, price: BASE, taxRate: 19 }
      : { productId: it.productId ?? 0, productName: it.productName, description: it.description, qty: it.qty, price: Number(it.price), taxRate: Number(it.taxRate) });
    console.log(`abonado ${f.subscriber.legacyId} · factura ${f.tid} (${f.invoiceDate.toISOString().slice(0, 10)}) total ${f.total}`);
    if (DRY) continue;
    const r = await svc.updateInvoice(f.id, { reason: 'Discriminar IVA 19% (plan dedicado quedó al 0%); el total no cambia', items } as any, user);
    console.log('   →', { subtotal: r.subtotal, tax: r.tax, total: r.total, status: r.status });
  }

  if (!DRY) {
    const plan = await prisma.plan.updateMany({ where: { name: PLAN, taxRate: 0 }, data: { price: BASE, taxRate: 19 } });
    const serv = await prisma.subscriberService.updateMany({
      where: { planName: PLAN, taxRate: 0, subscriber: { legacyId: { in: ABONADOS } } },
      data: { price: BASE, taxRate: 19 },
    });
    console.log(`plan: ${plan.count} · servicios: ${serv.count}`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error('FALLO:', e.message); await prisma.$disconnect(); process.exit(1); });
