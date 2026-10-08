"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Field } from "@/components/ui/Field";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageSkeleton } from "@/components/skeletons/PageSkeleton";
import { LoadError } from "@/components/ui/LoadError";
import { toast } from "@/components/ui/Toast";
import { useAuth } from "@/context/AuthProvider";
import { mensajeDeError } from "@/lib/errores";

type Nivel = "departments" | "cities" | "localities" | "neighborhoods";
type Fila = { id: string; legacyId: number | null; name: string; parent: number | null; propio: boolean; hijos: number; abonados: number };
type Catalogo = Record<Nivel, Fila[]>;

const NIVELES: { key: Nivel; titulo: string; uno: string; hijos: string }[] = [
  { key: "departments", titulo: "Departamentos", uno: "departamento", hijos: "ciudad(es)" },
  { key: "cities", titulo: "Ciudades", uno: "ciudad", hijos: "localidad(es)" },
  { key: "localities", titulo: "Localidades", uno: "localidad", hijos: "barrio(s)" },
  { key: "neighborhoods", titulo: "Barrios", uno: "barrio", hijos: "" },
];

/**
 * Catálogo de direcciones: departamento → ciudad → localidad → barrio, en columnas
 * (se elige uno y la columna de al lado enseña lo suyo). Es el mismo catálogo del que
 * tiran los selectores del alta del abonado (`DireccionFields`), así que lo que se crea
 * aquí aparece allí enseguida. Lo creado aquí no viaja al sistema anterior: lleva la
 * etiqueta «Nuevo» para que se distinga.
 */
export function DireccionesTab() {
  const { authFetch } = useAuth();
  const [data, setData] = useState<Catalogo | null>(null);
  const [err, setErr] = useState(false);
  // Lo elegido en cada nivel (por legacyId, que es como se cuelgan los hijos).
  const [sel, setSel] = useState<Partial<Record<Nivel, number>>>({});
  const [buscar, setBuscar] = useState<Record<Nivel, string>>({ departments: "", cities: "", localities: "", neighborhoods: "" });
  const [form, setForm] = useState<{ nivel: Nivel; fila: Fila | null; name: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [borrar, setBorrar] = useState<{ nivel: Nivel; fila: Fila } | null>(null);
  const [borrando, setBorrando] = useState(false);

  const load = useCallback(async () => {
    setErr(false);
    try {
      const res = await authFetch("/config/addresses");
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setErr(true);
    }
  }, [authFetch]);

  useEffect(() => { void load(); }, [load]);

  /** El padre de cada columna: la columna de la izquierda. */
  const padreDe = (i: number): number | undefined => (i === 0 ? undefined : sel[NIVELES[i - 1].key]);

  const columnas = useMemo(() => {
    if (!data) return [];
    return NIVELES.map((n, i) => {
      const padre = i === 0 ? undefined : sel[NIVELES[i - 1].key];
      const disponible = i === 0 || padre != null;
      const q = buscar[n.key].trim().toLowerCase();
      const filas = disponible
        ? data[n.key].filter((f) => (i === 0 || f.parent === padre) && (!q || f.name.toLowerCase().includes(q)))
        : [];
      return { ...n, i, disponible, filas };
    });
  }, [data, sel, buscar]);

  function elegir(nivel: Nivel, i: number, legacyId: number | null) {
    if (legacyId == null) return;
    // Elegir en un nivel borra lo elegido debajo: esa ciudad no es de este departamento.
    const nuevo: Partial<Record<Nivel, number>> = {};
    for (let k = 0; k < i; k++) nuevo[NIVELES[k].key] = sel[NIVELES[k].key];
    nuevo[nivel] = legacyId;
    setSel(nuevo);
  }

  async function guardar() {
    if (!form) return;
    const name = form.name.trim();
    if (name.length < 2) { toast("Escribe un nombre de al menos 2 letras", "alert-circle"); return; }
    setGuardando(true);
    try {
      const i = NIVELES.findIndex((n) => n.key === form.nivel);
      const res = form.fila
        ? await authFetch(`/config/addresses/${form.nivel}/${form.fila.id}`, { method: "PATCH", body: JSON.stringify({ name }) })
        : await authFetch(`/config/addresses/${form.nivel}`, { method: "POST", body: JSON.stringify({ name, parent: padreDe(i) }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.message || "No se pudo guardar");
      const uno = NIVELES[i].uno;
      toast(form.fila ? `Se renombró ${uno === "ciudad" || uno === "localidad" ? "la" : "el"} ${uno}` : `Se creó «${name}»`, "check");
      setForm(null);
      await load();
      // Lo recién creado queda elegido, para seguir colgándole cosas.
      if (!form.fila && d?.legacyId != null && form.nivel !== "neighborhoods") elegir(form.nivel, i, d.legacyId);
    } catch (e) {
      toast(mensajeDeError(e, "No se pudo guardar"), "alert-circle");
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!borrar) return;
    setBorrando(true);
    try {
      const res = await authFetch(`/config/addresses/${borrar.nivel}/${borrar.fila.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.message || "No se pudo eliminar");
      toast(`Se eliminó «${borrar.fila.name}»`, "check");
      if (sel[borrar.nivel] === borrar.fila.legacyId) {
        const i = NIVELES.findIndex((n) => n.key === borrar.nivel);
        const nuevo: Partial<Record<Nivel, number>> = {};
        for (let k = 0; k < i; k++) nuevo[NIVELES[k].key] = sel[NIVELES[k].key];
        setSel(nuevo);
      }
      await load();
    } catch (e) {
      toast(mensajeDeError(e, "No se pudo eliminar"), "alert-circle");
    } finally {
      setBorrando(false);
      setBorrar(null);
    }
  }

  if (err && !data) return <LoadError message="No se pudo cargar el catálogo de direcciones." onRetry={() => void load()} />;
  if (!data) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-text-tertiary">
        Elige un departamento y luego una ciudad y una localidad para ver y crear sus barrios. Es el mismo catálogo del
        alta del abonado. Lo creado aquí lleva la etiqueta «Nuevo» y no viaja al sistema anterior. Solo se puede eliminar
        lo que no tiene nada debajo ni abonados.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {columnas.map((c) => (
          <section key={c.key} className="flex min-h-[320px] flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h3 className="heading-3">
                {c.titulo}
                {c.disponible && <span className="ml-1.5 text-[12px] font-normal text-text-tertiary">{c.filas.length}</span>}
              </h3>
              <Button
                size="sm"
                variant="secondary"
                disabled={!c.disponible}
                title={c.disponible ? `Nuevo ${c.uno}` : `Elige primero ${NIVELES[c.i - 1]?.uno}`}
                onClick={() => setForm({ nivel: c.key, fila: null, name: "" })}
              >
                <Icon name="plus" size={14} /> Nuevo
              </Button>
            </div>
            {c.disponible ? (
              <>
                <Input
                  value={buscar[c.key]}
                  onChange={(e) => setBuscar((b) => ({ ...b, [c.key]: e.target.value }))}
                  placeholder={`Buscar ${c.uno}…`}
                  aria-label={`Buscar ${c.uno}`}
                />
                <ul className="-mx-1 max-h-[420px] flex-1 overflow-y-auto">
                  {c.filas.length === 0 && (
                    <li className="px-2 py-6 text-center text-[12px] text-text-tertiary">
                      {buscar[c.key].trim() ? "Nada coincide." : `Aún no hay ${c.titulo.toLowerCase()} aquí.`}
                    </li>
                  )}
                  {c.filas.map((f) => {
                    const activo = c.key !== "neighborhoods" && sel[c.key] === f.legacyId;
                    const enUso = f.hijos > 0 || f.abonados > 0;
                    return (
                      <li key={f.id} className="group">
                        <div
                          className={`flex items-center gap-1 rounded-md px-2 py-1.5 ${activo ? "bg-brand-soft" : "hover:bg-surface-2"} ${c.key !== "neighborhoods" ? "cursor-pointer" : ""}`}
                          onClick={() => c.key !== "neighborhoods" && elegir(c.key, c.i, f.legacyId)}
                        >
                          <div className="min-w-0 flex-1">
                            <p className={`flex items-center gap-1.5 truncate text-[13px] ${activo ? "font-semibold text-brand" : "text-text-primary"}`}>
                              <span className="truncate">{f.name}</span>
                              {f.propio && <Badge tone="info" label="Nuevo" />}
                            </p>
                            <p className="text-[11px] text-text-tertiary">
                              {[c.hijos && `${f.hijos} ${c.hijos}`, `${f.abonados.toLocaleString("es-CO")} abonado(s)`].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setForm({ nivel: c.key, fila: f, name: f.name }); }}
                            className="tap rounded-md p-1 text-text-tertiary opacity-60 hover:bg-surface-2 hover:text-text-primary group-hover:opacity-100"
                            title="Renombrar"
                          >
                            <Icon name="pencil" size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={enUso}
                            onClick={(e) => { e.stopPropagation(); setBorrar({ nivel: c.key, fila: f }); }}
                            className="tap rounded-md p-1 text-text-tertiary opacity-60 hover:bg-error-soft hover:text-error-text group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-text-tertiary"
                            title={enUso ? "No se puede eliminar: tiene cosas debajo o abonados" : "Eliminar"}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                          {c.key !== "neighborhoods" && <Icon name="chevron-right" size={14} className={activo ? "text-brand" : "text-text-tertiary"} />}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="flex flex-1 items-center justify-center px-2 text-center text-[12px] text-text-tertiary">
                Elige {NIVELES[c.i - 1].uno === "ciudad" || NIVELES[c.i - 1].uno === "localidad" ? "una" : "un"} {NIVELES[c.i - 1].uno} a la izquierda.
              </p>
            )}
          </section>
        ))}
      </div>

      {form && (
        <Modal
          open
          onClose={() => setForm(null)}
          title={form.fila ? `Renombrar ${NIVELES.find((n) => n.key === form.nivel)!.uno}` : `Nuevo ${NIVELES.find((n) => n.key === form.nivel)!.uno}`}
        >
          <div className="flex flex-col gap-3">
            {!form.fila && form.nivel !== "departments" && (
              <p className="text-[12px] text-text-secondary">
                Dentro de{" "}
                <b>
                  {(() => {
                    const i = NIVELES.findIndex((n) => n.key === form.nivel);
                    const padre = padreDe(i);
                    return data[NIVELES[i - 1].key].find((f) => f.legacyId === padre)?.name ?? "—";
                  })()}
                </b>
                {form.nivel === "cities" && ". Nace con una localidad «Ninguna» para poder colgarle barrios de una vez."}
              </p>
            )}
            <Field label="Nombre" required>
              <Input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") void guardar(); }}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setForm(null)}>Cancelar</Button>
              <Button size="sm" disabled={guardando} onClick={() => void guardar()}>
                <Icon name="check" size={14} /> {guardando ? "Guardando…" : form.fila ? "Guardar" : "Crear"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {borrar && (
        <ConfirmDialog
          open
          tone="danger"
          icon="trash"
          busy={borrando}
          title={`Eliminar «${borrar.fila.name}»`}
          confirmLabel="Eliminar"
          message={<>Desaparece del catálogo y deja de poder elegirse en la dirección del abonado. No se puede deshacer.</>}
          onConfirm={() => void eliminar()}
          onClose={() => setBorrar(null)}
        />
      )}
    </div>
  );
}
