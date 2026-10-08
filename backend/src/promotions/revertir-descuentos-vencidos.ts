import { Prisma } from '@prisma/client';
import { aplicarNotaEnTx } from '../billing/facturas.service';
import { num, round2 } from '../common/money';
import { hoyEnColombia } from '../common/fecha-colombia';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Retira el descuento de una promoción cuando el cliente NO pagó dentro de su
 * vigencia, o cuando la promoción se DESACTIVÓ antes de que pagara.
 *
 * El problema que cierra: la promo se aplica a la factura como nota crédito el
 * día que se concede, y ahí se queda. Quien se la aplicaba el día 3 y pagaba el
 * 20 se llevaba la rebaja igual, con lo que el "pronto pago" no premiaba nada.
 * En el legacy pasa lo mismo por otra vía (el portal público) y se corrige con
 * el parche de `/home/dev/parche-pronto-pago-legacy`; aquí se cierra la puerta
 * equivalente del sistema nuevo.
 *
 * Desactivar cuenta igual que vencer (pedido del usuario, 2026-09-30): apagar
 * "cartera 50%" dejaba las 2.831 facturas pendientes con el 50% puesto, y el
 * portal seguía cobrando la mitad.
 *
 * Se ejecuta al COBRAR, justo antes de repartir la plata, y solo toca facturas
 * sin pagar: lo ya cobrado no se reescribe. El descuento no se borra —se
 * revierte con una nota débito— para que la factura conserve las dos huellas y
 * se pueda explicar en el mostrador.
 *
 * Va como función suelta y no como servicio a propósito: `CobranzasService` no
 * conoce a `PromotionsService` y meterle esa dependencia obligaría a reordenar
 * el contenedor, que hoy se cablea a mano (ver [[generador-contenedor-roto]]).
 */
export async function revertirDescuentosVencidos(
  tx: Prisma.TransactionClient,
  subscriberId: string,
  opts: {
    authorLegacyId?: number | null;
    editedBy?: string | null;
    /** Acota a los descuentos de UNA promoción (la que se acaba de desactivar). */
    promotionId?: string;
    /**
     * Fin mínimo de vigencia (por defecto hoy): lo que terminó en esta fecha o
     * después NO se retira. Es la gracia del convenio; sin ella, el descuento que el
     * portal ya había puesto se retiraría justo antes de volver a concederlo.
     */
    finMinimo?: Date;
  } = {},
): Promise<{ revertidas: number; monto: number; promociones: string[] }> {
  const vacio = { revertidas: 0, monto: 0, promociones: [] as string[] };

  const pendientes = await tx.subInvoice.findMany({
    where: { subscriberId, status: { in: ['DUE', 'PARTIAL'] } },
    select: { id: true },
  });
  if (!pendientes.length) return vacio;

  // La vigencia se mide contra la promoción QUE CONCEDIÓ el descuento, no contra
  // "si hay alguna promo viva hoy": cada aplicación sabe de cuál vino.
  // `hoyEnColombia` y no `new Date()`: entre las 7 PM y medianoche el UTC ya es
  // mañana, y una promo que vence hoy se daría por vencida esta misma tarde.
  const hoy = hoyEnColombia();
  const aplicaciones = await tx.promotionApplication.findMany({
    where: {
      invoiceId: { in: pendientes.map((i) => i.id) },
      revertedAt: null,
      ...(opts.promotionId ? { promotionId: opts.promotionId } : {}),
      promotion: { OR: [{ endDate: { lt: opts.finMinimo ?? hoy } }, { active: false }] },
    },
    include: { promotion: { select: { name: true, endDate: true, active: true } } },
  });
  if (!aplicaciones.length) return vacio;

  let monto = 0;
  const promociones: string[] = [];
  for (const app of aplicaciones) {
    const amount = round2(num(app.amount));
    if (!(amount > 0)) continue;
    const vencio = app.promotion.endDate.toISOString().slice(0, 10);
    await aplicarNotaEnTx(tx, app.invoiceId, {
      type: 'DEBITO',
      amount,
      description: app.promotion.active
        ? `Descuento retirado: "${app.promotion.name}" vencía el ${vencio} y el pago llegó después`
        : `Descuento retirado: la promoción "${app.promotion.name}" se desactivó antes del pago`,
      authorLegacyId: opts.authorLegacyId ?? null,
      editedBy: opts.editedBy ?? null,
    });
    await tx.promotionApplication.update({
      where: { id: app.id },
      data: { revertedAt: new Date() },
    });
    monto = round2(monto + amount);
    promociones.push(app.promotion.name);
  }

  return { revertidas: promociones.length, monto, promociones };
}

/**
 * Retira, en todas las facturas sin pagar, el descuento de una promoción que se
 * acaba de desactivar. Cliente por cliente y cada uno en su transacción, con un
 * respiro entre medias: una campaña de cartera son miles de notas y el Postgres
 * es compartido ([[postgres-conexiones-compartidas]]). Quien la llama no la
 * espera: la edición de la promo responde ya y esto corre detrás.
 *
 * Las notas débito dejan la factura editada, así que `pushEditedInvoices` sube el
 * total del legacy en su siguiente pasada y el portal vuelve a cobrar entero.
 */
export async function retirarDescuentosDePromocion(
  prisma: PrismaService,
  promotionId: string,
  editedBy?: string | null,
): Promise<{ clientes: number; facturas: number; monto: number; errores: number }> {
  const r = { clientes: 0, facturas: 0, monto: 0, errores: 0 };
  const apps = await prisma.promotionApplication.findMany({
    where: { promotionId, revertedAt: null },
    select: { invoiceId: true },
  });
  if (!apps.length) return r;
  const facturas = await prisma.subInvoice.findMany({
    where: { id: { in: apps.map((a) => a.invoiceId) }, status: { in: ['DUE', 'PARTIAL'] } },
    select: { subscriberId: true },
  });
  const clientes = [...new Set(facturas.map((f) => f.subscriberId).filter(Boolean) as string[])];
  for (const subscriberId of clientes) {
    try {
      const x = await prisma.$transaction((tx) =>
        revertirDescuentosVencidos(tx, subscriberId, { promotionId, editedBy: editedBy ?? null }));
      if (x.revertidas) {
        r.clientes++;
        r.facturas += x.revertidas;
        r.monto = round2(r.monto + x.monto);
      }
    } catch {
      r.errores++;
    }
    await new Promise((ok) => setTimeout(ok, 25));
  }
  return r;
}
