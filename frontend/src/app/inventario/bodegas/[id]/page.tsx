"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { DetailHeader } from "@/components/ui/DetailHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { PageSkeleton } from "@/components/skeletons/PageSkeleton";
import { LoadError } from "@/components/ui/LoadError";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/components/ui/Toast";
import { BodegaFormModal, type BodegaEditable } from "@/components/inventory/BodegaFormModal";
import { MaterialFormModal } from "@/components/inventory/MaterialFormModal";
import { useAuth } from "@/context/AuthProvider";
import { puedeGestionarBodegas } from "@/lib/auth";
import { mensajeDeError } from "@/lib/errores";
import { esTecnico } from "@/lib/support";
import { cop } from "@/lib/subscribers";
import { StatCard } from "@/components/ui/StatCard";
import { useRequest } from "@/lib/useRequest";
import { useOrden } from "@/lib/useOrden";

type Warehouse = BodegaEditable & { technicianRef: string | null; materials: number; value: number };

const COLUMNS = [
  { key: "name", header: "Nombre", sortable: true, render: (r: any) => <span className="font-medium text-text-primary">{r.name}</span> },
  { key: "code", header: "Código", sortable: true, render: (r: any) => <span className="text-text-secondary">{r.code || "—"}</span> },
  { key: "category", header: "Categoría", sortable: true, render: (r: any) => <span className="text-text-secondary">{r.category || "—"}</span> },
  { key: "price", header: "Precio", sortable: true, align: "right" as const, render: (r: any) => <span>{cop(r.price ?? 0)}</span> },
  { key: "qty", header: "Stock", sortable: true, align: "right" as const, render: (r: any) => r.low ? <Badge label={`${r.qty ?? 0} · Bajo`} tone="error" /> : <span>{r.qty ?? 0}</span> },
  { key: "value", header: "Valor", align: "right" as const, render: (r: any) => <span className="font-semibold">{cop(r.value ?? 0)}</span> },
];

export default function BodegaMaterialesPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { loading: authLoading, authFetch, user } = useAuth();
  const soloLoSuyo = esTecnico(user);
  // Editar/eliminar la bodega y administrar su material es nominal (2026-09-29):
  // Luis Fernando Hurtado y Santiago García. Los demás la consultan.
  const gestiona = !soloLoSuyo && puedeGestionarBodegas(user);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Material: `matOpen` con `matId` null = material nuevo en esta bodega.
  const [matOpen, setMatOpen] = useState(false);
  const [matId, setMatId] = useState<string | null>(null);
  const [delMat, setDelMat] = useState<any>(null);
  const [deletingMat, setDeletingMat] = useState(false);

  const [wh, setWh] = useState<Warehouse | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Cabecera: resumen de la bodega (nombre, total y valor).
  const loadWh = useCallback(async () => {
    try {
      const list: Warehouse[] = await (await authFetch("/inventory/warehouses")).json();
      setWh(list.find((w) => w.id === id) ?? null);
    } catch { /* la tabla igual puede cargar */ }
  }, [authFetch, id]);

  // Carga con cancelación. El estado de error lo aporta el propio hook, así que
  // desaparece el `err` local: antes había que acordarse de resetearlo a mano.
  // Pagina en el servidor: el orden viaja en la query.
  const orden = useOrden();

  const { data, cargando: loading, error: err, refrescar: load } = useRequest<any>(
    () => {
      const params = new URLSearchParams({ warehouseId: String(id), page: String(page), pageSize: "25", ...orden.params });
      if (search.trim()) params.set("search", search.trim());
      return `/inventory/materials?${params.toString()}`;
    },
    [id, page, search],
    { debounceMs: search ? 300 : 0, saltar: authLoading },
  );

  useEffect(() => { if (!authLoading) void loadWh(); }, [authLoading, loadWh]);

  async function remove() {
    setDeleting(true);
    try {
      const res = await authFetch(`/inventory/warehouses/${id}`, { method: "DELETE" });
      const d = await res.json().catch(() => null);
      // El backend rechaza el borrado si la bodega aún tiene material.
      if (!res.ok) throw new Error(d?.message || "No se pudo eliminar la bodega");
      toast("Bodega eliminada", "check");
      router.push("/inventario/bodegas");
    } catch (e) {
      toast(mensajeDeError(e), "alert-triangle");
      setDelOpen(false);
    } finally { setDeleting(false); }
  }

  async function removeMaterial() {
    if (!delMat) return;
    setDeletingMat(true);
    try {
      const res = await authFetch(`/inventory/materials/${delMat.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.message || "No se pudo eliminar");
      toast("Material eliminado", "check");
      setDelMat(null);
      load(); void loadWh();
    } catch (e) {
      toast(mensajeDeError(e, "No se pudo eliminar"), "alert-triangle");
    } finally { setDeletingMat(false); }
  }

  // Editar/eliminar cada material, sólo para quien administra bodegas.
  const columns = gestiona ? [...COLUMNS, {
    key: "acciones", header: "", align: "right" as const,
    render: (r: any) => (
      <div className="flex justify-end gap-1">
        <button type="button" onClick={() => { setMatId(r.id); setMatOpen(true); }} className="tap rounded-md p-1.5 text-text-tertiary hover:bg-surface-2 hover:text-text-primary" title="Editar">
          <Icon name="pencil" size={15} />
        </button>
        <button type="button" onClick={() => setDelMat(r)} className="tap rounded-md p-1.5 text-text-tertiary hover:bg-error-soft hover:text-error-text" title="Eliminar">
          <Icon name="trash" size={15} />
        </button>
      </div>
    ),
  }] : COLUMNS;

  if (authLoading) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      {/* El encabezado se anunciaba con el título literal "Volver" (y el nombre
          real de la bodega colgaba aparte en un `<h1>` suelto). */}
      <DetailHeader
        backHref="/inventario/bodegas"
        backLabel="Bodegas"
        icon="warehouse"
        title={wh ? wh.title : "Bodega"}
        subtitle={wh?.extra || (soloLoSuyo ? "El material que tienes a tu cargo" : "Inventario de esta bodega")}
        actions={
          gestiona ? (
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Button size="sm" className="flex-1 sm:flex-none" onClick={() => { setMatId(null); setMatOpen(true); }}>
                <Icon name="plus" size={14} /> Nuevo material
              </Button>
              <Button variant="secondary" size="sm" className="flex-1 sm:flex-none" onClick={() => setEditOpen(true)} disabled={!wh}>
                <Icon name="pencil" size={14} /> Editar
              </Button>
              <Button variant="danger" size="sm" className="flex-1 sm:flex-none" onClick={() => setDelOpen(true)} disabled={!wh}>
                <Icon name="trash" size={14} /> Eliminar
              </Button>
            </div>
          ) : undefined
        }
      />

      {gestiona && (
        <>
          <BodegaFormModal open={editOpen} bodega={wh} onClose={() => setEditOpen(false)} onSaved={() => void loadWh()} />
          <MaterialFormModal
            open={matOpen}
            materialId={matId}
            defaultWarehouseId={String(id)}
            onClose={() => setMatOpen(false)}
            onSaved={() => { load(); void loadWh(); }}
          />
          <ConfirmDialog
            open={Boolean(delMat)}
            title="Eliminar material"
            message={<>¿Seguro que quieres eliminar <strong>{delMat?.name}</strong> de esta bodega? Esta acción no se puede deshacer.</>}
            confirmLabel="Eliminar"
            busy={deletingMat}
            onConfirm={removeMaterial}
            onClose={() => setDelMat(null)}
          />
          <ConfirmDialog
            open={delOpen}
            title="Eliminar bodega"
            message={
              (wh?.materials ?? 0) > 0
                ? <>La bodega <strong>{wh?.title}</strong> tiene {wh?.materials} material(es). Para eliminarla primero hay que trasladarlos o borrarlos.</>
                : <>¿Seguro que quieres eliminar la bodega <strong>{wh?.title}</strong>? Esta acción no se puede deshacer.</>
            }
            confirmLabel="Eliminar"
            busy={deleting}
            onConfirm={remove}
            onClose={() => setDelOpen(false)}
          />
        </>
      )}

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <StatCard label="Total de materiales" value={(wh?.materials ?? data?.total ?? 0).toLocaleString("es-CO")} icon="package" />
        <StatCard label="Valor del inventario" value={cop(wh?.value ?? 0)} icon="dollar-sign" />
      </div>

      <div className="relative max-w-md">
        <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <Input
          className="pl-9"
          placeholder="Buscar material por nombre o código…"
          value={search}
          onChange={(e) => { setPage(1); setSearch(e.target.value); }}
        />
      </div>

      {err && !data ? (
        <LoadError message="No se pudieron cargar los materiales." onRetry={load} />
      ) : loading && !data ? (
        <PageSkeleton />
      ) : (
        <>
          <DataTable rows={data?.items ?? []} empty={search ? "Ningún material coincide con la búsqueda." : "Esta bodega no tiene materiales."} columns={columns} sort={orden.sort} onSort={orden.onSort} />
          {data && data.pages > 1 && (
            <Pagination meta={{ page: data.page, pageSize: data.pageSize, total: data.total, pageCount: data.pages }} onPage={setPage} />
          )}
        </>
      )}
    </div>
  );
}
