"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthProvider";
import { initials } from "@/lib/auth";

/** Se dispara al subir o quitar la foto para que todos los avatares se refresquen. */
export const PHOTO_CHANGED_EVENT = "nexus:profile-photo";

/**
 * Caché a nivel de módulo del blob de la foto propia.
 *
 * El endpoint pide token (`Authorization`), así que no se puede poner en el
 * `src` de un `<img>` y hay que traerlo por fetch. Sin esta caché, cada montaje
 * del sidebar o del perfil pediría la imagen otra vez; con ella se pide UNA vez
 * por sesión y los demás avatares reutilizan el mismo object URL.
 *
 * `null` = ya se consultó y no hay foto. `undefined` = todavía no se ha mirado.
 *
 * Se guarda CON el id del dueño: cerrar sesión no recarga la página (es un
 * `router.replace`), así que sin esa comprobación el siguiente que entrara desde
 * el mismo navegador vería la foto del anterior.
 */
let cache: string | null | undefined;
let cacheDe: string | null = null;
let enVuelo: Promise<string | null> | null = null;

function invalidar() {
  if (cache) URL.revokeObjectURL(cache);
  cache = undefined;
  cacheDe = null;
  enVuelo = null;
}

/** Avisa a todos los avatares montados de que la foto cambió. */
export function notifyPhotoChanged() {
  invalidar();
  window.dispatchEvent(new CustomEvent(PHOTO_CHANGED_EVENT));
}

function cargar(authFetch: (p: string) => Promise<Response>, userId: string): Promise<string | null> {
  if (cacheDe !== userId) invalidar();
  if (cache !== undefined) return Promise.resolve(cache);
  cacheDe = userId;
  enVuelo ??= authFetch("/profile/photo")
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => {
      cache = b ? URL.createObjectURL(b) : null;
      return cache;
    })
    .catch(() => {
      cache = null;
      return null;
    });
  return enVuelo;
}

/**
 * Avatar del usuario en sesión: su foto si la tiene, o sus iniciales.
 *
 * Las iniciales se pintan siempre debajo, así que mientras la foto viaja (o si
 * no hay) nunca se ve un hueco gris.
 */
export function UserAvatar({
  size = 32,
  className = "",
  title,
}: {
  /** Lado del círculo en píxeles. */
  size?: number;
  className?: string;
  title?: string;
}) {
  const { user, authFetch } = useAuth();
  const userId = user?.id ?? null;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) { setUrl(null); return; }
    let vivo = true;
    const sync = () => {
      void cargar(authFetch, userId).then((u) => { if (vivo) setUrl(u); });
    };
    sync();
    window.addEventListener(PHOTO_CHANGED_EVENT, sync);
    return () => {
      vivo = false;
      window.removeEventListener(PHOTO_CHANGED_EVENT, sync);
    };
  }, [authFetch, userId]);

  const texto = user ? initials(user.name) : "··";
  return (
    <span
      title={title ?? user?.name}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent font-semibold text-white ${className}`}
    >
      {texto}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
    </span>
  );
}

/**
 * Fotos de OTROS empleados (`GET /staff/:id/photo`, solo Administración y
 * Gerencia). Caché por sesión como la propia: la lista de empleados monta un
 * avatar por fila y volver a ella no debe pedirlas todas otra vez. Se guarda la
 * promesa, así dos montajes simultáneos comparten la misma petición.
 */
const fotosStaff = new Map<string, Promise<string | null>>();
let fotosStaffDe: string | null = null;

function cargarStaff(authFetch: (p: string) => Promise<Response>, userId: string, staffId: string): Promise<string | null> {
  if (fotosStaffDe !== userId) {
    fotosStaff.forEach((p) => void p.then((u) => u && URL.revokeObjectURL(u)));
    fotosStaff.clear();
    fotosStaffDe = userId;
  }
  let p = fotosStaff.get(staffId);
  if (!p) {
    p = authFetch(`/staff/${encodeURIComponent(staffId)}/photo`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? URL.createObjectURL(b) : null))
      .catch(() => null);
    fotosStaff.set(staffId, p);
  }
  return p;
}

/** Descarta la foto guardada de un empleado (tras cambiarla o quitarla). */
export function olvidarFotoStaff(staffId: string) {
  const p = fotosStaff.get(staffId);
  fotosStaff.delete(staffId);
  void p?.then((u) => u && URL.revokeObjectURL(u));
}

/**
 * Avatar de un empleado cualquiera: su foto o sus iniciales.
 *
 * `hasPhoto=false` evita la petición (la lista ya sabe quién no tiene foto y
 * serían decenas de 404). `onOpen` recibe la foto cargada para verla en grande;
 * con `abrirSinFoto` también se puede abrir sin foto (para subirle una).
 * `version` cambia después de subir o quitar la foto para volver a pedirla.
 */
export function StaffAvatar({
  staffId,
  name,
  hasPhoto = true,
  size = 32,
  className = "",
  onOpen,
  abrirSinFoto = false,
  version = 0,
}: {
  staffId: string;
  name: string;
  hasPhoto?: boolean;
  size?: number;
  className?: string;
  onOpen?: (url: string | null) => void;
  abrirSinFoto?: boolean;
  version?: number;
}) {
  const { user, authFetch } = useAuth();
  const userId = user?.id ?? null;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    if (!userId || !hasPhoto) return;
    let vivo = true;
    void cargarStaff(authFetch, userId, staffId).then((u) => { if (vivo) setUrl(u); });
    return () => { vivo = false; };
  }, [authFetch, userId, staffId, hasPhoto, version]);

  const clase = `relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent font-semibold text-white ${className}`;
  const estilo = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) };
  const contenido = (
    <>
      {initials(name)}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
    </>
  );
  if (onOpen && (url || abrirSinFoto)) {
    return (
      <button type="button" title={url ? `Ver la foto de ${name}` : `Subir una foto para ${name}`} onClick={() => onOpen(url)} style={estilo} className={`${clase} ${url ? "cursor-zoom-in" : "cursor-pointer"}`}>
        {contenido}
      </button>
    );
  }
  return <span title={name} style={estilo} className={clase}>{contenido}</span>;
}
