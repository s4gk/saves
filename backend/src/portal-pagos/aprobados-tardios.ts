/**
 * EL PAGO QUE SE APROBÓ EN EL REINTENTO.
 *
 * El widget de Wompi deja reintentar con la MISMA referencia: el banco rechaza el
 * primer intento, el cliente vuelve a darle y el segundo sale aprobado. Wompi manda
 * un aviso por cada intento, pero `Tickets::data_reception_wompi` del portal sólo
 * atiende órdenes en "Inicial" — y el aviso del rechazo ya la dejó en "Finalizada
 * sin Exito". El aprobado se guarda en `data_reception` y nadie lo mira: el cliente
 * pagó, Wompi cobró y la factura sigue abierta.
 *
 * Medido el 2026-09-25: 18 casos en 60 días (PSE casi todos, alguno de Bancolombia y
 * de tarjeta). 15 los había cargado alguien a mano, días después y con el comprobante
 * del cliente en la mano; 2 seguían sin aplicar.
 *
 * Aquí viven las piezas sin base de datos: leer el aviso y decidir si se aplica. La
 * decisión se toma contra lo que dice la API de Wompi, NUNCA contra el aviso, porque
 * el endpoint del portal es público y no valida la firma: cualquiera puede dejar ahí
 * un "APPROVED" inventado.
 */

/** Un aviso de Wompi tal como el portal lo guarda en `crm_vestel.data_reception`. */
export type AvisoWompi = {
  reference: string;
  /** Con guiones, como lo da Wompi (el portal los quita al guardarlo en la orden). */
  transactionId: string;
  status: string;
};

/** Lo que devuelve `GET /v1/transactions/:id` de Wompi (sólo lo que se usa). */
export type TransaccionWompi = {
  id: string;
  status: string;
  reference: string;
  amount_in_cents: number;
  currency: string;
  payment_method_type?: string | null;
  finalized_at?: string | null;
  created_at?: string | null;
};

/**
 * El aviso aprobado, o `null` si la fila no es eso. En `data_reception` también hay
 * avisos de PayU (con formato de formulario, no JSON) y de rechazos.
 */
export function avisoAprobado(data: string): AvisoWompi | null {
  let r: any;
  try {
    r = JSON.parse(data);
  } catch {
    return null;
  }
  const t = r?.data?.transaction;
  if (!t || t.status !== 'APPROVED') return null;
  const reference = String(t.reference ?? '').trim();
  const transactionId = String(t.id ?? '').trim();
  if (!reference || !transactionId) return null;
  return { reference, transactionId, status: t.status };
}

/**
 * Por qué NO se aplica el pago solo, o `null` si se puede aplicar.
 *
 * `pagosPosteriores` son los ingresos del abonado desde el día del pago. Si hay alguno,
 * lo más probable es que alguien lo haya cargado a mano con el comprobante (así se
 * resolvieron 15 de los 18 casos), y como esos cargues no llevan la referencia de
 * Wompi, no se pueden cruzar con el pago. Aplicarlo sería cobrarle dos veces, así
 * que se deja marcado para que lo mire una persona.
 */
export function motivoParaNoAplicar(p: {
  reference: string;
  debe: number;
  tx: TransaccionWompi | null;
  pagosPosteriores: number;
}): string | null {
  const { tx } = p;
  if (!tx) return 'Wompi no encuentra la transacción';
  if (tx.status !== 'APPROVED') return `Wompi la tiene como ${tx.status}`;
  if (tx.reference !== p.reference) return 'la transacción es de otra referencia';
  if ((tx.currency ?? 'COP') !== 'COP') return `moneda ${tx.currency}`;
  if (Math.round(Number(tx.amount_in_cents)) !== Math.round(p.debe * 100)) {
    return `el valor no coincide (Wompi ${Number(tx.amount_in_cents) / 100}, portal ${p.debe})`;
  }
  if (p.pagosPosteriores > 0) {
    return 'el abonado tiene otro pago desde ese día: puede que ya lo hayan cargado a mano';
  }
  return null;
}

/** La marca que deja `recogerAprobadosTardios` en `PaymentOrder.rawWebhook`, si la hay. */
export function marcaTardio(raw: unknown): {
  dia?: string; reintentar?: boolean; revisar?: string; descartado?: string;
} | null {
  const m = (raw as any)?.aprobadoTardio;
  return m && typeof m === 'object' ? m : null;
}

/** 'YYYY-MM-DD' en hora de Colombia. */
export function diaBogota(iso: string | Date): string {
  const d = new Date(new Date(iso).getTime() - 5 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
