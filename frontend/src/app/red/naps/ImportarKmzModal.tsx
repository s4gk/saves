"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/Modal";
import { toast } from "@/components/ui/Toast";
import { useAuth } from "@/context/AuthProvider";
import type { BranchOpt } from "@/lib/network";
import { mensajeDeError } from "@/lib/errores";

type Fila = {
  kmz: string; carpeta: string; lat: number; lng: number;
  coincidencia: "exacta" | "parecida" | "ambigua" | "sin_caja" | "repetida";
  napId: string | null; nap: string | null; candidatas?: string[];
  efecto: "nueva" | "mueve" | "igual" | null; distancia: number | null; seAplica: boolean;
};
type Resultado = {
  sede: string; aplicado: boolean; aplicadas: number;
  resumen: {
    marcadores: number; descartados: number; exactas: number; parecidas: number; ambiguas: number;
    sinCaja: number; repetidas: number; nuevas: number; mueven: number; iguales: number;
    seAplicarian: number; cajasSede: number; cajasSinPunto: number;
  };
  filas: Fila[];
};

type Vista = "aplican" | "mueven" | "revisar" | "sin_caja" | "todas";

/**
 * Ubicación de las cajas NAP desde el KMZ de Google Earth. Dos pasos: primero
 * REVISAR (el servidor empareja por nombre y no toca nada), después APLICAR.
 * Por defecto sólo se escriben las cajas de nombre exacto que no tenían GPS; mover
 * las que ya tenían punto, o aceptar nombres "parecidos", hay que pedirlo.
 */
export function ImportarKmzModal({ open, branch, onClose, onAplicado }: {
  open: boolean; branch: BranchOpt; onClose: () => void; onAplicado: () => void;
}) {
  const { authFetch } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [sobrescribir, setSobrescribir] = useState(false);
  const [parecidas, setParecidas] = useState(false);
  const [res, setRes] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("aplican");

  useEffect(() => {
    if (!open) return;
    setFile(null); setSobrescribir(false); setParecidas(false); setRes(null); setErr(null); setVista("aplican");
  }, [open]);

  async function enviar(aplicar: boolean, opc = { sobrescribir, parecidas }) {
    if (!file) return;
    setCargando(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const qs = new URLSearchParams({ branchId: branch.id });
      if (aplicar) qs.set("aplicar", "1");
      if (opc.sobrescribir) qs.set("sobrescribir", "1");
      if (opc.parecidas) qs.set("parecidas", "1");
      const r = await authFetch(`/network/naps/importar-kmz?${qs}`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.message || "No se pudo leer el KMZ");
      if (aplicar) {
        toast(`${d.aplicadas} caja${d.aplicadas === 1 ? "" : "s"} NAP ubicada${d.aplicadas === 1 ? "" : "s"} en ${d.sede}`);
        onAplicado();
        return;
      }
      setRes(d);
    } catch (e) {
      setErr(mensajeDeError(e, "No se pudo leer el KMZ"));
    } finally {
      setCargando(false);
    }
  }

  // Las casillas cambian qué se aplicaría: se vuelve a revisar con el mismo archivo.
  function cambiarOpcion(o: { sobrescribir: boolean; parecidas: boolean }) {
    setSobrescribir(o.sobrescribir); setParecidas(o.parecidas);
    if (res) void enviar(false, o);
  }

  const filas = useMemo(() => {
    const f = res?.filas ?? [];
    switch (vista) {
      case "aplican": return f.filter((x) => x.seAplica);
      case "mueven": return f.filter((x) => x.efecto === "mueve" && x.coincidencia !== "repetida");
      case "revisar": return f.filter((x) => x.coincidencia === "parecida" || x.coincidencia === "ambigua" || x.coincidencia === "repetida");
      case "sin_caja": return f.filter((x) => x.coincidencia === "sin_caja");
      default: return f;
    }
  }, [res, vista]);

  const s = res?.resumen;
  const pestañas: { k: Vista; label: string; n: number }[] = s ? [
    { k: "aplican", label: "Se aplican", n: s.seAplicarian },
    { k: "mueven", label: "Ya tenían otro punto", n: s.mueven },
    { k: "revisar", label: "Para revisar", n: s.parecidas + s.ambiguas + s.repetidas },
    { k: "sin_caja", label: "Sin caja en el sistema", n: s.sinCaja },
    { k: "todas", label: "Todas", n: s.marcadores },
  ] : [];

  return (
    <Modal open={open} onClose={onClose} title={`Ubicar cajas NAP desde Google Earth · ${branch.name}`} maxWidth="max-w-4xl">
      <div className="space-y-3">
        <p className="text-[12px] text-text-secondary">
          Sube el <b>.kmz</b> (o .kml) exportado de Google Earth. Cada marcador se empareja con la caja de <b>{branch.name}</b> que
          tenga el mismo nombre (sin importar espacios, guiones ni mayúsculas). Primero se revisa; nada se guarda hasta pulsar «Aplicar».
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRes(null); setErr(null); }}
            className="text-[12px] file:mr-2 file:rounded-md file:border file:border-border-default file:bg-surface-2 file:px-3 file:py-1.5 file:text-[12px] file:text-text-primary"
          />
          <Button size="sm" variant="secondary" disabled={!file || cargando} onClick={() => enviar(false)}>
            <Icon name="search" size={13} /> {cargando && !res ? "Leyendo…" : "Revisar"}
          </Button>
        </div>

        <div className="flex flex-col gap-1.5 text-[12px] text-text-secondary">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={sobrescribir} onChange={(e) => cambiarOpcion({ sobrescribir: e.target.checked, parecidas })} />
            <span>Mover también las cajas que <b>ya tenían ubicación</b> y en el KMZ están en otro sitio (a más de 15 m).</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={parecidas} onChange={(e) => cambiarOpcion({ sobrescribir, parecidas: e.target.checked })} />
            <span>Aceptar nombres <b>parecidos</b> (uno termina en el otro, p. ej. «VLS13_12» → «MY- VLS13 _12»). Revísalos antes.</span>
          </label>
        </div>

        {err && <p className="text-[12px] text-error-text">{err}</p>}

        {s && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Cifra label="Marcadores en el KMZ" valor={s.marcadores} nota={s.descartados ? `${s.descartados} sin coordenada válida` : undefined} />
              <Cifra label="Emparejados" valor={s.exactas + s.parecidas} nota={s.parecidas ? `${s.parecidas} por parecido` : "todos exactos"} />
              <Cifra label="Se aplicarían" valor={s.seAplicarian} tono="brand" nota={`${s.nuevas} sin ubicación antes`} />
              <Cifra label="Cajas que el KMZ no trae" valor={s.cajasSinPunto} nota={`de ${s.cajasSede} en la sede`} />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {pestañas.map((p) => (
                <button
                  key={p.k}
                  onClick={() => setVista(p.k)}
                  className={`rounded-full border px-3 py-1 text-[12px] ${vista === p.k ? "border-brand bg-brand-soft text-brand" : "border-border-default text-text-secondary hover:bg-surface-2"}`}
                >
                  {p.label} <span className="font-mono">{p.n}</span>
                </button>
              ))}
            </div>

            <div className="max-h-[45vh] overflow-auto">
              <DataTable
                rows={filas}
                empty="Nada en esta vista."
                columns={[
                  { key: "kmz", header: "En el KMZ", render: (f) => (
                    <span className="flex flex-col">
                      <span className="font-medium text-text-primary">{f.kmz}</span>
                      {f.carpeta && <span className="text-[11px] text-text-tertiary">{f.carpeta}</span>}
                    </span>
                  ) },
                  { key: "nap", header: "Caja en el sistema", render: (f) => f.nap
                    ? <a href={`/red/naps/${f.napId}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">{f.nap}</a>
                    : f.candidatas ? <span className="text-[11px] text-text-tertiary">¿{f.candidatas.join(" o ")}?</span> : "—" },
                  { key: "c", header: "Coincidencia", render: (f) => <Badge {...COINC[f.coincidencia]} /> },
                  { key: "e", header: "Efecto", render: (f) => f.coincidencia === "repetida" || !f.efecto ? "—"
                    : f.efecto === "nueva" ? <Badge tone="success" label="Sin ubicación antes" />
                    : f.efecto === "igual" ? <Badge tone="default" label="Ya estaba ahí" />
                    : <Badge tone="warning" label={`Se mueve ${fmtDist(f.distancia)}`} /> },
                  { key: "p", header: "Punto", align: "right", render: (f) => (
                    <a href={`/mapa/ruta?lat=${f.lat}&lng=${f.lng}&nombre=${encodeURIComponent(f.kmz)}`} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-text-secondary hover:underline">
                      {f.lat.toFixed(5)}, {f.lng.toFixed(5)}
                    </a>
                  ) },
                  { key: "ok", header: "", align: "right", render: (f) => f.seAplica ? <Icon name="check" size={14} className="text-success-text" aria-label="Se aplica" /> : null },
                ]}
              />
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>Cerrar</Button>
          <Button variant="primary" size="sm" disabled={!s || s.seAplicarian === 0 || cargando} onClick={() => enviar(true)}>
            <Icon name="map-pin" size={13} /> {cargando && res ? "Guardando…" : `Aplicar ${s?.seAplicarian ?? 0} ubicaciones`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const COINC: Record<Fila["coincidencia"], { tone: "success" | "warning" | "error" | "default" | "info"; label: string }> = {
  exacta: { tone: "success", label: "Exacta" },
  parecida: { tone: "warning", label: "Parecida" },
  ambigua: { tone: "error", label: "Varias cajas" },
  sin_caja: { tone: "default", label: "No existe" },
  repetida: { tone: "info", label: "Marcador repetido" },
};

function fmtDist(m: number | null) {
  if (m == null) return "";
  return m >= 1000 ? `${(m / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} km` : `${m} m`;
}

function Cifra({ label, valor, nota, tono }: { label: string; valor: number; nota?: string; tono?: "brand" }) {
  return (
    <div className="rounded-lg border border-border-default px-3 py-2">
      <div className="text-[11px] text-text-tertiary">{label}</div>
      <div className={`font-mono text-[18px] font-bold ${tono === "brand" ? "text-brand" : "text-text-primary"}`}>{valor.toLocaleString("es-CO")}</div>
      {nota && <div className="text-[11px] text-text-tertiary">{nota}</div>}
    </div>
  );
}
