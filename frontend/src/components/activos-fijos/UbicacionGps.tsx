"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { fmtDateTime } from "@/lib/format";
import { MOTIVO_GEO, pedirUbicacion } from "@/lib/geo";
import { enlaceMapa, PRECISION_BAJA_M, type ActivoDetalle, type ActivosApi } from "@/lib/activos-fijos";

// Leaflet toca `window`: sólo en el cliente.
const Mapa = dynamic(() => import("@/components/map/Mapa").then((m) => m.Mapa), {
  ssr: false,
  loading: () => <div className="h-56 w-full animate-pulse rounded-xl bg-surface-2" />,
});

/** Punto recién tomado por el GPS del celular. */
export type PuntoGps = { lat: number; lng: number; accuracy: number };

/**
 * Pide el GPS con alta precisión y avisa en claro si no se pudo (permiso negado,
 * sin HTTPS, GPS apagado). Devuelve null si no hubo punto.
 */
export async function tomarGps(): Promise<PuntoGps | null> {
  const r = await pedirUbicacion(20000);
  if (!r.ok) { toast(MOTIVO_GEO[r.motivo], "alert-triangle"); return null; }
  if (r.accuracy > PRECISION_BAJA_M) {
    toast(`Precisión baja (±${r.accuracy} m). Si puedes, sal al aire libre y vuelve a tomarla.`, "alert-triangle");
  }
  return { lat: r.lat, lng: r.lng, accuracy: r.accuracy };
}

/** Texto de la precisión, en ámbar cuando no sirve para ubicar el equipo. */
export function Precision({ m }: { m: number | null | undefined }) {
  if (m == null) return null;
  return <span className={m > PRECISION_BAJA_M ? "text-warning-text" : "text-text-tertiary"}>±{m} m</span>;
}

/** Sección de la ficha: el punto en el mapa, quién lo tomó y el botón para tomarlo aquí. */
export function UbicacionGps({
  api, activo, puedeEditar, onCambio,
}: {
  api: ActivosApi;
  activo: ActivoDetalle;
  puedeEditar: boolean;
  onCambio: (a: ActivoDetalle) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const tiene = activo.latitude != null && activo.longitude != null;

  async function capturar() {
    if (tiene && !confirm("Este activo ya tiene ubicación. ¿Reemplazarla por el punto donde estás ahora?")) return;
    setOcupado(true);
    try {
      const p = await tomarGps();
      if (!p) return;
      onCambio(await api.setLocation(activo.id, { latitude: p.lat, longitude: p.lng, accuracy: p.accuracy }));
      toast("Ubicación guardada", "check");
    } catch (e) {
      toast((e as Error).message, "alert-triangle");
    } finally {
      setOcupado(false);
    }
  }

  async function quitar() {
    if (!confirm("¿Quitar la ubicación GPS de este activo?")) return;
    try { onCambio(await api.clearLocation(activo.id)); }
    catch (e) { toast((e as Error).message, "alert-triangle"); }
  }

  return (
    <section className="rounded-xl border border-border-subtle bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13px] font-bold text-text-primary">
          <Icon name="map-pin" size={15} /> Ubicación GPS
        </h2>
        {puedeEditar && (
          <div className="flex gap-2">
            {tiene && (
              <Button size="sm" variant="ghost" onClick={() => void quitar()}>Quitar</Button>
            )}
            <Button size="sm" onClick={() => void capturar()} disabled={ocupado}>
              <Icon name="map-pin" size={13} /> {ocupado ? "Tomando GPS…" : tiene ? "Tomar de nuevo aquí" : "Tomar ubicación aquí"}
            </Button>
          </div>
        )}
      </div>

      {tiene ? (
        <>
          <div className="h-56 overflow-hidden rounded-xl">
            <Mapa
              puntos={[{
                id: activo.id, tipo: "nap", lat: activo.latitude!, lng: activo.longitude!,
                titulo: `${activo.code} · ${activo.name}`, color: "#0ea5e9",
                radioM: activo.gpsAccuracy ?? undefined,
                detalles: [{ label: "Ubicación", valor: activo.location }, { label: "Sede", valor: activo.branch?.name }],
              }]}
              centro={{ lat: activo.latitude!, lng: activo.longitude! }}
              zoom={17}
              ajustarA={false}
              alto="100%"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span className="font-mono text-text-secondary">
              {activo.latitude!.toFixed(6)}, {activo.longitude!.toFixed(6)} <Precision m={activo.gpsAccuracy} />
            </span>
            <a href={enlaceMapa(activo.latitude!, activo.longitude!)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
              <Icon name="external-link" size={12} /> Abrir en Google Maps
            </a>
          </div>
          {activo.gpsCapturedAt && (
            <p className="mt-1 text-[11.5px] text-text-tertiary">
              Tomada por {activo.gpsCapturedBy ?? "—"} el {fmtDateTime(activo.gpsCapturedAt)}
            </p>
          )}
        </>
      ) : (
        <p className="text-[12.5px] text-text-tertiary">
          Sin ubicación. {puedeEditar ? "Párate junto al equipo con el celular y pulsa «Tomar ubicación aquí»." : ""}
        </p>
      )}
    </section>
  );
}
