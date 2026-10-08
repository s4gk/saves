/**
 * Activos fijos (`/api/fixed-assets`): tipos y llamadas de la pantalla
 * `/contabilidad/activos-fijos`.
 */

export type EstadoActivo = "ACTIVE" | "FULLY_DEPRECIATED" | "DISPOSED";

export const ESTADO_ACTIVO: Record<EstadoActivo, { label: string; clase: string }> = {
  ACTIVE: { label: "En uso", clase: "bg-success-soft text-success-text" },
  FULLY_DEPRECIATED: { label: "Depreciado", clase: "bg-warning-soft text-warning-text" },
  DISPOSED: { label: "De baja", clase: "bg-surface-2 text-text-tertiary" },
};

export type CategoriaActivo = {
  id: string;
  code: string;
  name: string;
  usefulLifeMonths: number;
  assetAccount: { code: string; name: string } | null;
};

export type MetaActivos = {
  categories: CategoriaActivo[];
  branches: { id: string; name: string; costCenterId: string | null }[];
  costCenters: { id: string; code: string; name: string }[];
};

type Valores = {
  acquisitionCost: number;
  residualValue: number;
  accumulatedDepreciation: number;
  monthlyDepreciation: number;
  depreciationToDate: number;
  bookValue: number;
  /** Último mes contabilizado (`AAAA-MM`), o null si nunca se corrió. */
  postedThrough: string | null;
};

export type ActivoFila = Valores & {
  id: string;
  code: string;
  name: string;
  status: EstadoActivo;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  location: string | null;
  responsible: string | null;
  latitude: number | null;
  longitude: number | null;
  category: { id: string; code: string; name: string };
  branch: { id: string; name: string } | null;
  acquisitionDate: string;
  inServiceDate: string;
  usefulLifeMonths: number;
  photoCount: number;
  coverPhoto: { id: string; mimeType: string } | null;
};

export type ListaActivos = {
  total: number;
  page: number;
  pageSize: number;
  summary: { count: number; cost: number; depreciation: number; bookValue: number };
  rows: ActivoFila[];
};

export type FotoActivo = { id: string; name: string; mimeType: string; size: number; uploadedBy: string | null; createdAt: string };

export type ActivoDetalle = Valores & {
  id: string;
  code: string;
  name: string;
  status: EstadoActivo;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  location: string | null;
  responsible: string | null;
  supplier: string | null;
  invoiceNumber: string | null;
  notes: string | null;
  createdBy: string | null;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracy: number | null;
  gpsCapturedAt: string | null;
  gpsCapturedBy: string | null;
  category: { id: string; code: string; name: string; usefulLifeMonths: number };
  branch: { id: string; name: string } | null;
  costCenter: { id: string; code: string; name: string } | null;
  acquisitionDate: string;
  inServiceDate: string;
  usefulLifeMonths: number;
  disposalDate: string | null;
  disposalProceeds: number | null;
  photos: FotoActivo[];
  depreciations: { id: string; year: number; month: number; amount: number; accumulatedAfter: number; bookValueAfter: number }[];
};

/** Lo que envía el formulario (alta y edición). */
export type ActivoEntrada = {
  code?: string;
  name: string;
  categoryId: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  branchId?: string;
  location?: string;
  responsible?: string;
  supplier?: string;
  invoiceNumber?: string;
  acquisitionDate: string;
  inServiceDate?: string;
  acquisitionCost: number;
  residualValue?: number;
  usefulLifeMonths?: number;
  notes?: string;
  latitude?: number;
  longitude?: number;
  gpsAccuracy?: number;
};

export type PreviaDepreciacion = {
  year: number;
  month: number;
  total: number;
  rows: { id: string; code: string; name: string; category: string; branch: string | null; amount: number; accumulatedAfter: number; bookValueAfter: number }[];
};

export type ResultadoCargue = { created: number; skipped: number; errors: { row: number; message: string }[] };

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** El `message` de un cuerpo de error de la API (texto o lista de la validación). */
function mensajeDe(body: unknown, porDefecto: string): string {
  const m = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(m) && m.length) return m.join(" · ");
  return typeof m === "string" && m.trim() ? m : porDefecto;
}

async function json<T>(res: Response, porDefecto: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(mensajeDe(body, porDefecto));
  return body as T;
}

const JSON_H = { "Content-Type": "application/json" };

/** Baja un archivo servido por la API (va con la sesión, así que no sirve un <a href>). */
async function bajar(authFetch: AuthFetch, path: string, nombre: string) {
  const res = await authFetch(path);
  if (!res.ok) throw new Error(mensajeDe(await res.json().catch(() => null), "No se pudo descargar el archivo"));
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function activosApi(authFetch: AuthFetch) {
  const base = "/fixed-assets";
  return {
    meta: async () => json<MetaActivos>(await authFetch(`${base}/meta`), "No se pudieron cargar las categorías"),
    list: async (q: Record<string, string | number | undefined>) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v));
      return json<ListaActivos>(await authFetch(`${base}?${p}`), "No se pudo cargar el listado");
    },
    detail: async (id: string) => json<ActivoDetalle>(await authFetch(`${base}/${id}`), "No se pudo cargar el activo"),
    create: async (dto: ActivoEntrada) =>
      json<ActivoDetalle>(await authFetch(base, { method: "POST", headers: JSON_H, body: JSON.stringify(dto) }), "No se pudo crear el activo"),
    update: async (id: string, dto: Partial<ActivoEntrada>) =>
      json<ActivoDetalle>(await authFetch(`${base}/${id}`, { method: "PATCH", headers: JSON_H, body: JSON.stringify(dto) }), "No se pudo guardar"),
    remove: async (id: string) => json<{ deleted: boolean }>(await authFetch(`${base}/${id}`, { method: "DELETE" }), "No se pudo borrar"),
    dispose: async (id: string, dto: { date: string; proceeds?: number; reason: string }) =>
      json<ActivoDetalle>(await authFetch(`${base}/${id}/dispose`, { method: "POST", headers: JSON_H, body: JSON.stringify(dto) }), "No se pudo dar de baja"),
    setLocation: async (id: string, p: { latitude: number; longitude: number; accuracy?: number }) =>
      json<ActivoDetalle>(await authFetch(`${base}/${id}/location`, { method: "PUT", headers: JSON_H, body: JSON.stringify(p) }), "No se pudo guardar la ubicación"),
    clearLocation: async (id: string) =>
      json<ActivoDetalle>(await authFetch(`${base}/${id}/location`, { method: "DELETE" }), "No se pudo quitar la ubicación"),
    uploadPhoto: async (id: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return json<FotoActivo>(await authFetch(`${base}/${id}/photos`, { method: "POST", body: fd }), `No se pudo subir ${file.name}`);
    },
    deletePhoto: async (id: string, photoId: string) =>
      json<{ deleted: boolean }>(await authFetch(`${base}/${id}/photos/${photoId}`, { method: "DELETE" }), "No se pudo borrar la foto"),
    photoPath: (id: string, photoId: string) => `${base}/${id}/photos/${photoId}`,
    previewDepreciation: async (year: number, month: number) =>
      json<PreviaDepreciacion>(await authFetch(`${base}/depreciation/preview?year=${year}&month=${month}`), "No se pudo calcular la depreciación"),
    runDepreciation: async (year: number, month: number) =>
      json<{ total: number; assets: number; journalNumber?: number }>(
        await authFetch(`${base}/depreciation/run`, { method: "POST", headers: JSON_H, body: JSON.stringify({ year, month }) }),
        "No se pudo contabilizar la depreciación",
      ),
    importExcel: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return json<ResultadoCargue>(await authFetch(`${base}/import`, { method: "POST", body: fd }), "No se pudo cargar el Excel");
    },
    template: () => bajar(authFetch, `${base}/template`, "plantilla-activos-fijos.xlsx"),
    exportExcel: (q: Record<string, string | undefined>) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
      return bajar(authFetch, `${base}/export?${p}`, `activos-fijos-${new Date().toISOString().slice(0, 10)}.xlsx`);
    },
  };
}

export type ActivosApi = ReturnType<typeof activosApi>;

/** `Date` ISO del backend → `AAAA-MM-DD` en Bogotá (para los <input type="date">). */
export function aDia(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() - 5 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Por encima de esto el punto no sirve para ubicar un equipo dentro de un nodo. */
export const PRECISION_BAJA_M = 50;

export const enlaceMapa = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
