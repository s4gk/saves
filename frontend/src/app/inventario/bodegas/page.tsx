"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/ui/PageHeading";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge } from "@/components/ui/Badge";
import { PagedTable } from "@/components/ui/PagedTable";
import { ListToolbar } from "@/components/ui/ListToolbar";
import { PageSkeleton } from "@/components/skeletons/PageSkeleton";
import { toast } from "@/components/ui/Toast";
import { BodegaFormModal } from "@/components/inventory/BodegaFormModal";
import { useAuth } from "@/context/AuthProvider";
import { puedeGestionarBodegas } from "@/lib/auth";
import { esTecnico } from "@/lib/support";
import { cop } from "@/lib/subscribers";
import { mensajeDeError } from "@/lib/errores";

type Warehouse = {
  id: string; title: string; extra: string | null; technicianRef: string | null;
  technicianStaffId: string | null;
  managerId: string | null; managerName: string | null; materials: number; value: number;
  /** Sede de la bodega (`Branch.legacyId`) y si es la principal de esa sede. */
  branchLegacy: number | null; isMain: boolean;
};

type SedeOption = { legacyId: number; name: string };

export default function BodegasPage() {
  const { loading: authLoading, authFetch, user } = useAuth();
  // Al técnico el backend le devuelve UNA bodega, la suya, y de solo lectura: aquí
  // se le quitan los botones que igual le rechazaría `InventoryService`.
  const soloLoSuyo = esTecnico(user);
  // Crear/editar/eliminar bodegas es nominal (2026-09-29): el resto sólo consulta.
  const gestiona = !soloLoSuyo && puedeGestionarBodegas(user);
  const [rows, setRows] = useState<Warehouse[] | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [sedes, setSedes] = useState<SedeOption[]>([]);
  const [delRow, setDelRow] = useState<Warehouse | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setRows(await (await authFetch("/inventory/warehouses")).json());
  }, [authFetch]);

  useEffect(() => { if (!authLoading) void load(); }, [authLoading, load]);
  useEffect(() => {
    if (authLoading || soloLoSuyo) return;
    void (async () => {
      const sed = await (await authFetch("/inventory/branches")).json().catch(() => []);
      setSedes(Array.isArray(sed) ? sed : []);
    })();
  }, [authLoading, authFetch, soloLoSuyo]);

  function openNew() { setEditing(null); setOpen(true); }
  function openEdit(w: Warehouse) { setEditing(w); setOpen(true); }

  async function remove() {
    if (!delRow) return;
    setDeleting(true);
    try {
      const res = await authFetch(`/inventory/warehouses/${delRow.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => null);
      // El backend rechaza el borrado si la bodega aún tiene material.
      if (!res.ok) throw new Error(d?.message || "No se pudo eliminar la bodega");
      toast("Bodega eliminada", "check");
      setDelRow(null);
      void load();
    } catch (e) {
      toast(mensajeDeError(e), "alert-triangle");
    } finally { setDeleting(false); }
  }

  // Filtro en cliente por nombre/referencia sobre lo ya cargado.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !rows) return rows ?? [];
    return rows.filter((w) => [w.title, w.extra, w.technicianRef].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [rows, search]);

  if (authLoading || !rows) return <PageSkeleton />;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeading
          icon="warehouse"
          title={soloLoSuyo ? "Mi bodega de material" : "Bodegas de material"}
          subtitle={soloLoSuyo ? "El material que tienes a tu cargo" : "Almacenes de inventario"}
        />
        {!soloLoSuyo && (
          <div className="flex items-center gap-2">
            <Link href="/inventario" className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3 py-2 text-[12px] font-semibold text-text-secondary transition-colors hover:bg-surface-2">
              <Icon name="package" size={14} /> Material
            </Link>
            {gestiona && <Button size="sm" onClick={openNew}><Icon name="plus" size={14} /> Nueva bodega</Button>}
          </div>
        )}
      </div>

      {gestiona && <BodegaFormModal open={open} bodega={editing} onClose={() => setOpen(false)} onSaved={() => void load()} />}

      <ConfirmDialog
        open={Boolean(delRow)}
        title="Eliminar bodega"
        message={<>¿Seguro que quieres eliminar la bodega <strong>{delRow?.title}</strong>? Solo es posible si no tiene material asociado.</>}
        confirmLabel="Eliminar"
        busy={deleting}
        onConfirm={remove}
        onClose={() => setDelRow(null)}
      />

      {!soloLoSuyo && <ListToolbar search={search} onSearch={setSearch} searchPlaceholder="Buscar bodega…" />}

      <PagedTable
        rows={shown}
        empty={
          soloLoSuyo
            ? "No tienes una bodega de material a tu nombre. Pídele a administración que te asigne una."
            : search ? "Ninguna bodega coincide con la búsqueda." : "No hay bodegas registradas."
        }
        rowHref={(r: Warehouse) => `/inventario/bodegas/${r.id}`}
        columns={[
          { key: "title", header: "Bodega", render: (r: Warehouse) => <span className="font-medium text-text-primary">{r.title}</span> },
          { key: "extra", header: "Referencia", render: (r: Warehouse) => <span className="text-text-tertiary">{r.extra || "—"}</span> },
          // La lista de sedes sólo se carga para quien administra: al técnico, que ve
          // una sola bodega (la suya), la columna le saldría siempre vacía.
          ...(soloLoSuyo ? [] : [{
            key: "sede", header: "Sede" as const,
            render: (r: Warehouse) => {
              const sede = sedes.find((b) => b.legacyId === r.branchLegacy);
              if (!sede) return <span className="text-text-tertiary">—</span>;
              return (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-text-secondary">{sede.name}</span>
                  {r.isMain && <Badge label="Principal" tone="info" />}
                </span>
              );
            },
          }]),
          {
            key: "manager", header: "Encargado",
            // En la bodega de un técnico recibe él; ahí el encargado no aplica.
            render: (r: Warehouse) => r.technicianRef
              ? <span className="inline-flex items-center gap-1 text-text-tertiary"><Icon name="user" size={12} /> Técnico</span>
              : r.managerName
                ? <span className="text-text-secondary">{r.managerName}</span>
                : <span className="text-warning-text">Sin asignar</span>,
          },
          { key: "materials", header: "Materiales", align: "right", render: (r: Warehouse) => <Badge label={String(r.materials)} tone={r.materials > 0 ? "info" : "default"} /> },
          { key: "value", header: "Valor", align: "right", render: (r: Warehouse) => <span className="font-semibold text-text-primary">{cop(r.value ?? 0)}</span> },
          ...(!gestiona ? [] : [{
            key: "acciones", header: "" as const, align: "right" as const,
            // stopPropagation: la fila navega al detalle con onRowClick.
            render: (r: Warehouse) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => openEdit(r)} className="tap rounded-md p-1.5 text-text-tertiary hover:bg-surface-2 hover:text-text-primary" title="Editar">
                  <Icon name="pencil" size={15} />
                </button>
                <button type="button" onClick={() => setDelRow(r)} className="tap rounded-md p-1.5 text-text-tertiary hover:bg-error-soft hover:text-error-text" title="Eliminar">
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ),
          }]),
        ]}
      />
    </>
  );
}
