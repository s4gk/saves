"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/ui/PageHeading";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { ListToolbar } from "@/components/ui/ListToolbar";
import { Pagination } from "@/components/ui/Pagination";
import { PageSkeleton } from "@/components/skeletons/PageSkeleton";
import { MaterialFormModal } from "@/components/inventory/MaterialFormModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/components/ui/Toast";
import { useAuth } from "@/context/AuthProvider";
import { puedeGestionarBodegas } from "@/lib/auth";
import { useOrden } from "@/lib/useOrden";
import { cop } from "@/lib/subscribers";
import { StatCard } from "@/components/ui/StatCard";
import { mensajeDeError } from "@/lib/errores";

export default function MaterialPage() {
  const { loading: authLoading, authFetch, user } = useAuth();
  // Crear, editar, borrar e importar material es nominal (2026-09-29): Luis Fernando
  // Hurtado y Santiago García. El resto consulta la lista y las existencias.
  const gestiona = puedeGestionarBodegas(user);

  const [stats, setStats] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  // Toma la categoría inicial de la URL (?categoryId=…) al entrar desde la
  // pantalla de Categorías. Client component → se lee del window sin Suspense.
  const [categoryId, setCategoryId] = useState<string>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("categoryId") || "" : "",
  );
  // ?warehouseId=… al entrar desde el detalle de una bodega ("Administrar material").
  const [warehouseId, setWarehouseId] = useState<string>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("warehouseId") || "" : "",
  );
  // ?lowStock=1 al entrar desde la campana de alertas de stock.
  const [lowStock, setLowStock] = useState<boolean>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("lowStock") === "1" : false,
  );
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  // id del material que se edita; `null` con el modal abierto = material nuevo.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [delRow, setDelRow] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [importing, setImporting] = useState(false);

  async function importExcel(file: File) {
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await authFetch(`/inventory/materials/import`, { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message || "No se pudo importar");
      toast(`Importados ${d.created} material(es)${d.skipped ? ` · ${d.skipped} omitidos` : ""}`, "check");
      await load();
    } catch (e) { toast(mensajeDeError(e), "alert-triangle"); } finally { setImporting(false); }
  }

  const loadRefs = useCallback(async () => {
    const [cats, whs] = await Promise.all([
      (await authFetch("/inventory/categories")).json(),
      (await authFetch("/inventory/warehouses")).json(),
    ]);
    setCategories(Array.isArray(cats) ? cats : []);
    setWarehouses(Array.isArray(whs) ? whs : []);
  }, [authFetch]);

  const orden = useOrden();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (categoryId) params.set("categoryId", categoryId);
      if (warehouseId) params.set("warehouseId", warehouseId);
      if (lowStock) params.set("lowStock", "1");
      params.set("page", String(page));
      params.set("pageSize", "25");
      // El listado pagina en el servidor: el orden va con la consulta.
      for (const [k, v] of Object.entries(orden.params)) params.set(k, v);
      const [s, d] = await Promise.all([
        (await authFetch("/inventory/stats")).json(),
        (await authFetch(`/inventory/materials?${params.toString()}`)).json(),
      ]);
      setStats(s);
      setData(d);
    } finally {
      setLoading(false);
    }
  }, [authFetch, search, categoryId, warehouseId, lowStock, page, orden.clave]);

  useEffect(() => { if (!authLoading) void loadRefs(); }, [authLoading, loadRefs]);
  useEffect(() => { if (!authLoading) void load(); }, [authLoading, load]);

  function openNew() { setEditingId(null); setModalOpen(true); }
  function openEdit(row: any) { setEditingId(row.id); setModalOpen(true); }

  async function removeMaterial() {
    if (!delRow) return;
    setDeleting(true);
    try {
      const res = await authFetch(`/inventory/materials/${delRow.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.message || "No se pudo eliminar");
      toast("Material eliminado", "check");
      setDelRow(null);
      await load();
    } catch (e) {
      toast(mensajeDeError(e, "No se pudo eliminar"), "alert-triangle");
    } finally {
      setDeleting(false);
    }
  }

  const columns = useMemo(() => [
    { key: "name", header: "Nombre", sortable: true, render: (r: any) => <span className="font-medium text-text-primary">{r.name}</span> },
    { key: "code", header: "Código", sortable: true, render: (r: any) => <span className="text-text-secondary">{r.code || "—"}</span> },
    { key: "category", header: "Categoría", sortable: true, render: (r: any) => <span className="text-text-secondary">{r.category || "—"}</span> },
    { key: "warehouse", header: "Bodega", sortable: true, render: (r: any) => <span className="text-text-secondary">{r.warehouse || "—"}</span> },
    { key: "price", header: "Precio", sortable: true, align: "right" as const, render: (r: any) => <span>{cop(r.price ?? 0)}</span> },
    { key: "qty", header: "Stock", sortable: true, align: "right" as const, render: (r: any) => r.low ? <Badge label={`${r.qty ?? 0} · Bajo`} tone="error" /> : <span>{r.qty ?? 0}</span> },
    { key: "value", header: "Valor", align: "right" as const, render: (r: any) => <span className="font-semibold">{cop(r.value ?? 0)}</span> },
    ...(!gestiona ? [] : [{
      key: "acciones", header: "", align: "right" as const,
      render: (r: any) => (
        <div className="flex justify-end gap-1">
          <button type="button" onClick={() => openEdit(r)} className="tap rounded-md p-1.5 text-text-tertiary hover:bg-surface-2 hover:text-text-primary" title="Editar">
            <Icon name="pencil" size={15} />
          </button>
          <button type="button" onClick={() => setDelRow(r)} className="tap rounded-md p-1.5 text-text-tertiary hover:bg-error-soft hover:text-error-text" title="Eliminar">
            <Icon name="trash" size={15} />
          </button>
        </div>
      ),
    }]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [gestiona]);

  if (authLoading || (loading && !data)) return <PageSkeleton />;

  const rows = data?.items ?? [];

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeading icon="boxes" title="Material" subtitle="Inventario de materiales y existencias" />
        <div className="flex items-center gap-2">
          <Link href="/inventario/traspasos"><Button variant="secondary" size="sm"><Icon name="arrow-left" size={14} />Traspasos</Button></Link>
          {gestiona && (<>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border-default bg-surface px-3 py-1.5 text-[12px] font-semibold text-text-secondary transition-colors hover:bg-surface-2">
            <Icon name={importing ? "loader" : "upload"} size={14} className={importing ? "animate-spin" : ""} /> {importing ? "Importando…" : "Importar Excel"}
            <input type="file" accept=".xlsx" className="hidden" disabled={importing} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importExcel(f); e.target.value = ""; }} />
          </label>
          <Button variant="primary" size="sm" onClick={openNew}><Icon name="plus" size={14} />Nuevo material</Button>
          </>)}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Materiales" value={String(stats.materiales ?? 0)} icon="package" />
          <StatCard label="Categorías" value={String(stats.categorias ?? 0)} icon="layers" />
          <StatCard label="Bodegas" value={String(stats.bodegas ?? 0)} icon="boxes" />
          <StatCard label="Stock bajo" value={String(stats.stockBajo ?? 0)} icon="alert-triangle" tone="text-error-text" />
          <StatCard label="Valor inventario" value={cop(stats.valorInventario ?? 0)} icon="dollar-sign" />
        </div>
      )}

      <ListToolbar
        search={search}
        onSearch={(v) => { setPage(1); setSearch(v); }}
        searchPlaceholder="Buscar material por nombre o código…"
      >
        <Select value={categoryId} onChange={(e) => { setPage(1); setCategoryId(e.target.value); }} className="w-auto">
          <option value="">Todas las categorías</option>
          {categories.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </Select>
        <Select value={warehouseId} onChange={(e) => { setPage(1); setWarehouseId(e.target.value); }} className="w-auto">
          <option value="">Todas las bodegas</option>
          {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.title}</option>)}
        </Select>
        <Button variant={lowStock ? "primary" : "secondary"} size="md" onClick={() => { setPage(1); setLowStock((v) => !v); }}>
          <Icon name="alert-triangle" size={14} />Solo stock bajo
        </Button>
      </ListToolbar>

      <DataTable rows={rows} empty="No hay materiales." columns={columns} sort={orden.sort} onSort={orden.onSort} />

      {data && (
        <Pagination
          meta={{ page: data.page, pageSize: data.pageSize, total: data.total, pageCount: data.pages }}
          onPage={setPage}
        />
      )}

      {gestiona && (
        <MaterialFormModal
          open={modalOpen}
          materialId={editingId}
          defaultWarehouseId={warehouseId}
          onClose={() => setModalOpen(false)}
          onSaved={() => void load()}
        />
      )}

      <ConfirmDialog
        open={Boolean(delRow)}
        title="Eliminar material"
        message={<>¿Seguro que quieres eliminar <strong>{delRow?.name}</strong> del inventario? Esta acción no se puede deshacer.</>}
        confirmLabel="Eliminar"
        busy={deleting}
        onConfirm={removeMaterial}
        onClose={() => setDelRow(null)}
      />
    </>
  );
}
