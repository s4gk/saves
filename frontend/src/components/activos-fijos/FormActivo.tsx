"use client";

import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { toast } from "@/components/ui/Toast";
import { cop } from "@/lib/format";
import { tomarGps, Precision, type PuntoGps } from "./UbicacionGps";
import { aDia, type ActivoDetalle, type ActivoEntrada, type ActivosApi, type MetaActivos } from "@/lib/activos-fijos";

type Estado = Record<Exclude<keyof ActivoEntrada, "latitude" | "longitude" | "gpsAccuracy">, string>;

const VACIO: Estado = {
  code: "", name: "", categoryId: "", brand: "", model: "", serialNumber: "", branchId: "", location: "",
  responsible: "", supplier: "", invoiceNumber: "", acquisitionDate: "", inServiceDate: "", acquisitionCost: "",
  residualValue: "", usefulLifeMonths: "", notes: "",
};

function desde(a: ActivoDetalle): Estado {
  return {
    code: a.code, name: a.name, categoryId: a.category.id, brand: a.brand ?? "", model: a.model ?? "",
    serialNumber: a.serialNumber ?? "", branchId: a.branch?.id ?? "", location: a.location ?? "",
    responsible: a.responsible ?? "", supplier: a.supplier ?? "", invoiceNumber: a.invoiceNumber ?? "",
    acquisitionDate: aDia(a.acquisitionDate), inServiceDate: aDia(a.inServiceDate),
    acquisitionCost: String(a.acquisitionCost), residualValue: a.residualValue ? String(a.residualValue) : "",
    usefulLifeMonths: String(a.usefulLifeMonths), notes: a.notes ?? "",
  };
}

/** "8.500.000" o "8500000" → 8500000. */
const pesos = (s: string) => Number(String(s).replace(/[^\d,]/g, "").replace(",", ".")) || 0;

/**
 * Alta y edición de un activo. En el alta se pueden elegir las fotos de una vez: se
 * suben apenas el activo queda creado.
 */
export function FormActivo({
  api, meta, activo, onGuardado, onCancelar,
}: {
  api: ActivosApi;
  meta: MetaActivos;
  /** Sin activo = alta. */
  activo?: ActivoDetalle;
  onGuardado: (a: ActivoDetalle) => void;
  onCancelar: () => void;
}) {
  const [f, setF] = useState<Estado>(() => (activo ? desde(activo) : { ...VACIO, acquisitionDate: aDia(new Date().toISOString()) }));
  const [fotos, setFotos] = useState<File[]>([]);
  const [gps, setGps] = useState<PuntoGps | null>(null);
  const [tomandoGps, setTomandoGps] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [intento, setIntento] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const set = (k: keyof Estado) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const categoria = meta.categories.find((c) => c.id === f.categoryId);
  const conDepreciacion = (activo?.depreciations.length ?? 0) > 0;
  const vida = Number(f.usefulLifeMonths) || categoria?.usefulLifeMonths || 0;
  const cuota = vida ? Math.max(0, pesos(f.acquisitionCost) - pesos(f.residualValue)) / vida : 0;

  const errores = useMemo(() => {
    const e: Partial<Record<keyof Estado, string>> = {};
    if (f.name.trim().length < 2) e.name = "Escribe el nombre del activo";
    if (!f.categoryId) e.categoryId = "Elige la categoría";
    if (!f.acquisitionDate) e.acquisitionDate = "¿Cuándo se compró?";
    if (!f.acquisitionCost || pesos(f.acquisitionCost) <= 0) e.acquisitionCost = "Escribe el costo";
    if (pesos(f.residualValue) > pesos(f.acquisitionCost)) e.residualValue = "No puede superar el costo";
    return e;
  }, [f]);

  async function guardar() {
    setIntento(true);
    if (Object.keys(errores).length) return;
    const dto: ActivoEntrada = {
      name: f.name.trim(), categoryId: f.categoryId,
      brand: f.brand, model: f.model, serialNumber: f.serialNumber, branchId: f.branchId,
      location: f.location, responsible: f.responsible, supplier: f.supplier, invoiceNumber: f.invoiceNumber,
      acquisitionDate: f.acquisitionDate, inServiceDate: f.inServiceDate || undefined,
      acquisitionCost: pesos(f.acquisitionCost), residualValue: pesos(f.residualValue),
      usefulLifeMonths: f.usefulLifeMonths ? Number(f.usefulLifeMonths) : undefined,
      notes: f.notes,
    };
    if (f.code.trim()) dto.code = f.code.trim();
    if (!activo && gps) { dto.latitude = gps.lat; dto.longitude = gps.lng; dto.gpsAccuracy = gps.accuracy; }
    setGuardando(true);
    try {
      let a: ActivoDetalle;
      if (activo) {
        // Con meses ya contabilizados, lo que mueve el cálculo no se envía (la API lo rechaza).
        const cambios: Partial<ActivoEntrada> = { ...dto, code: f.code.trim() || activo.code };
        if (conDepreciacion) {
          delete cambios.acquisitionCost; delete cambios.residualValue;
          delete cambios.usefulLifeMonths; delete cambios.inServiceDate;
        }
        a = await api.update(activo.id, cambios);
      } else {
        a = await api.create(dto);
        let fallas = 0;
        for (const foto of fotos) {
          try { await api.uploadPhoto(a.id, foto); } catch { fallas++; }
        }
        if (fallas) toast(`El activo quedó creado, pero ${fallas} foto(s) no se subieron`, "alert-triangle");
      }
      toast(activo ? "Activo actualizado" : `Activo ${a.code} creado`, "check");
      onGuardado(a);
    } catch (e) {
      toast((e as Error).message, "alert-triangle");
    } finally {
      setGuardando(false);
    }
  }

  const err = (k: keyof Estado) => (intento ? errores[k] : undefined);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label="Nombre" required error={err("name")}>
            <Input value={f.name} onChange={set("name")} placeholder="Ej.: OLT Huawei MA5608T nodo Yopal" autoFocus />
          </Field>
        </div>
        <Field label="Código" hint={activo ? undefined : "Vacío = automático (AF-00001)"}>
          <Input value={f.code} onChange={set("code")} placeholder="AF-…" />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Categoría" required error={err("categoryId")}>
          <Select value={f.categoryId} onChange={set("categoryId")}>
            <option value="">— Elegir —</option>
            {meta.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({Math.round(c.usefulLifeMonths / 12 * 10) / 10} años)</option>
            ))}
          </Select>
        </Field>
        <Field label="Serial">
          <Input value={f.serialNumber} onChange={set("serialNumber")} placeholder="El de la placa del fabricante" />
        </Field>
        <Field label="Marca">
          <Input value={f.brand} onChange={set("brand")} placeholder="Huawei, Mikrotik, Lenovo…" />
        </Field>
        <Field label="Modelo">
          <Input value={f.model} onChange={set("model")} placeholder="MA5608T, CCR2004…" />
        </Field>
        <Field label="Sede">
          <Select value={f.branchId} onChange={set("branchId")}>
            <option value="">— Sin sede —</option>
            {meta.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Ubicación">
          <Input value={f.location} onChange={set("location")} placeholder="Nodo, rack, oficina…" />
        </Field>
        <Field label="Responsable">
          <Input value={f.responsible} onChange={set("responsible")} placeholder="Quién lo tiene a cargo" />
        </Field>
        <Field label="Proveedor">
          <Input value={f.supplier} onChange={set("supplier")} />
        </Field>
        <Field label="Factura de compra">
          <Input value={f.invoiceNumber} onChange={set("invoiceNumber")} />
        </Field>
        <Field label="Fecha de compra" required error={err("acquisitionDate")}>
          <Input type="date" value={f.acquisitionDate} onChange={set("acquisitionDate")} />
        </Field>
      </div>

      <fieldset className="rounded-xl border border-border-subtle p-3">
        <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-text-tertiary">Valor y depreciación</legend>
        {conDepreciacion && (
          <p className="mb-2 text-[12px] text-warning-text">
            Ya tiene depreciación contabilizada: costo, residual, vida útil y fecha de uso quedan fijos.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Costo" required error={err("acquisitionCost")}>
            <Input inputMode="numeric" value={f.acquisitionCost} onChange={set("acquisitionCost")} disabled={conDepreciacion} placeholder="8500000" />
          </Field>
          <Field label="Valor residual" error={err("residualValue")} hint="Lo que valdrá al final de su vida útil. Casi siempre 0.">
            <Input inputMode="numeric" value={f.residualValue} onChange={set("residualValue")} disabled={conDepreciacion} placeholder="0" />
          </Field>
          <Field label="Vida útil (meses)" hint={categoria ? `Vacío = ${categoria.usefulLifeMonths} (la de la categoría)` : undefined}>
            <Input inputMode="numeric" value={f.usefulLifeMonths} onChange={set("usefulLifeMonths")} disabled={conDepreciacion} />
          </Field>
          <Field label="En uso desde" hint="Desde este mes se deprecia. Vacío = la fecha de compra.">
            <Input type="date" value={f.inServiceDate} onChange={set("inServiceDate")} disabled={conDepreciacion} />
          </Field>
        </div>
        {cuota > 0 && (
          <p className="mt-2 text-[12px] text-text-tertiary">
            Se deprecia <span className="font-semibold text-text-secondary">{cop(cuota)}</span> al mes durante {vida} meses.
          </p>
        )}
      </fieldset>

      <Field label="Notas">
        <Textarea rows={2} value={f.notes} onChange={set("notes")} />
      </Field>

      {!activo && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={tomandoGps}
              onClick={async () => { setTomandoGps(true); const p = await tomarGps(); if (p) setGps(p); setTomandoGps(false); }}
            >
              <Icon name="map-pin" size={14} /> {tomandoGps ? "Tomando GPS…" : gps ? "Tomar de nuevo" : "Tomar ubicación GPS"}
            </Button>
            {gps && (
              <span className="flex items-center gap-1.5 text-[12px]">
                <span className="font-mono text-text-secondary">{gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}</span>
                <Precision m={gps.accuracy} />
                <button type="button" className="tap cursor-pointer text-text-tertiary" aria-label="Quitar ubicación" onClick={() => setGps(null)}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            )}
          </div>
          <p className="text-[11.5px] text-text-tertiary">Tómala parado junto al equipo. Si no estás en el sitio, se puede tomar después desde la ficha.</p>
        </div>
      )}

      {!activo && (
        <div>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => setFotos((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => input.current?.click()}>
              <Icon name="camera" size={14} /> {fotos.length ? "Agregar más fotos" : "Tomar o subir fotos"}
            </Button>
            {fotos.map((foto, i) => (
              <span key={i} className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11.5px] text-text-secondary">
                <Icon name="image" size={12} /> {foto.name.length > 22 ? `${foto.name.slice(0, 20)}…` : foto.name}
                <button type="button" className="tap cursor-pointer text-text-tertiary" aria-label="Quitar" onClick={() => setFotos((p) => p.filter((_, j) => j !== i))}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
          <p className="mt-1 text-[11.5px] text-text-tertiary">El equipo, la placa con el serial y dónde quedó instalado.</p>
        </div>
      )}

      <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancelar}>Cancelar</Button>
        <Button onClick={() => void guardar()} disabled={guardando}>
          {guardando ? (fotos.length ? "Guardando y subiendo fotos…" : "Guardando…") : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
