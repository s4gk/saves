// Cliente/tipos del catálogo de planes de servicio (vertical Vestel).

export type ServiceKind = "INTERNET" | "TV" | "PUNTOS" | "STREAMING";

export const SERVICE_KIND_LABEL: Record<ServiceKind, string> = {
  INTERNET: "Internet",
  TV: "Televisión",
  PUNTOS: "Puntos TV",
  STREAMING: "Streaming",
};

export type Plan = {
  id: string;
  name: string;
  kind: ServiceKind;
  pppProfile: string | null;
  price: number;
  taxRate: number; // IVA% (TV=19, internet=0)
  megas: number | null;
  active: boolean;
  subscribers: number; // cuántos abonados usan el plan
};

/** Un plan dentro de un combo, con lo que vale dentro y lo que vale suelto. */
export type BundleItem = {
  planId: string;
  planName: string;
  kind: ServiceKind;
  price: number; // precio dentro del combo (base sin IVA)
  listPrice: number; // precio del plan suelto
  taxRate: number;
  megas: number | null;
  planActive: boolean;
};

/** Una app (producto OTT de PlayHub) que se puede ofrecer dentro de un combo. */
export type BundleApp = {
  /** Código del catálogo de PlayHub: es lo que se guarda y lo que viaja a su API. */
  code: string;
  name: string;
  /** Área comercial a la que pertenece: Standard, Premium, Premium Plus, Diamante. */
  area: string;
};

/**
 * Combo comercial: varios planes vendidos juntos a precio propio.
 * `total`/`savings` los calcula el backend para que la pantalla no repita la cuenta.
 */
export type Bundle = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  items: BundleItem[];
  /** Apps que el cliente puede elegir con el combo. Vacío = no ofrece apps. */
  apps: BundleApp[];
  total: number;
  listTotal: number;
  savings: number;
  subscribers: number;
};

/** Resultado de cambiar el plan de un abonado (incluye el empuje al router). */
export type ChangePlanResult = {
  ok: boolean;
  plan: { id: string; name: string; price: number; pppProfile: string | null };
  router: {
    ok: boolean;
    dryRun: boolean;
    action: string;
    steps: string[];
    message: string;
    error?: string;
    mikrotik?: { name: string; host: string };
  } | null;
};

/** «100 Megas + Television»: qué trae un combo, internet primero. */
export function partesDelCombo(b: Bundle): string {
  const orden: Record<string, number> = { INTERNET: 0, TV: 1, PUNTOS: 2, STREAMING: 3 };
  return [...b.items]
    .sort((x, y) => (orden[x.kind] ?? 9) - (orden[y.kind] ?? 9))
    .map((i) => (i.kind === "INTERNET" && i.megas != null ? `${i.megas} Megas` : i.planName.trim()))
    .join(" + ");
}

/**
 * El combo que forman un plan de internet y uno de TV: el que trae EXACTAMENTE esos
 * dos (los de streaming son otro producto). `null` si no hay ninguno armado.
 * Espejo de `comboPorPlanes` en el backend.
 */
export function comboDePlanes(combos: Bundle[], internetId: string, tvId: string): Bundle | null {
  if (!internetId || !tvId) return null;
  return combos
    .filter((b) => b.items.length === 2
      && b.items.some((i) => i.kind === "INTERNET" && i.planId === internetId)
      && b.items.some((i) => i.kind === "TV" && i.planId === tvId))
    .sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
}
