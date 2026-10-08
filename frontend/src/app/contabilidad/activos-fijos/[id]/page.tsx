"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeading } from "@/components/ui/PageHeading";
import { PageSkeleton } from "@/components/skeletons/PageSkeleton";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { toast } from "@/components/ui/Toast";
import { useAuth } from "@/context/AuthProvider";
import { cop, fmtDate } from "@/lib/format";
import { activosApi, aDia, ESTADO_ACTIVO, type ActivoDetalle, type MetaActivos } from "@/lib/activos-fijos";
import { GaleriaActivo } from "@/components/activos-fijos/FotoActivo";
import { FormActivo } from "@/components/activos-fijos/FormActivo";
import { UbicacionGps } from "@/components/activos-fijos/UbicacionGps";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] text-text-primary">{children || "—"}</dd>
    </div>
  );
}

/** Ficha del activo: fotos, identificación, dónde está, valor y su depreciación mes a mes. */
export default function ActivoFijoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { authFetch, can } = useAuth();
  const api = useMemo(() => activosApi(authFetch), [authFetch]);
  const puedeEditar = can(["area.contabilidad", "area.administracion"]);

  const [a, setA] = useState<ActivoDetalle | null>(null);
  const [meta, setMeta] = useState<MetaActivos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"editar" | "baja" | null>(null);
  const [baja, setBaja] = useState({ date: aDia(new Date().toISOString()), proceeds: "", reason: "" });
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try { setA(await api.detail(id)); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, [api, id]);

  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { if (puedeEditar) api.meta().then(setMeta).catch(() => undefined); }, [api, puedeEditar]);

  async function darDeBaja() {
    if (!a) return;
    if (baja.reason.trim().length < 3) { toast("Escribe el motivo de la baja", "alert-triangle"); return; }
    setOcupado(true);
    try {
      const proceeds = Number(baja.proceeds.replace(/[^\d]/g, "")) || 0;
      setA(await api.dispose(a.id, { date: baja.date, proceeds, reason: baja.reason.trim() }));
      setModal(null);
      toast("Activo dado de baja", "check");
    } catch (e) {
      toast((e as Error).message, "alert-triangle");
    } finally {
      setOcupado(false);
    }
  }

  async function borrar() {
    if (!a) return;
    if (!confirm(`¿Borrar ${a.code} · ${a.name}? Sólo para lo cargado por error; se borran también sus fotos.`)) return;
    try {
      await api.remove(a.id);
      toast("Activo borrado", "check");
      router.push("/contabilidad/activos-fijos");
    } catch (e) {
      toast((e as Error).message, "alert-triangle");
    }
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading icon="boxes" title="Activo fijo" showBack backHref="/contabilidad/activos-fijos" backLabel="Activos fijos" />
        <p className="rounded-xl border border-border-subtle bg-surface p-4 text-text-secondary">{error}</p>
      </div>
    );
  }
  if (!a) return <PageSkeleton />;

  const estado = ESTADO_ACTIVO[a.status];
  const avance = a.acquisitionCost > a.residualValue
    ? Math.min(100, Math.round((a.depreciationToDate / (a.acquisitionCost - a.residualValue)) * 100))
    : 100;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading
          icon="boxes"
          title={a.name}
          subtitle={`${a.code} · ${a.category.name}${a.branch ? ` · ${a.branch.name}` : ""}`}
          showBack
          backHref="/contabilidad/activos-fijos"
          backLabel="Activos fijos"
        />
        {puedeEditar && (
          <div className="grid grid-cols-3 gap-2 sm:flex sm:shrink-0">
            <Button variant="secondary" onClick={() => setModal("editar")} disabled={!meta}>
              <Icon name="pencil" size={13} /> Editar
            </Button>
            {a.status !== "DISPOSED" && (
              <Button variant="secondary" onClick={() => setModal("baja")}>
                <Icon name="package-x" size={13} /> Dar de baja
              </Button>
            )}
            {a.depreciations.length === 0 && (
              <Button variant="danger" onClick={() => void borrar()}>
                <Icon name="trash" size={13} /> Borrar
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-border-subtle bg-surface p-4">
            <h2 className="mb-3 flex items-center gap-2 text-[13px] font-bold text-text-primary">
              <Icon name="camera" size={15} /> Fotos <span className="font-normal text-text-tertiary">({a.photos.length})</span>
            </h2>
            <GaleriaActivo api={api} assetId={a.id} fotos={a.photos} puedeEditar={puedeEditar} onCambio={() => void cargar()} />
          </section>

          <UbicacionGps api={api} activo={a} puedeEditar={puedeEditar} onCambio={setA} />

          <section className="rounded-xl border border-border-subtle bg-surface p-4">
            <h2 className="mb-3 text-[13px] font-bold text-text-primary">Identificación y ubicación</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Dato label="Marca">{a.brand}</Dato>
              <Dato label="Modelo">{a.model}</Dato>
              <Dato label="Serial"><span className="font-mono">{a.serialNumber}</span></Dato>
              <Dato label="Sede">{a.branch?.name}</Dato>
              <Dato label="Ubicación">{a.location}</Dato>
              <Dato label="Responsable">{a.responsible}</Dato>
              <Dato label="Proveedor">{a.supplier}</Dato>
              <Dato label="Factura de compra">{a.invoiceNumber}</Dato>
              <Dato label="Registrado por">{a.createdBy}</Dato>
            </dl>
            {a.notes && (
              <div className="mt-3 border-t border-border-subtle pt-3">
                <Dato label="Notas"><span className="whitespace-pre-line">{a.notes}</span></Dato>
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-border-subtle bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-bold text-text-primary">Valor</h2>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${estado.clase}`}>{estado.label}</span>
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Valor en libros hoy</div>
            <div className="text-[24px] font-bold tabular-nums text-text-primary">{cop(a.bookValue)}</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" aria-label={`Depreciado ${avance}%`}>
              <div className="h-full rounded-full bg-brand" style={{ width: `${avance}%` }} />
            </div>
            <div className="mt-1 text-[11.5px] text-text-tertiary">{avance}% depreciado</div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              <Dato label="Costo">{cop(a.acquisitionCost)}</Dato>
              <Dato label="Residual">{cop(a.residualValue)}</Dato>
              <Dato label="Depreciación a hoy">{cop(a.depreciationToDate)}</Dato>
              <Dato label="Cuota mensual">{cop(a.monthlyDepreciation)}</Dato>
              <Dato label="Compra">{fmtDate(a.acquisitionDate)}</Dato>
              <Dato label="En uso desde">{fmtDate(a.inServiceDate)}</Dato>
              <Dato label="Vida útil">{a.usefulLifeMonths} meses</Dato>
              <Dato label="Centro de costo">{a.costCenter ? `${a.costCenter.code}` : null}</Dato>
              {a.status === "DISPOSED" && (
                <>
                  <Dato label="Baja">{fmtDate(a.disposalDate)}</Dato>
                  <Dato label="Vendido por">{a.disposalProceeds ? cop(a.disposalProceeds) : "No se vendió"}</Dato>
                </>
              )}
            </dl>
          </section>

          <section className="rounded-xl border border-border-subtle bg-surface p-4">
            <h2 className="mb-1 text-[13px] font-bold text-text-primary">Depreciación contabilizada</h2>
            <p className="mb-2 text-[12px] text-text-tertiary">
              {a.postedThrough ? `Al día hasta ${a.postedThrough} · acumulada ${cop(a.accumulatedDepreciation)}` : "Aún no se ha corrido ningún mes para este activo."}
            </p>
            {a.depreciations.length > 0 && (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="text-left text-[10.5px] font-bold uppercase tracking-wider text-text-tertiary">
                    <tr><th className="py-1">Mes</th><th className="py-1 text-right">Importe</th><th className="py-1 text-right">En libros</th></tr>
                  </thead>
                  <tbody>
                    {a.depreciations.map((d) => (
                      <tr key={d.id} className="border-t border-border-subtle">
                        <td className="py-1">{MESES[d.month - 1]} {d.year}</td>
                        <td className="py-1 text-right tabular-nums">{cop(d.amount)}</td>
                        <td className="py-1 text-right tabular-nums text-text-secondary">{cop(d.bookValueAfter)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      <Modal open={modal === "editar"} onClose={() => setModal(null)} title={`Editar ${a.code}`} maxWidth="max-w-2xl">
        {meta && modal === "editar" && (
          <FormActivo api={api} meta={meta} activo={a} onCancelar={() => setModal(null)} onGuardado={(n) => { setA(n); setModal(null); }} />
        )}
      </Modal>

      <Modal open={modal === "baja"} onClose={() => setModal(null)} title={`Dar de baja ${a.code}`}>
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-text-secondary">
            La depreciación se congela en el mes de la baja. No se genera asiento: si se vendió, contabilidad registra a qué caja o banco entró la plata.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Fecha" required>
              <Input type="date" value={baja.date} onChange={(e) => setBaja({ ...baja, date: e.target.value })} />
            </Field>
            <Field label="Valor de venta" hint="Vacío si se desechó o se perdió">
              <Input inputMode="numeric" value={baja.proceeds} onChange={(e) => setBaja({ ...baja, proceeds: e.target.value })} placeholder="0" />
            </Field>
          </div>
          <Field label="Motivo" required>
            <Input value={baja.reason} onChange={(e) => setBaja({ ...baja, reason: e.target.value })} placeholder="Dañado por descarga eléctrica, vendido, robado…" />
          </Field>
          <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setModal(null)}>Cancelar</Button>
            <Button variant="danger" onClick={() => void darDeBaja()} disabled={ocupado}>{ocupado ? "Guardando…" : "Dar de baja"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
