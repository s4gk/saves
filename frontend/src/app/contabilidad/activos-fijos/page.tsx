"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { StatCard } from "@/components/ui/StatCard";
import { ListToolbar } from "@/components/ui/ListToolbar";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { toast } from "@/components/ui/Toast";
import { useAuth } from "@/context/AuthProvider";
import { cop } from "@/lib/format";
import { activosApi, ESTADO_ACTIVO, type ActivoFila, type ListaActivos, type MetaActivos } from "@/lib/activos-fijos";
import { MiniaturaActivo } from "@/components/activos-fijos/FotoActivo";
import { FormActivo } from "@/components/activos-fijos/FormActivo";
import { CargueExcel, CorridaDepreciacion } from "@/components/activos-fijos/CargueYDepreciacion";

/**
 * Activos fijos: lo que la empresa tiene —las OLT y Mikrotik de los nodos, los
 * computadores, los vehículos—, con foto, serial, sede y valor en libros.
 *
 * Gerencia sólo mira; cargar, editar y correr la depreciación es de contabilidad y
 * administración (igual que la API).
 */
export default function ActivosFijosPage() {
  const router = useRouter();
  const { authFetch, can } = useAuth();
  const api = useMemo(() => activosApi(authFetch), [authFetch]);
  const puedeEditar = can(["area.contabilidad", "area.administracion"]);

  const [meta, setMeta] = useState<MetaActivos | null>(null);
  const [data, setData] = useState<ListaActivos | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [buscar, setBuscar] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [modal, setModal] = useState<"nuevo" | "excel" | "depreciacion" | null>(null);

  // El buscador espera a que se deje de teclear.
  useEffect(() => {
    const t = setTimeout(() => { setBuscar(search.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    api.meta().then(setMeta).catch((e: Error) => toast(e.message, "alert-triangle"));
  }, [api]);

  const filtros = { search: buscar, categoryId, branchId, status };

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.list({ search: buscar, categoryId, branchId, status, page, pageSize }));
    } catch (e) {
      toast((e as Error).message, "alert-triangle");
    } finally {
      setLoading(false);
    }
  }, [api, buscar, categoryId, branchId, status, page, pageSize]);

  useEffect(() => { void cargar(); }, [cargar]);

  const columnas: Column<ActivoFila>[] = [
    {
      key: "name",
      header: "Activo",
      sortable: false,
      render: (a) => (
        <div className="flex items-center gap-3">
          <MiniaturaActivo path={a.coverPhoto ? api.photoPath(a.id, a.coverPhoto.id) : null} mimeType={a.coverPhoto?.mimeType} />
          <div className="min-w-0">
            <div className="font-semibold text-text-primary">{a.name}</div>
            <div className="text-[11.5px] text-text-tertiary">
              <span className="font-mono">{a.code}</span>
              {(a.brand || a.model) && <> · {[a.brand, a.model].filter(Boolean).join(" ")}</>}
              {a.latitude != null && <Icon name="map-pin" size={11} className="ml-1 inline text-brand" aria-label="Con ubicación GPS" />}
            </div>
          </div>
        </div>
      ),
    },
    { key: "serialNumber", header: "Serial", sortable: false, render: (a) => <span className="font-mono text-[12px]">{a.serialNumber ?? "—"}</span> },
    { key: "category", header: "Categoría", sortable: false, render: (a) => a.category.name },
    {
      key: "branch", header: "Sede / ubicación", sortable: false,
      render: (a) => (
        <div>
          <div>{a.branch?.name ?? "—"}</div>
          {a.location && <div className="text-[11.5px] text-text-tertiary">{a.location}</div>}
        </div>
      ),
    },
    { key: "acquisitionCost", header: "Costo", align: "right", sortable: false, render: (a) => <span className="tabular-nums">{cop(a.acquisitionCost)}</span> },
    { key: "bookValue", header: "Valor en libros", align: "right", sortable: false, render: (a) => <span className="font-semibold tabular-nums">{cop(a.bookValue)}</span> },
    {
      key: "status", header: "Estado", sortable: false,
      render: (a) => (
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${ESTADO_ACTIVO[a.status].clase}`}>
          {ESTADO_ACTIVO[a.status].label}
        </span>
      ),
    },
  ];

  const s = data?.summary;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading
          icon="boxes"
          title="Activos fijos"
          subtitle="Equipos de red, cómputo, muebles y vehículos de la empresa, con fotos, serial, sede y valor en libros."
        />
        {puedeEditar && (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
            <Button className="col-span-2 sm:col-span-1" onClick={() => setModal("nuevo")}>
              <Icon name="plus" size={14} /> Nuevo activo
            </Button>
            <Button variant="secondary" onClick={() => setModal("excel")}>
              <Icon name="file-spreadsheet" size={14} /> Cargar Excel
            </Button>
            <Button variant="secondary" onClick={() => setModal("depreciacion")}>
              <Icon name="calculator" size={14} /> Depreciación
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="boxes" label="Activos en uso" value={s ? s.count : "—"} />
        <StatCard icon="banknote" label="Costo" value={s ? cop(s.cost) : "—"} />
        <StatCard icon="trending-down" label="Depreciación a hoy" value={s ? cop(s.depreciation) : "—"} />
        <StatCard icon="wallet" label="Valor en libros" value={s ? cop(s.bookValue) : "—"} tone="text-brand" />
      </div>

      <div>
        <ListToolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Buscar por nombre, código, serial, marca, ubicación…"
          actions={
            <Button variant="secondary" onClick={() => api.exportExcel(filtros).catch((e: Error) => toast(e.message, "alert-triangle"))}>
              <Icon name="download" size={14} /> Exportar
            </Button>
          }
        >
          <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} className="w-full sm:w-auto">
            <option value="">Todas las categorías</option>
            {meta?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }} className="w-full sm:w-auto">
            <option value="">Todas las sedes</option>
            {meta?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="none">Sin sede</option>
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-full sm:w-auto">
            <option value="">Todos los estados</option>
            {Object.entries(ESTADO_ACTIVO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </ListToolbar>

        <DataTable
          columns={columnas}
          rows={data?.rows ?? []}
          loading={loading && !data}
          empty={buscar || categoryId || branchId || status ? "Ningún activo coincide con el filtro." : "Aún no hay activos. Crea el primero o cárgalos desde Excel."}
          rowHref={(a) => `/contabilidad/activos-fijos/${a.id}`}
          cardRender={(a) => (
            <div className="flex items-center gap-3">
              <MiniaturaActivo path={a.coverPhoto ? api.photoPath(a.id, a.coverPhoto.id) : null} mimeType={a.coverPhoto?.mimeType} size={56} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-text-primary">{a.name}</div>
                <div className="truncate text-[11.5px] text-text-tertiary">
                  <span className="font-mono">{a.code}</span> · {a.category.name}{a.branch ? ` · ${a.branch.name}` : ""}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-[12px]">
                  <span className="font-semibold tabular-nums text-text-primary">{cop(a.bookValue)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${ESTADO_ACTIVO[a.status].clase}`}>{ESTADO_ACTIVO[a.status].label}</span>
                </div>
              </div>
            </div>
          )}
        />
        {data && data.total > 0 && (
          <div className="mt-3">
            <Pagination
              meta={{ page: data.page, pageSize: data.pageSize, total: data.total, pageCount: Math.max(1, Math.ceil(data.total / data.pageSize)) }}
              onPage={setPage}
              onPageSize={(n) => { setPageSize(n); setPage(1); }}
            />
          </div>
        )}
      </div>

      <Modal open={modal === "nuevo"} onClose={() => setModal(null)} title="Nuevo activo fijo" maxWidth="max-w-2xl">
        {meta && modal === "nuevo" && (
          <FormActivo
            api={api}
            meta={meta}
            onCancelar={() => setModal(null)}
            onGuardado={(a) => { setModal(null); router.push(`/contabilidad/activos-fijos/${a.id}`); }}
          />
        )}
      </Modal>
      <Modal open={modal === "excel"} onClose={() => setModal(null)} title="Cargar activos desde Excel">
        <CargueExcel api={api} onHecho={() => void cargar()} />
      </Modal>
      <Modal open={modal === "depreciacion"} onClose={() => setModal(null)} title="Depreciación del mes" maxWidth="max-w-2xl">
        <CorridaDepreciacion api={api} onHecho={() => void cargar()} />
      </Modal>
    </div>
  );
}
