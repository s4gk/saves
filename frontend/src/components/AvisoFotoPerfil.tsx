"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { UserAvatar, notifyPhotoChanged } from "@/components/UserAvatar";
import { useAuth } from "@/context/AuthProvider";
import { mensajeDeError } from "@/lib/errores";

/**
 * Puerta de la foto de perfil: quien NO tiene foto no puede usar el sistema hasta
 * subirla. Es una capa a pantalla completa por encima de todo (menú incluido) que
 * no se cierra con Escape, ni con clic afuera, ni tiene «Más tarde»: las únicas
 * salidas son subir la foto o cerrar sesión (para no dejar a nadie atrapado).
 *
 * Solo a quien tiene ficha de empleado (`staff`): la foto vive en `Staff.picture`
 * y sin ficha el backend no tiene dónde guardarla — pedírsela sería un callejón.
 * Si `GET /profile` falla no se bloquea: un fallo de red no debe dejar a todos fuera.
 */
export function AvisoFotoPerfil() {
  const { user, authFetch, logout } = useAuth();
  const userId = user?.id ?? null;
  const [abierto, setAbierto] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!userId) { setAbierto(false); return; }
    let vivo = true;
    authFetch("/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { staff: unknown; hasPhoto: boolean } | null) => {
        if (vivo && p && p.staff && !p.hasPhoto) setAbierto(true);
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [authFetch, userId]);

  // Mientras está abierta, el teclado no llega a la página de detrás.
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [abierto]);

  async function subir(file: File) {
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await authFetch("/profile/photo", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message);
      notifyPhotoChanged();
      toast("Foto de perfil guardada", "camera");
      setAbierto(false);
    } catch (e) {
      toast(mensajeDeError(e, "No se pudo subir la foto"), "x");
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="titulo-foto-obligatoria"
        className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-border-subtle bg-surface p-5 text-center shadow-2xl"
      >
        <span id="titulo-foto-obligatoria" className="text-[15px] font-bold text-text-primary">
          Sube tu foto de perfil
        </span>
        <UserAvatar size={88} className="text-[26px]" />
        <p className="text-[13px] text-text-secondary">
          Para seguir usando el sistema debes subir una foto tuya, de frente y
          reconocible, para que tus compañeros y los clientes te identifiquen.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); }}
        />
        <Button className="w-full" autoFocus disabled={subiendo} onClick={() => fileRef.current?.click()}>
          <Icon name={subiendo ? "loader" : "camera"} size={14} className={subiendo ? "animate-spin" : ""} />
          {subiendo ? "Subiendo…" : "Subir foto"}
        </Button>
        <button
          type="button"
          disabled={subiendo}
          onClick={() => void logout()}
          className="text-[12px] text-text-tertiary underline hover:text-text-primary"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
