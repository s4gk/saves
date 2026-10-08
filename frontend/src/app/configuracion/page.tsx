"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { PageSkeleton } from "@/components/skeletons/PageSkeleton";
import { Modal } from "@/components/Modal";
import { toast } from "@/components/ui/Toast";
import { useAuth } from "@/context/AuthProvider";
import { cop } from "@/lib/subscribers";
import { mensajeDeError } from "@/lib/errores";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DireccionesTab } from "@/components/configuracion/DireccionesTab";

type Tab = "Empresa" | "Sedes" | "Direcciones" | "Cajas";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "Empresa", label: "Empresa", icon: "settings" },
  { key: "Sedes", label: "Sedes", icon: "map-pin" },
  { key: "Direcciones", label: "Direcciones y barrios", icon: "signpost" },
  { key: "Cajas", label: "Cajas", icon: "banknote" },
];

/* -------------------------------------------------------------------------- */
/* Empresa                                                                    */
/* -------------------------------------------------------------------------- */

function EmpresaTab() {
  const { authFetch } = useAuth();
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<any>(null);
  const [form, setForm] = useState<any>({
    name: "",
    taxId: "",
    address: "",
    city: "",
    region: "",
    phone: "",
    email: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data: any = await (await authFetch("/config/company")).json();
      setCompany(data);
      setForm({
        name: data?.name ?? "",
        taxId: data?.taxId ?? "",
        address: data?.address ?? "",
        city: data?.city ?? "",
        region: data?.region ?? "",
        phone: data?.phone ?? "",
        email: data?.email ?? "",
      });
    } catch {
      toast("No se pudo cargar la empresa", "x");
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f: any) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await authFetch("/config/company", {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          address: form.address,
          city: form.city,
          region: form.region,
          phone: form.phone,
          email: form.email,
          taxId: form.taxId,
        }),
      });
      const d: any = await res.json();
      if (!res.ok) throw new Error(d?.message || "Error");
      setCompany(d);
      toast("Empresa actualizada");
    } catch (e) {
      toast(mensajeDeError(e, "No se pudo guardar"), "x");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon name="settings" size={16} className="text-text-secondary" />
        <h2 className="text-[14px] font-bold text-text-primary">Datos de la empresa</h2>
        {company?.currency && (
          <Badge label={company.currency} tone="info" />
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nombre">
          <Input value={form.name} onChange={set("name")} placeholder="Nombre de la empresa" />
        </Field>
        <Field label="NIT / Tax ID">
          <Input value={form.taxId} onChange={set("taxId")} placeholder="NIT" />
        </Field>
        <Field label="Dirección">
          <Input value={form.address} onChange={set("address")} placeholder="Dirección" />
        </Field>
        <Field label="Ciudad">
          <Input value={form.city} onChange={set("city")} placeholder="Ciudad" />
        </Field>
        <Field label="Departamento / Región">
          <Input value={form.region} onChange={set("region")} placeholder="Región" />
        </Field>
        <Field label="Teléfono">
          <Input value={form.phone} onChange={set("phone")} placeholder="Teléfono" />
        </Field>
        <Field label="Correo">
          <Input value={form.email} onChange={set("email")} placeholder="correo@empresa.com" />
        </Field>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={save} disabled={saving}>
          <Icon name="check" size={15} />
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sedes                                                                       */
/* -------------------------------------------------------------------------- */

function SedesTab() {
  const { authFetch } = useAuth();
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<any[]>([]);
  // `editing === "nueva"` es el alta; un objeto, la edición de esa sede.
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ name: "", summary: "", dir: "", isActive: true });
  const [saving, setSaving] = useState(false);
  const [borrar, setBorrar] = useState<any>(null);
  const [borrando, setBorrando] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data: any = await (await authFetch("/config/branches")).json();
      setBranches(Array.isArray(data) ? data : []);
    } catch {
      toast("No se pudieron cargar las sedes", "x");
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = (row: any) => {
    setEditing(row);
    setForm({ name: row?.name ?? "", summary: row?.summary ?? "", dir: row?.dir ?? "", isActive: row?.isActive !== false });
  };

  const nueva = editing === "nueva";

  const save = async () => {
    if (!editing) return;
    if (form.name.trim().length < 2) { toast("Escribe el nombre de la sede", "x"); return; }
    setSaving(true);
    try {
      // Una sede nueva nace activa: el interruptor sólo se ofrece al editar.
      const res = nueva
        ? await authFetch("/config/branches", { method: "POST", body: JSON.stringify({ name: form.name, summary: form.summary, dir: form.dir }) })
        : await authFetch(`/config/branches/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify({ name: form.name, summary: form.summary, dir: form.dir, isActive: form.isActive }),
          });
      const d: any = await res.json();
      if (!res.ok) throw new Error(d?.message || "Error");
      toast(nueva ? `Sede «${d.name}» creada` : "Sede actualizada");
      setEditing(null);
      await load();
    } catch (e) {
      toast(mensajeDeError(e, "No se pudo guardar"), "x");
    } finally {
      setSaving(false);
    }
  };

  const eliminar = async () => {
    if (!borrar) return;
    setBorrando(true);
    try {
      const res = await authFetch(`/config/branches/${borrar.id}`, { method: "DELETE" });
      const d: any = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.message || "No se pudo eliminar");
      toast(`Sede «${borrar.name}» eliminada`);
      await load();
    } catch (e) {
      toast(mensajeDeError(e, "No se pudo eliminar"), "x");
    } finally {
      setBorrando(false);
      setBorrar(null);
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => { setEditing("nueva"); setForm({ name: "", summary: "", dir: "", isActive: true }); }}>
          <Icon name="plus" size={15} /> Nueva sede
        </Button>
      </div>
      <DataTable
        rows={branches}
        columns={[
          { key: "name", header: "Sede", render: (r: any) => <span className="font-medium">{r.name}</span> },
          { key: "dir", header: "Dirección", render: (r: any) => r.dir || "—" },
          {
            key: "isActive",
            header: "Estado",
            // Una sede desactivada no se ofrece en ningún selector ni filtro del sistema,
            // pero conserva sus clientes y su historia: de ahí "Oculta" y no "Eliminada".
            render: (r: any) =>
              r.isActive === false ? <Badge label="Oculta" tone="warning" /> : <Badge label="Activa" tone="success" />,
          },
          {
            key: "subscribers",
            header: "# Abonados",
            align: "right",
            render: (r: any) => r.subscribers ?? 0,
          },
          {
            key: "actions",
            header: "",
            align: "right",
            render: (r: any) => (
              <div className="flex items-center justify-end gap-1">
                <Button variant="secondary" size="sm" onClick={() => openEdit(r)}>
                  Editar
                </Button>
                {/* Con abonados ni se ofrece (para eso está «ocultar»); lo demás que la
                    ata (equipos, usuarios, cajas…) lo dice el servidor al intentarlo. */}
                {!r.subscribers && (
                  <button type="button" onClick={() => setBorrar(r)} className="tap rounded-md p-1.5 text-text-tertiary hover:bg-error-soft hover:text-error-text" title="Eliminar sede">
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />

      <Modal open={!!editing} onClose={() => setEditing(null)} title={nueva ? "Nueva sede" : "Editar sede"}>
        <div className="flex flex-col gap-3">
          <Field label="Nombre">
            <Input
              value={form.name}
              onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label="Resumen">
            <Input
              value={form.summary}
              onChange={(e) => setForm((f: any) => ({ ...f, summary: e.target.value }))}
            />
          </Field>
          <Field label="Dirección">
            <Input
              value={form.dir}
              onChange={(e) => setForm((f: any) => ({ ...f, dir: e.target.value }))}
            />
          </Field>
          {!nueva && <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.isActive !== false}
              onChange={(e) => setForm((f: any) => ({ ...f, isActive: e.target.checked }))}
            />
            <span>
              <span className="font-medium">Sede activa</span>
              <span className="block text-text-secondary">
                Al desmarcarla, la sede deja de aparecer en los desplegables y filtros de todo el
                sistema (clientes, órdenes, agenda, reportes, inventario, red…). No se borra nada:
                sus clientes, facturas y órdenes siguen igual y se vuelve a mostrar marcándola otra vez.
              </span>
            </span>
          </label>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              <Icon name="check" size={15} />
              {saving ? "Guardando…" : nueva ? "Crear sede" : "Guardar"}
            </Button>
          </div>
        </div>
      </Modal>

      {borrar && (
        <ConfirmDialog
          open
          tone="danger"
          icon="trash"
          busy={borrando}
          title={`Eliminar sede «${borrar.name}»`}
          confirmLabel="Eliminar sede"
          message={<>Solo se puede si nada la usa: ni abonados, ni equipos de red, ni usuarios con acceso, ni cajas, bodegas o centro de costo. Si algo la usa, el sistema te dirá qué; en ese caso, ocúltala desmarcándola como activa.</>}
          onConfirm={() => void eliminar()}
          onClose={() => setBorrar(null)}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Cajas                                                                       */
/* -------------------------------------------------------------------------- */

function CajasTab() {
  const { authFetch } = useAuth();
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data: any = await (await authFetch("/config/cash-accounts")).json();
      setAccounts(Array.isArray(data) ? data : []);
    } catch {
      toast("No se pudieron cargar las cajas", "x");
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <PageSkeleton />;

  return (
    <DataTable
      rows={accounts}
      columns={[
        { key: "holder", header: "Titular", render: (r: any) => <span className="font-medium">{r.holder}</span> },
        { key: "accountNumber", header: "Nº cuenta", render: (r: any) => r.accountNumber || "—" },
        { key: "sede", header: "Sede", render: (r: any) => r.sede || "—" },
        {
          key: "balance",
          header: "Saldo",
          align: "right",
          render: (r: any) => (
            <span className={Number(r.balance) < 0 ? "font-semibold text-error-text" : "font-medium"}>
              {cop(Number(r.balance) || 0)}
            </span>
          ),
        },
      ]}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Página                                                                      */
/* -------------------------------------------------------------------------- */

export default function ConfiguracionPage() {
  const { loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("Empresa");
  // ?tab=Direcciones abre directo esa pestaña. Se lee después de montar: el servidor
  // pinta «Empresa» y arrancar en otra dejaba resaltada la píldora equivocada.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some((x) => x.key === t)) setTab(t as Tab);
  }, []);

  if (authLoading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        icon="sliders-horizontal"
        title="Configuración"
        subtitle="Empresa, sedes, direcciones y cajas"
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                active
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-border-default text-text-secondary hover:bg-surface-2"
              }`}
            >
              <Icon name={t.icon} size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "Empresa" && <EmpresaTab />}
      {tab === "Sedes" && <SedesTab />}
      {tab === "Direcciones" && <DireccionesTab />}
      {tab === "Cajas" && <CajasTab />}
    </div>
  );
}
