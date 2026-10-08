"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { toast } from "@/components/ui/Toast";
import { cop } from "@/lib/format";
import type { ActivosApi, PreviaDepreciacion, ResultadoCargue } from "@/lib/activos-fijos";

/** Cargue masivo: bajar la plantilla, llenarla y subirla. Las fotos se agregan después, activo por activo. */
export function CargueExcel({ api, onHecho }: { api: ActivosApi; onHecho: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCargue | null>(null);

  async function subir(file: File | undefined) {
    if (!file) return;
    setSubiendo(true);
    setResultado(null);
    try {
      const r = await api.importExcel(file);
      setResultado(r);
      if (r.created) { toast(`${r.created} activo(s) cargado(s)`, "check"); onHecho(); }
    } catch (e) {
      toast((e as Error).message, "alert-triangle");
    } finally {
      setSubiendo(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-3 text-[13px] text-text-secondary">
      <ol className="list-decimal space-y-1 pl-5">
        <li>Baja la plantilla. Trae una fila de ejemplo (bórrala) y las hojas con las categorías y las sedes.</li>
        <li>Llena una fila por activo. Obligatorios: <b>nombre</b>, <b>categoria</b>, <b>fecha_compra</b> y <b>costo</b>.</li>
        <li>Súbela. Después abres cada activo para agregarle sus fotos.</li>
      </ol>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="secondary" onClick={() => api.template().catch((e: Error) => toast(e.message, "alert-triangle"))}>
          <Icon name="download" size={14} /> Bajar plantilla
        </Button>
        <Button onClick={() => input.current?.click()} disabled={subiendo}>
          <Icon name="upload" size={14} /> {subiendo ? "Cargando…" : "Subir Excel"}
        </Button>
        <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => void subir(e.target.files?.[0])} />
      </div>
      {resultado && (
        <div className="rounded-xl border border-border-subtle bg-surface-2 p-3">
          <p className="font-semibold text-text-primary">
            {resultado.created} cargado(s){resultado.skipped ? ` · ${resultado.skipped} fila(s) vacía(s)` : ""}
            {resultado.errors.length ? ` · ${resultado.errors.length} con error` : ""}
          </p>
          {resultado.errors.length > 0 && (
            <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-[12px] text-error-text">
              {resultado.errors.map((e) => <li key={e.row}>Fila {e.row}: {e.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/**
 * Depreciación del mes: primero se ve qué se contabilizaría (activo por activo) y
 * luego se genera el asiento. Si hubo meses sin correr, el importe se pone al día.
 */
export function CorridaDepreciacion({ api, onHecho }: { api: ActivosApi; onHecho: () => void }) {
  // Por defecto el mes anterior: la depreciación se corre al cerrar el mes.
  const hoy = new Date();
  const ant = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const [year, setYear] = useState(ant.getFullYear());
  const [month, setMonth] = useState(ant.getMonth() + 1);
  const [previa, setPrevia] = useState<PreviaDepreciacion | null>(null);
  const [cargando, setCargando] = useState(false);
  const [corriendo, setCorriendo] = useState(false);

  async function calcular() {
    setCargando(true);
    try { setPrevia(await api.previewDepreciation(year, month)); }
    catch (e) { toast((e as Error).message, "alert-triangle"); }
    finally { setCargando(false); }
  }

  async function correr() {
    if (!previa?.rows.length) return;
    if (!confirm(`¿Contabilizar ${cop(previa.total)} de depreciación de ${MESES[month - 1]} ${year}? Se genera un asiento en el libro diario.`)) return;
    setCorriendo(true);
    try {
      const r = await api.runDepreciation(year, month);
      toast(`Asiento ${r.journalNumber ?? ""} generado: ${cop(r.total)} de ${r.assets} activo(s)`, "check");
      setPrevia(null);
      onHecho();
    } catch (e) {
      toast((e as Error).message, "alert-triangle");
    } finally {
      setCorriendo(false);
    }
  }

  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p className="text-text-secondary">
        Genera un asiento: débito a <b>5160 Depreciaciones</b> por centro de costo (la sede del activo) y crédito a <b>1592 Depreciación acumulada</b>.
        Correr dos veces el mismo mes sólo recoge lo que faltaba.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Mes">
          <Select value={month} onChange={(e) => { setMonth(Number(e.target.value)); setPrevia(null); }}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Año">
          <Select value={year} onChange={(e) => { setYear(Number(e.target.value)); setPrevia(null); }}>
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
        </Field>
        <Button variant="secondary" className="col-span-2 sm:col-span-1" onClick={() => void calcular()} disabled={cargando}>
          {cargando ? "Calculando…" : "Calcular"}
        </Button>
      </div>
      {previa && (
        previa.rows.length === 0 ? (
          <p className="rounded-xl bg-surface-2 p-3 text-text-tertiary">Nada por contabilizar en {MESES[previa.month - 1]} {previa.year}.</p>
        ) : (
          <>
            <div className="max-h-72 overflow-auto rounded-xl border border-border-subtle">
              <table className="w-full min-w-[480px] text-[12.5px]">
                <thead className="sticky top-0 bg-surface-2 text-left text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                  <tr><th className="px-3 py-2">Activo</th><th className="px-3 py-2">Sede</th><th className="px-3 py-2 text-right">Este asiento</th><th className="px-3 py-2 text-right">Queda en libros</th></tr>
                </thead>
                <tbody>
                  {previa.rows.map((r) => (
                    <tr key={r.id} className="border-t border-border-subtle">
                      <td className="px-3 py-1.5"><span className="font-mono text-[11px] text-text-tertiary">{r.code}</span> {r.name}</td>
                      <td className="px-3 py-1.5 text-text-secondary">{r.branch ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{cop(r.amount)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-text-secondary">{cop(r.bookValueAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-semibold text-text-primary">Total: {cop(previa.total)} · {previa.rows.length} activo(s)</span>
              <Button onClick={() => void correr()} disabled={corriendo}>
                {corriendo ? "Contabilizando…" : "Contabilizar"}
              </Button>
            </div>
          </>
        )
      )}
    </div>
  );
}
