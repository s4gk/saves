"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/Modal";
import { Input, Select, Textarea, Field } from "@/components/ui/Field";
import { toast } from "@/components/ui/Toast";
import { useAuth } from "@/context/AuthProvider";
import { mensajeDeError } from "@/lib/errores";

const emptyForm = { name: "", code: "", categoryId: "", warehouseId: "", price: "", cost: "", taxRate: "", qty: "", alert: "", description: "" };

/**
 * Crear o editar un material. Lo comparten /inventario y el detalle de una bodega;
 * sólo se monta para quien administra bodegas (`puedeGestionarBodegas`).
 * Categorías, bodegas y —al editar— el detalle del material se piden al abrirlo:
 * el listado no trae categoryId ni descripción.
 */
export function MaterialFormModal({ open, materialId, defaultWarehouseId = "", onClose, onSaved }: {
  open: boolean;
  /** `null` = material nuevo. */
  materialId: string | null;
  /** Bodega en la que nace un material nuevo (la que se está mirando). */
  defaultWarehouseId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { authFetch } = useAuth();
  const [categories, setCategories] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [cats, whs] = await Promise.all([
        (await authFetch("/inventory/categories")).json().catch(() => []),
        (await authFetch("/inventory/warehouses")).json().catch(() => []),
      ]);
      setCategories(Array.isArray(cats) ? cats : []);
      setWarehouses(Array.isArray(whs) ? whs : []);
    })();
  }, [open, authFetch]);

  useEffect(() => {
    if (!open) return;
    if (!materialId) {
      setEditing(null);
      setForm({ ...emptyForm, warehouseId: defaultWarehouseId });
      return;
    }
    void (async () => {
      try {
        const res = await authFetch(`/inventory/materials/${materialId}`);
        const m = await res.json();
        if (!res.ok) throw new Error(m?.message || "No se pudo cargar el material");
        setEditing(m);
        setForm({
          name: m.name ?? "", code: m.code ?? "", categoryId: m.category?.id ?? "", warehouseId: m.warehouse?.id ?? "",
          price: m.price ?? "", cost: m.cost ?? "", taxRate: m.taxRate ?? "",
          qty: m.qty ?? "", alert: m.alert ?? "", description: m.description ?? "",
        });
      } catch (e) {
        toast(mensajeDeError(e, "No se pudo cargar el material"), "alert-triangle");
        onClose();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, materialId, defaultWarehouseId, authFetch]);

  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const cargando = Boolean(materialId) && !editing;

  const submit = async () => {
    if (!form.name.trim()) { toast("El nombre es obligatorio"); return; }
    setSaving(true);
    try {
      const body: any = {
        name: form.name,
        code: form.code || undefined,
        categoryId: form.categoryId || undefined,
        price: form.price !== "" ? Number(form.price) : undefined,
        cost: form.cost !== "" ? Number(form.cost) : undefined,
        taxRate: form.taxRate !== "" ? Number(form.taxRate) : undefined,
        qty: form.qty !== "" ? Number(form.qty) : undefined,
        alert: form.alert !== "" ? Number(form.alert) : undefined,
        description: form.description || undefined,
      };
      // La bodega solo se fija al crear: moverla después exige un traspaso con acta.
      if (!editing) body.warehouseId = form.warehouseId || undefined;
      const res = await authFetch(
        editing ? `/inventory/materials/${editing.id}` : "/inventory/materials",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message || "Error");
      toast(editing ? "Material actualizado" : "Material creado", "check");
      onClose();
      onSaved();
    } catch (e) {
      toast(mensajeDeError(e, "No se pudo guardar"), "alert-triangle");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={materialId ? "Editar material" : "Nuevo material"} maxWidth="max-w-lg">
      <div className="flex flex-col gap-3">
        <Field label="Nombre" required>
          <Input value={form.name} onChange={set("name")} placeholder="Nombre del material" disabled={cargando} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Código"><Input value={form.code} onChange={set("code")} disabled={cargando} /></Field>
          <Field label="Categoría">
            <Select value={form.categoryId} onChange={set("categoryId")} disabled={cargando}>
              <option value="">Sin categoría</option>
              {categories.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Select>
          </Field>
        </div>
        {materialId ? (
          <Field label="Bodega" hint="Para mover el material a otra bodega usa un traspaso, que deja acta del movimiento.">
            <Input value={editing?.warehouse?.title ?? (cargando ? "…" : "Sin bodega")} disabled />
          </Field>
        ) : (
          <Field label="Bodega">
            <Select value={form.warehouseId} onChange={set("warehouseId")}>
              <option value="">Sin bodega</option>
              {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.title}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="Precio"><Input type="number" value={form.price} onChange={set("price")} disabled={cargando} /></Field>
          <Field label="Costo"><Input type="number" value={form.cost} onChange={set("cost")} disabled={cargando} /></Field>
          <Field label="IVA %"><Input type="number" value={form.taxRate} onChange={set("taxRate")} disabled={cargando} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stock"><Input type="number" value={form.qty} onChange={set("qty")} disabled={cargando} /></Field>
          <Field label="Alerta stock"><Input type="number" value={form.alert} onChange={set("alert")} disabled={cargando} /></Field>
        </div>
        <Field label="Descripción">
          <Textarea rows={3} value={form.description} onChange={set("description")} disabled={cargando} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}><Icon name="x" size={14} />Cancelar</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={saving || cargando}><Icon name="check" size={14} />{saving ? "Guardando…" : materialId ? "Guardar cambios" : "Crear"}</Button>
        </div>
      </div>
    </Modal>
  );
}
