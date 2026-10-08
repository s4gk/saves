"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { useAuth } from "@/context/AuthProvider";
import { fmtDateTime } from "@/lib/format";
import type { ActivosApi, FotoActivo } from "@/lib/activos-fijos";

/**
 * Las fotos se sirven detrás del token y con `attachment`, así que no se puede
 * apuntar un `<img src>` a la ruta: se bajan con la sesión y se envuelven en un
 * blob. Se guardan por id para que la miniatura del listado y el visor del
 * detalle no bajen dos veces la misma foto.
 */
const cache = new Map<string, Promise<string | null>>();

function useFoto(path: string | null, mimeType?: string) {
  const { authFetch } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    let vivo = true;
    let p = cache.get(path);
    if (!p) {
      p = authFetch(path)
        .then(async (res) => {
          if (!res.ok) return null;
          const blob = await res.blob();
          return URL.createObjectURL(new Blob([blob], { type: mimeType || blob.type }));
        })
        .catch(() => null);
      cache.set(path, p);
    }
    p.then((u) => { if (vivo) setUrl(u); });
    return () => { vivo = false; };
  }, [authFetch, path, mimeType]);
  return url;
}

/** Miniatura cuadrada. Sin foto, un marcador con el ícono de cámara. */
export function MiniaturaActivo({
  path, mimeType, size = 44, className = "",
}: { path: string | null; mimeType?: string; size?: number; className?: string }) {
  const url = useFoto(path, mimeType);
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-surface-2 text-text-tertiary ${className}`}
      style={{ width: size, height: size }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <Icon name="camera" size={Math.round(size * 0.4)} />
      )}
    </span>
  );
}

function FotoGrande({ path, mimeType }: { path: string; mimeType: string }) {
  const url = useFoto(path, mimeType);
  if (!url) return <div className="flex h-64 items-center justify-center text-text-tertiary">Cargando foto…</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="max-h-[70dvh] w-full rounded-lg object-contain" />;
}

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Galería del activo: rejilla de fotos, visor y el botón para subir más. En el
 * celular el selector ofrece la cámara o la galería, y se pueden elegir varias a
 * la vez (el equipo, la placa con el serial, dónde quedó instalado).
 */
export function GaleriaActivo({
  api, assetId, fotos, puedeEditar, onCambio,
}: {
  api: ActivosApi;
  assetId: string;
  fotos: FotoActivo[];
  puedeEditar: boolean;
  onCambio: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState<{ hechas: number; total: number } | null>(null);
  const [visor, setVisor] = useState<number | null>(null);
  const [borrando, setBorrando] = useState(false);

  async function subir(files: FileList | null) {
    const lista = Array.from(files ?? []);
    if (!lista.length) return;
    setSubiendo({ hechas: 0, total: lista.length });
    let ok = 0;
    for (const f of lista) {
      try {
        if (f.size > MAX_BYTES) throw new Error(`${f.name} supera los 20 MB`);
        await api.uploadPhoto(assetId, f);
        ok++;
      } catch (e) {
        toast((e as Error).message, "alert-triangle");
      }
      setSubiendo((s) => (s ? { ...s, hechas: s.hechas + 1 } : s));
    }
    setSubiendo(null);
    if (input.current) input.current.value = "";
    if (ok) toast(ok === 1 ? "Foto subida" : `${ok} fotos subidas`, "check");
    onCambio();
  }

  async function borrar(foto: FotoActivo) {
    if (!confirm("¿Borrar esta foto?")) return;
    setBorrando(true);
    try {
      await api.deletePhoto(assetId, foto.id);
      cache.delete(api.photoPath(assetId, foto.id));
      setVisor(null);
      onCambio();
    } catch (e) {
      toast((e as Error).message, "alert-triangle");
    } finally {
      setBorrando(false);
    }
  }

  const actual = visor != null ? fotos[visor] : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {fotos.map((f, i) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setVisor(i)}
            className="aspect-square cursor-pointer overflow-hidden rounded-lg"
            aria-label={`Ver foto ${i + 1}`}
          >
            <MiniaturaActivo path={api.photoPath(assetId, f.id)} mimeType={f.mimeType} size={200} className="!h-full !w-full" />
          </button>
        ))}
        {puedeEditar && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={!!subiendo}
            className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border-default text-[12px] font-semibold text-text-secondary hover:bg-surface-2 disabled:opacity-60"
          >
            <Icon name="camera" size={22} />
            {subiendo ? `Subiendo ${subiendo.hechas}/${subiendo.total}…` : "Agregar fotos"}
          </button>
        )}
      </div>
      {!fotos.length && !puedeEditar && <p className="text-[12.5px] text-text-tertiary">Sin fotos.</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void subir(e.target.files)}
      />

      <Modal open={!!actual} onClose={() => setVisor(null)} title={actual ? `Foto ${visor! + 1} de ${fotos.length}` : ""} maxWidth="max-w-3xl">
        {actual && (
          <div className="flex flex-col gap-3">
            <FotoGrande path={api.photoPath(assetId, actual.id)} mimeType={actual.mimeType} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-tertiary">
              <span>{actual.uploadedBy ?? "—"} · {fmtDateTime(actual.createdAt)}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={visor === 0} onClick={() => setVisor((v) => (v ? v - 1 : v))}>
                  <Icon name="chevron-left" size={14} /> Anterior
                </Button>
                <Button size="sm" variant="secondary" disabled={visor === fotos.length - 1} onClick={() => setVisor((v) => (v != null && v < fotos.length - 1 ? v + 1 : v))}>
                  Siguiente <Icon name="chevron-right" size={14} />
                </Button>
                {puedeEditar && (
                  <Button size="sm" variant="danger" disabled={borrando} onClick={() => void borrar(actual)}>
                    <Icon name="trash" size={13} /> Borrar
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
