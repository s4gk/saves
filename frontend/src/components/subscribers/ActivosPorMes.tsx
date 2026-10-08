"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { niceMax } from "@/components/charts/helpers";
import { useChartWidth } from "@/components/charts/useChartWidth";
import { Button } from "@/components/ui/Button";
import { LoadError } from "@/components/ui/LoadError";
import { Segmented } from "@/components/ui/Segmented";
import { Skeleton } from "@/components/ui/Skeleton";
import { useRequest } from "@/lib/useRequest";
import { SUB_STATUS_LABEL } from "@/lib/subscribers";

type Mes = { mes: string; fecha: string; valor: number; enCurso: boolean };
type Dia = { fecha: string; valor: number };
type Respuesta = { desde: string; meses: Mes[]; dias: Dia[] };
type Vista = "dia" | "mes";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1] ?? mes;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (n: number) => n.toLocaleString("es-CO");
/** "2026-07-28" → "28 de julio de 2026", sin pasar por Date (que corre el día). */
const fechaLarga = (f: string) => `${Number(f.slice(8, 10))} de ${nombreMes(f)} de ${f.slice(0, 4)}`;
/** El mismo día del mes anterior: "2026-09-15" → "2026-08-15". */
const mesAntes = (f: string) => {
  const y = Number(f.slice(0, 4));
  const m = Number(f.slice(5, 7));
  return `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}${f.slice(7)}`;
};

const COLOR = "var(--color-brand)";
const H = 260;
const ANCHO_RECUADRO = 240;

/** "+67 (1,4%)" contra la cifra con la que se compara. */
function Diferencia({ valor, previo, contra, subirEsBueno }: { valor: number; previo: number; contra: string; subirEsBueno: boolean }) {
  const dif = valor - previo;
  const pct = previo ? (Math.abs(dif) / previo) * 100 : null;
  // Verde y rojo sólo donde subir es buena noticia (activos, total). Que suba
  // «Cartera» o «Retirado» no es para pintarlo de verde, ni de rojo que baje.
  const tono = dif === 0 ? "text-text-tertiary" : !subirEsBueno ? "text-text-secondary" : dif > 0 ? "text-success-text" : "text-error-text";
  return (
    <span className={`flex flex-wrap items-center gap-1 text-[12px] font-semibold ${tono}`}>
      {dif !== 0 && <Icon name={dif > 0 ? "arrow-up" : "arrow-down"} size={12} />}
      {dif === 0 ? "Igual" : `${dif > 0 ? "+" : "−"}${num(Math.abs(dif))}`}
      {pct != null && pct >= 0.05 && ` (${pct.toLocaleString("es-CO", { maximumFractionDigits: 1 })}%)`}
      <span className="font-normal text-text-tertiary">frente {contra} ({num(previo)})</span>
    </span>
  );
}

/**
 * Clientes mes a mes: lo que se ve al entrar a /clientes.
 *
 * Sigue los filtros de estado y sede de la pantalla: sin estado son todos los
 * clientes; con «Activo», «Cartera»… los de ese estado. Arriba una cifra por mes
 * —este y los tres anteriores, cada uno contra el mes que le precede— y debajo la
 * línea, día a día o por cierre de mes, con la misma lectura
 * que el flujo de caja del Tablero: pasar el ratón (o el dedo) pone una guía y un
 * recuadro con la cifra de ese día y cuánto cambió.
 *
 * El eje no arranca en cero a propósito: la base se mueve ~1% de un mes a otro y
 * desde cero la línea sale plana, que es justo lo que no se quiere saber.
 */
export function ActivosPorMes({ status, branchId, onVerLista }: { status: string; branchId: string; onVerLista: () => void }) {
  const { data, cargando, error, refrescar } = useRequest<Respuesta>(
    () => {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (branchId) qs.set("branchId", branchId);
      return `/subscribers/activos-por-mes?${qs.toString()}`;
    },
    [status, branchId],
  );
  if (error && !data) return <LoadError message={error} onRetry={refrescar} />;
  if (cargando && !data) return <Skeleton className="h-[460px] w-full rounded-xl" />;
  if (!data?.meses.length) return null;
  return <Grafica data={data} status={status} onVerLista={onVerLista} />;
}

/**
 * Componente aparte a propósito: `useChartWidth` mide el contenedor UNA vez, al
 * montar. Dentro del de arriba montaba mientras aún se veía el esqueleto de carga
 * —sin contenedor que medir—, el ancho se quedaba en 0 y la gráfica no salía nunca.
 */
function Grafica({ data, status, onVerLista }: { data: Respuesta; status: string; onVerLista: () => void }) {
  const [vista, setVista] = useState<Vista>("dia");
  const estado = status ? (SUB_STATUS_LABEL[status] ?? status) : "";
  const subirEsBueno = !status || status === "ACTIVO";

  const { ref, width: W } = useChartWidth();
  const [sobre, setSobre] = useState<number | null>(null);
  // Igual que en FlujoCaja: con el dedo el punto se queda elegido y sus cifras salen
  // en una franja bajo la gráfica, no en el recuadro flotante.
  const [tactil, setTactil] = useState(false);
  const arrastrando = useRef(false);

  // La línea se dibuja de izquierda a derecha al cargar y al cambiar de vista o sede.
  const [lista, setLista] = useState(false);
  useEffect(() => {
    setLista(false);
    setSobre(null);
    let b = 0;
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setLista(true)); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [vista, data, W > 0]);

  // Tocar fuera de la gráfica suelta el punto elegido.
  useEffect(() => {
    if (!tactil || sobre == null) return;
    const fuera = (e: PointerEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) setSobre(null);
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [tactil, sobre, ref]);

  const meses = data.meses;
  const dias = data.dias;

  // De más nuevo a más viejo; cada tarjeta se compara con el mes que le precede.
  const tarjetas = meses
    .map((m, i) => ({ m, previo: meses[i - 1] as Mes | undefined }))
    .reverse();

  const porMes = vista === "mes";
  const puntos: Dia[] = porMes ? meses.map((m) => ({ fecha: m.fecha, valor: m.valor })) : dias;
  const n = puntos.length;
  const porFecha = new Map(dias.map((d) => [d.fecha, d.valor]));

  // Eje recortado: paso redondo que cubra el rango real, piso y techo en múltiplos suyos.
  const vMin = Math.min(...puntos.map((p) => p.valor));
  const vMax = Math.max(...puntos.map((p) => p.valor));
  const paso = niceMax((vMax - vMin) / 4 || 1);
  const lo = Math.floor(vMin / paso) * paso;
  const hi = Math.max(lo + paso, Math.ceil(vMax / paso) * paso);
  const ticks = Array.from({ length: Math.round((hi - lo) / paso) + 1 }, (_, i) => lo + i * paso);

  const padL = Math.ceil(Math.max(...ticks.map((t) => num(t).length)) * 11 * 0.58) + 14;
  const padR = 14;
  const padT = porMes ? 24 : 12;
  const padB = 24;
  const innerW = Math.max(W - padL - padR, 1);
  const innerH = H - padT - padB;
  const xAt = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => padT + innerH - ((v - lo) / (hi - lo)) * innerH;
  const linea = puntos.map((p, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(p.valor).toFixed(1)}`).join(" ");

  // Rótulos del eje X. Por mes, todos. Por día, el primer punto y cada día 1 —que
  // además lleva una raya: ahí cambia el mes—, saltando los que quedarían encimados.
  const rotulos: { i: number; texto: string; cambioDeMes: boolean }[] = [];
  puntos.forEach((p, i) => {
    const corto = `${nombreMes(p.fecha).slice(0, 3)} ${p.fecha.slice(2, 4)}`;
    if (porMes) return void rotulos.push({ i, texto: corto, cambioDeMes: false });
    const dia1 = p.fecha.endsWith("-01");
    if (i !== 0 && !dia1) return;
    const previo = rotulos.at(-1);
    if (previo && xAt(i) - xAt(previo.i) < 58) {
      // El día 1 manda sobre el rótulo del arranque de la serie.
      if (dia1 && !previo.cambioDeMes) rotulos.pop();
      else return;
    }
    rotulos.push({ i, texto: dia1 ? corto : `${Number(p.fecha.slice(8, 10))} ${nombreMes(p.fecha).slice(0, 3)}`, cambioDeMes: dia1 });
  });

  const indiceDe = (clientX: number, rect: DOMRect) => {
    const x = clientX - rect.left - padL;
    return Math.min(n - 1, Math.max(0, Math.round(n <= 1 ? 0 : (x / innerW) * (n - 1))));
  };
  const mover = (d: number) => setSobre((i) => Math.min(n - 1, Math.max(0, (i ?? n - 1) + d)));

  const p = sobre != null ? puntos[sobre] : null;
  const previo = sobre != null && sobre > 0 ? puntos[sobre - 1] : null;
  // Por día, además: el mismo día del mes pasado, que es la comparación que importa
  // (el 15 contra el 15, no contra el cierre).
  const haceUnMes = p && !porMes ? porFecha.get(mesAntes(p.fecha)) : undefined;
  const esHoy = sobre === n - 1;
  const izqRecuadro = sobre == null ? 0 : Math.max(0, Math.min(W - ANCHO_RECUADRO,
    xAt(sobre) > W / 2 ? xAt(sobre) - 12 - ANCHO_RECUADRO : xAt(sobre) + 12));

  const detalle = p && (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-text-primary">
          {porMes ? `${capital(nombreMes(p.fecha))} ${p.fecha.slice(0, 4)}` : fechaLarga(p.fecha)}
          {esHoy && <span className="ml-1 font-normal text-text-tertiary">· hoy</span>}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-brand" />
        <span className="text-[18px] font-bold leading-tight text-text-primary tabular-nums">{num(p.valor)}</span>
        <span className="text-text-tertiary">{estado ? `en «${estado}»` : "clientes"}</span>
      </div>
      <div className="mt-1 flex flex-col gap-0.5 border-t border-border-subtle pt-1">
        {previo ? (
          <Diferencia subirEsBueno={subirEsBueno} valor={p.valor} previo={previo.valor} contra={porMes ? `a ${nombreMes(previo.fecha)}` : "al día anterior"} />
        ) : (
          <span className="text-[12px] text-text-tertiary">Primer {porMes ? "mes" : "día"} medido</span>
        )}
        {haceUnMes != null && (
          <Diferencia subirEsBueno={subirEsBueno} valor={p.valor} previo={haceUnMes} contra={`al ${Number(p.fecha.slice(8, 10))} de ${nombreMes(mesAntes(p.fecha))}`} />
        )}
      </div>
    </>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold text-text-primary sm:text-[14px]">
            {estado ? `Clientes en «${estado}» mes a mes` : "Clientes mes a mes"}
          </h3>
          <p className="text-[11px] text-text-tertiary">
            {porMes ? "Cierre de cada mes" : "Día a día"} · pasa el cursor por la gráfica para comparar
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={onVerLista}>
            <Icon name="users" size={15} /> Ver la lista
          </Button>
          <Segmented
            ariaLabel="Cómo agrupar la gráfica"
            value={vista}
            onChange={setVista}
            options={[{ value: "dia", label: "Por día" }, { value: "mes", label: "Por mes" }]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tarjetas.map(({ m, previo: ant }) => (
          <div key={m.mes} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border-subtle bg-surface-2 p-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
              {capital(nombreMes(m.mes))} {m.mes.slice(0, 4)}{m.enCurso ? " · hoy" : ""}
            </span>
            <span className="text-[24px] font-bold leading-none text-text-primary tabular-nums">{num(m.valor)}</span>
            {ant ? (
              <Diferencia subirEsBueno={subirEsBueno} valor={m.valor} previo={ant.valor} contra={`a ${nombreMes(ant.mes)}`} />
            ) : (
              <span className="text-[12px] text-text-tertiary">Primer mes medido</span>
            )}
          </div>
        ))}
      </div>

      <div>
        <div ref={ref} className="relative select-none" style={{ height: H }}>
          {W > 0 && (
            <svg
              width={W}
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label="Clientes en el tiempo"
              // `pan-y`: el dedo en vertical sigue desplazando la página; en horizontal
              // recorre los días.
              style={{ touchAction: "pan-y" }}
              onPointerDown={(e) => {
                if (e.pointerType === "mouse") return;
                setTactil(true);
                arrastrando.current = true;
                setSobre(indiceDe(e.clientX, e.currentTarget.getBoundingClientRect()));
              }}
              onPointerMove={(e) => {
                if (e.pointerType !== "mouse" && !arrastrando.current) return;
                setSobre(indiceDe(e.clientX, e.currentTarget.getBoundingClientRect()));
              }}
              onPointerUp={() => { arrastrando.current = false; }}
              onPointerCancel={() => { arrastrando.current = false; }}
              onPointerLeave={(e) => { if (e.pointerType === "mouse") setSobre(null); }}
            >
              <defs>
                <linearGradient id="activos-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} className="stroke-border-subtle" strokeWidth={1} />
                  <text x={padL - 8} y={yAt(t) + 4} textAnchor="end" className="fill-text-tertiary" fontSize={11}>{num(t)}</text>
                </g>
              ))}
              {rotulos.map((r) => (
                <g key={r.i}>
                  {r.cambioDeMes && (
                    <line x1={xAt(r.i)} x2={xAt(r.i)} y1={padT} y2={padT + innerH} className="stroke-border-subtle" strokeWidth={1} strokeDasharray="3 4" />
                  )}
                  <text
                    x={xAt(r.i)} y={H - 7} fontSize={11}
                    // Los extremos se anclan hacia dentro: centrados se salen del lienzo.
                    textAnchor={n > 1 && r.i === 0 ? "start" : n > 1 && r.i === n - 1 ? "end" : "middle"}
                    className={sobre === r.i ? "fill-text-primary font-semibold" : "fill-text-tertiary"}
                  >{r.texto}</text>
                </g>
              ))}

              {n > 1 && (
                <path
                  d={`${linea} L${xAt(n - 1)},${padT + innerH} L${xAt(0)},${padT + innerH} Z`}
                  fill="url(#activos-area)"
                  style={{ opacity: lista ? 1 : 0, transition: lista ? "opacity 900ms ease-out 250ms" : "none" }}
                />
              )}
              <path
                d={linea} fill="none" stroke={COLOR} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round"
                pathLength={1} strokeDasharray={1}
                style={{ strokeDashoffset: lista ? 0 : 1, transition: lista ? "stroke-dashoffset 900ms ease-out" : "none" }}
              />

              {/* Por mes son pocos puntos: cada uno lleva su marca y su cifra. */}
              {porMes && puntos.map((pt, i) => (
                <g key={pt.fecha} style={{ opacity: lista ? 1 : 0, transition: lista ? `opacity 300ms ease-out ${300 + i * 120}ms` : "none" }}>
                  <circle cx={xAt(i)} cy={yAt(pt.valor)} r={4} fill={COLOR} stroke="var(--color-surface)" strokeWidth={2} />
                  <text
                    x={xAt(i)} y={yAt(pt.valor) - 10} fontSize={11} fontWeight={600} className="fill-text-primary"
                    textAnchor={n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"}
                  >{num(pt.valor)}</text>
                </g>
              ))}
              {/* Por día, sólo hoy: dónde termina la línea. */}
              {!porMes && n > 0 && lista && sobre == null && (
                <circle cx={xAt(n - 1)} cy={yAt(puntos[n - 1].valor)} r={3.5} fill={COLOR} />
              )}

              {sobre != null && p && (
                <g pointerEvents="none">
                  <line x1={xAt(sobre)} x2={xAt(sobre)} y1={padT} y2={padT + innerH} className="stroke-border-strong" strokeWidth={1} />
                  <circle cx={xAt(sobre)} cy={yAt(p.valor)} r={5} fill={COLOR} stroke="var(--color-surface)" strokeWidth={2} />
                </g>
              )}
            </svg>
          )}

          {!tactil && sobre != null && p && (
            <div
              className="pointer-events-none absolute top-2 z-10 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[12px] shadow-lg"
              style={{ left: izqRecuadro, width: ANCHO_RECUADRO }}
            >
              {detalle}
            </div>
          )}
        </div>

        {/* Franja del punto elegido con el dedo */}
        {tactil && p ? (
          <div className="mt-2 rounded-xl border border-border-subtle bg-surface-2 p-3 text-[13px]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <button type="button" onClick={() => mover(-1)} disabled={sobre === 0} aria-label="Anterior"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-surface disabled:opacity-40">
                <Icon name="chevron-left" size={16} />
              </button>
              <div className="min-w-0 flex-1">{detalle}</div>
              <button type="button" onClick={() => mover(1)} disabled={sobre === n - 1} aria-label="Siguiente"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-surface disabled:opacity-40">
                <Icon name="chevron-right" size={16} />
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-1 text-center text-[11px] text-text-tertiary sm:hidden">
            Toca un punto (o desliza el dedo de lado) para ver su cifra
          </div>
        )}
      </div>

      <p className="text-[11px] text-text-tertiary">
        Cada mes cerrado es la cifra de su último día; el mes en curso es la de hoy. De esta combinación
        de estado y sede hay registro diario desde el {fechaLarga(data.desde)}; antes de esa fecha no se medía.
      </p>
    </div>
  );
}
