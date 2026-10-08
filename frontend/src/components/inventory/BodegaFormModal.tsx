"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/Modal";
import { Input, Select, Field } from "@/components/ui/Field";
import { toast } from "@/components/ui/Toast";
import { useAuth } from "@/context/AuthProvider";
import { mensajeDeError } from "@/lib/errores";

/** Lo que el formulario necesita de una bodega (sale de `GET /inventory/warehouses`). */
export type BodegaEditable = {
  id: string; title: string; extra: string | null;
  technicianStaffId: string | null; managerId: string | null;
  branchLegacy: number | null; isMain: boolean;
};

type SedeOption = { legacyId: number; name: string };
type UserOption = { id: string; name: string; email: string | null };
type TecnicoOption = { id: string; name: string };

/**
 * Crear o editar una bodega de material. Lo comparten la lista de bodegas y el
 * detalle de una bodega; sólo se monta para quien puede administrarlas
 * (`puedeGestionarBodegas`), así que los desplegables se cargan al abrirlo.
 */
export function BodegaFormModal({ open, bodega, onClose, onSaved }: {
  open: boolean;
  /** `null` = bodega nueva. */
  bodega: BodegaEditable | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { authFetch } = useAuth();
  const [users, setUsers] = useState<UserOption[]>([]);
  const [tecnicos, setTecnicos] = useState<TecnicoOption[]>([]);
  const [sedes, setSedes] = useState<SedeOption[]>([]);
  const [title, setTitle] = useState("");
  const [extra, setExtra] = useState("");
  const [managerId, setManagerId] = useState("");
  const [technicianStaffId, setTechnicianStaffId] = useState("");
  const [branchLegacy, setBranchLegacy] = useState("");
  const [isMain, setIsMain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(bodega?.title ?? ""); setExtra(bodega?.extra ?? ""); setManagerId(bodega?.managerId ?? "");
    setTechnicianStaffId(bodega?.technicianStaffId ?? "");
    setBranchLegacy(bodega?.branchLegacy != null ? String(bodega.branchLegacy) : ""); setIsMain(bodega?.isMain ?? false);
    setErr(null);
  }, [open, bodega]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [us, tec, sed] = await Promise.all([
        (await authFetch("/auth/users/options")).json().catch(() => []),
        // Los mismos técnicos que ofrece el traspaso: es a quien se le puede poner
        // una bodega personal a su nombre.
        (await authFetch("/support/technicians")).json().catch(() => []),
        (await authFetch("/inventory/branches")).json().catch(() => []),
      ]);
      setUsers(Array.isArray(us) ? us : []);
      setTecnicos(Array.isArray(tec) ? tec : []);
      setSedes(Array.isArray(sed) ? sed : []);
    })();
  }, [open, authFetch]);

  async function submit() {
    setErr(null);
    if (!title.trim()) { setErr("El nombre de la bodega es obligatorio."); return; }
    setSaving(true);
    try {
      // managerId y technicianStaffId siempre viajan (aunque sean ""): así se puede
      // quitar el encargado o dejar de ser la bodega personal de un técnico.
      const body = JSON.stringify({
        title: title.trim(), extra: extra.trim() || undefined, managerId, technicianStaffId,
        // 0 = sin sede (el backend lo guarda como null); el técnico dueño no puede
        // ser además la bodega principal de la sede.
        branchLegacy: branchLegacy ? Number(branchLegacy) : 0,
        isMain: isMain && !technicianStaffId && Boolean(branchLegacy),
      });
      const res = bodega
        ? await authFetch(`/inventory/warehouses/${bodega.id}`, { method: "PATCH", body })
        : await authFetch("/inventory/warehouses", { method: "POST", body });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || "No se pudo guardar la bodega");
      toast(bodega ? "Bodega actualizada" : "Bodega creada", "check");
      onClose();
      onSaved();
    } catch (e) { setErr(mensajeDeError(e)); } finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={bodega ? "Editar bodega" : "Nueva bodega"} maxWidth="max-w-md">
      <div className="flex flex-col gap-3">
        <Field label="Nombre" required><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bodega central" autoFocus /></Field>
        <Field label="Referencia / nota"><Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Opcional" /></Field>
        <Field
          label="Técnico dueño"
          hint="Si es la bodega personal de un técnico: de ahí gasta material en sus órdenes y ahí se le entrega. Déjalo vacío para una bodega general."
        >
          <Select
            value={technicianStaffId}
            // Con dueño no hay encargado: recibe y firma él, así que se limpia para
            // no dejar guardado a un tercero que la pantalla ya no enseña.
            onChange={(e) => { setTechnicianStaffId(e.target.value); if (e.target.value) setManagerId(""); }}
          >
            <option value="">Bodega general (sin dueño)…</option>
            {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field
          label="Encargado"
          hint={
            technicianStaffId
              ? "Es el almacén de un técnico: recibe él, no hace falta encargado."
              : "Es quien recibe y firma los traspasos que entran a esta bodega."
          }
        >
          <Select value={managerId} onChange={(e) => setManagerId(e.target.value)} disabled={Boolean(technicianStaffId)}>
            <option value="">Sin encargado…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.email ? ` · ${u.email}` : ""}</option>)}
          </Select>
        </Field>
        <Field
          label="Sede"
          hint="De qué sede es la bodega. Es lo que ata la bodega con la cajera que responde por ella."
        >
          <Select value={branchLegacy} onChange={(e) => { setBranchLegacy(e.target.value); if (!e.target.value) setIsMain(false); }}>
            <option value="">Sin sede (bodega de tránsito)…</option>
            {sedes.map((b) => <option key={b.legacyId} value={b.legacyId}>{b.name}</option>)}
          </Select>
        </Field>
        {/* La marca sólo tiene sentido en una bodega general con sede: es a donde
            el técnico devuelve lo que le sobra, y lo recibe la cajera de esa sede. */}
        {!technicianStaffId && (
          <label className={`flex items-start gap-2 text-[12px] ${branchLegacy ? "text-text-secondary" : "text-text-tertiary"}`}>
            <input
              type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={isMain} disabled={!branchLegacy}
              onChange={(e) => setIsMain(e.target.checked)}
            />
            <span>
              <strong>Bodega principal de la sede.</strong> Es a donde los técnicos devuelven el material que les sobra;
              la recibe y firma la cajera de esa sede. Sólo puede haber una por sede: marcarla desmarca la anterior.
            </span>
          </label>
        )}
        {err && <p className="text-[12px] text-error-text">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Guardando…" : bodega ? "Guardar cambios" : "Crear"}</Button>
        </div>
      </div>
    </Modal>
  );
}
