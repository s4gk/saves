"use client";

import { useEffect, useRef, useState } from "react";
import { useChartWidth } from "@/components/charts/useChartWidth";
import { niceMax } from "@/components/charts/helpers";
import { cop } from "@/lib/subscribers";
import { Icon } from "@/components/Icon";

/**
 * `income` es TODO el recaudo; `wompi` y `bancos` son parte de él. La línea verde es
 * el efectivo (lo cobrado en las cajas de las sedes) = income − wompi − bancos, para
 * que las tres líneas sean los tres canales de «Recaudo por canal».
 */
export type PuntoFlujo = { month: string; income: number; expense: number; wompi?: number; bancos?: number };

/** Los mismos colores que la tarjeta «Recaudo por canal». */
/** Efectivo en verde, egresos en rojo, bancos en amarillo (pedido del usuario, 2026-09-28). */
export const COLOR_INGRESOS = "var(--color-success)";
export const COLOR_WOMPI = "var(--color-info-text)";
export const COLOR_BANCOS = "var(--color-warning)";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** 'YYYY-MM-DD' → "26 sep"; 'YYYY-MM' → "sep 26". */
export function etiquetaPunto(clave: string, larga = false): string {
  const [y, m, d] = (clave || "-").split("-");
  const mes = MESES[Number(m) - 1] ?? m;
  if (d) return larga ? `${Number(d)} de ${mes} ${y}` : `${Number(d)} ${mes}`;
  return larga ? `${mes} ${y}` : `${mes} ${(y || "").slice(2)}`;
}

/**
 * Recaudo contra egresos, con lectura al pasar el ratón (o el dedo): una guía vertical
 * y un recuadro con lo que entró, lo que salió y el neto de ese día. Pulsar un punto
 * lo abre en Tesorería (`onElegir`).
 *
 * `verWompi`/`verBancos` añaden dos líneas con lo que de ese ingreso entró por Wompi y
 * por los bancos (lo demás es ventanilla).
 *
 * `acumulado` pinta la suma corrida en vez del valor de cada día: es como se lee
 * "¿cómo va el mes?" — una línea que sube hasta el total en vez de dientes de sierra.
 */
export function FlujoCaja({
  serie,
  acumulado,
  verEgresos,
  verWompi = false,
  verBancos = false,
  onElegir,
}: {
  serie: PuntoFlujo[];
  acumulado: boolean;
  verEgresos: boolean;
  verWompi?: boolean;
  verBancos?: boolean;
  onElegir?: (p: PuntoFlujo) => void;
}) {
  const { ref, width: W } = useChartWidth();
  const [sobre, setSobre] = useState<number | null>(null);
  // Con el dedo no hay "pasar por encima": tocar un día lo SELECCIONA (y se queda), y
  // sus cifras salen en una franja fija bajo la gráfica en vez de en el recuadro
  // flotante, que en una pantalla de 360 px taparía media gráfica. Con ratón sigue
  // siendo el recuadro que sigue al cursor y el clic abre Tesorería.
  const [tactil, setTactil] = useState(false);
  const arrastrando = useRef(false);
  const H = 250;

  // Tocar fuera de la gráfica suelta el día elegido.
  useEffect(() => {
    if (!tactil || sobre == null) return;
    const fuera = (e: PointerEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) setSobre(null);
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [tactil, sobre, ref]);

  if (!serie.length) {
    return <div className="flex h-56 items-center justify-center text-[12px] text-text-tertiary">Sin movimientos en el periodo</div>;
  }

  let ai = 0;
  let ae = 0;
  let aw = 0;
  let ab = 0;
  const puntos = serie.map((p) => {
    ai += p.income;
    ae += p.expense;
    aw += p.wompi ?? 0;
    ab += p.bancos ?? 0;
    const q = acumulado ? { ...p, income: ai, expense: ae, wompi: aw, bancos: ab } : { ...p, wompi: p.wompi ?? 0, bancos: p.bancos ?? 0 };
    return { ...q, efectivo: q.income - q.wompi - q.bancos };
  });

    const max = niceMax(Math.max(1, ...puntos.map((p) => Math.max(p.efectivo, verWompi ? p.wompi : 0, verBancos ? p.bancos : 0, verEgresos ? p.expense : 0))));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  // Eje en pesos exactos, sin "M" ni "K" (pedido del usuario, 2026-09-28). Sin el tope
  // de 90 px de `padEjeY`: "$ 400.000.000" lo pasa y el signo quedaría cortado.
  const padL = Math.ceil(Math.max(...ticks.map((t) => cop(t).length)) * 11 * 0.58) + 14;
  const padR = 12;
  const padT = 10;
  const padB = 24;
  const innerW = Math.max(W - padL - padR, 1);
  const innerH = H - padT - padB;
  const n = puntos.length;
  const xAt = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => padT + innerH - (v / max) * innerH;
  const linea = (k: "efectivo" | "expense" | "wompi" | "bancos") => puntos.map((p, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(p[k]).toFixed(1)}`).join(" ");

  // Por día se rotulan TODOS los días (pedido del usuario, 2026-09-26) con sólo el
  // número, que cabe en ~16 px; el mes ya lo dice el subtítulo. Sólo si no caben (un
  // móvil, o un rango de más de un mes) se salta uno de cada dos, o los que haga falta.
  // Por mes, "sep 26" pide ~54 px por rótulo.
  const porDia = (puntos[0]?.month.length ?? 0) > 7;
  const paso = Math.ceil(n / Math.max(2, Math.floor(innerW / (porDia ? 16 : 54))));
  // El día elegido siempre lleva su número; si hubo que saltar rótulos, se callan sus
  // vecinos para que no se pisen con él.
  const rotuloVisible = (i: number) => {
    if (i === sobre) return true;
    if (sobre != null && paso > 1 && Math.abs(i - sobre) < paso) return false;
    return i % paso === 0 || (i === n - 1 && paso === 1);
  };
  const rotulo = (clave: string) => (porDia ? String(Number(clave.slice(8, 10))) : etiquetaPunto(clave));

  const indiceDe = (clientX: number, rect: DOMRect) => {
    const x = clientX - rect.left - padL;
    return Math.min(n - 1, Math.max(0, Math.round(n <= 1 ? 0 : (x / innerW) * (n - 1))));
  };

  const p = sobre != null ? puntos[sobre] : null;
  const crudo = sobre != null ? serie[sobre] : null;
  // El recuadro va al lado contrario del cursor para no taparlo, y nunca se sale de
  // la tarjeta (~230 px de ancho: montos exactos).
  const ANCHO_RECUADRO = 230;
  const izqRecuadro = sobre == null ? 0 : Math.max(0, Math.min(W - ANCHO_RECUADRO,
    xAt(sobre) > W / 2 ? xAt(sobre) - 12 - ANCHO_RECUADRO : xAt(sobre) + 12));
  const mover = (d: number) => setSobre((i) => Math.min(n - 1, Math.max(0, (i ?? n - 1) + d)));

  return (
    <div>
    <div ref={ref} className="relative select-none" style={{ height: H }}>
      {W > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Efectivo, Wompi, bancos y egresos del periodo"
          className={onElegir ? "cursor-pointer" : undefined}
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
          onClick={(e) => {
            // Con el dedo el toque ya eligió el día; navegar es el botón de la franja.
            if (tactil) return;
            onElegir?.(serie[indiceDe(e.clientX, e.currentTarget.getBoundingClientRect())]);
          }}
        >
          <defs>
            <linearGradient id="flujo-ingresos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLOR_INGRESOS} stopOpacity={0.26} />
              <stop offset="100%" stopColor={COLOR_INGRESOS} stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} className="stroke-border-subtle" strokeWidth={1} />
              <text x={padL - 8} y={yAt(t) + 4} textAnchor="end" className="fill-text-tertiary" fontSize={11}>{cop(t)}</text>
            </g>
          ))}
          {puntos.map((pt, i) => rotuloVisible(i) && (
            <text key={pt.month} x={xAt(i)} y={H - 7} textAnchor="middle" fontSize={porDia ? 10 : 11}
              className={sobre === i ? "fill-text-primary font-semibold" : "fill-text-tertiary"}>{rotulo(pt.month)}</text>
          ))}

          <path d={`${linea("efectivo")} L${xAt(n - 1)},${padT + innerH} L${xAt(0)},${padT + innerH} Z`} fill="url(#flujo-ingresos)" className="transition-opacity duration-500" />
          <path d={linea("efectivo")} fill="none" stroke={COLOR_INGRESOS} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
          {verWompi && (
            <path d={linea("wompi")} fill="none" stroke={COLOR_WOMPI} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {verBancos && (
            <path d={linea("bancos")} fill="none" stroke={COLOR_BANCOS} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {verEgresos && (
            <path d={linea("expense")} fill="none" stroke="var(--color-error)" strokeWidth={1.75} strokeDasharray="5 4" strokeLinejoin="round" />
          )}

          {sobre != null && p && (
            <g pointerEvents="none">
              <line x1={xAt(sobre)} x2={xAt(sobre)} y1={padT} y2={padT + innerH} className="stroke-border-strong" strokeWidth={1} />
              <circle cx={xAt(sobre)} cy={yAt(p.efectivo)} r={4.5} fill={COLOR_INGRESOS} stroke="var(--color-surface)" strokeWidth={2} />
              {verWompi && <circle cx={xAt(sobre)} cy={yAt(p.wompi ?? 0)} r={3.5} fill={COLOR_WOMPI} stroke="var(--color-surface)" strokeWidth={2} />}
              {verBancos && <circle cx={xAt(sobre)} cy={yAt(p.bancos ?? 0)} r={3.5} fill={COLOR_BANCOS} stroke="var(--color-surface)" strokeWidth={2} />}
              {verEgresos && <circle cx={xAt(sobre)} cy={yAt(p.expense)} r={4} fill="var(--color-error)" stroke="var(--color-surface)" strokeWidth={2} />}
            </g>
          )}
        </svg>
      )}

      {!tactil && sobre != null && p && crudo && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[12px] shadow-lg"
          style={{ left: izqRecuadro, width: ANCHO_RECUADRO }}
        >
          <div className="mb-1 font-semibold text-text-primary">{etiquetaPunto(p.month, true)}</div>
          <Canales crudo={crudo} />
          {verEgresos && <Fila color="bg-error" label="Egresos" valor={crudo.expense} />}
          <div className="mt-1 flex justify-between gap-4 border-t border-border-subtle pt-1">
            <span className="text-text-tertiary">Neto</span>
            <span className={`font-semibold ${crudo.income - crudo.expense < 0 ? "text-error-text" : "text-success-text"}`}>{cop(crudo.income - crudo.expense)}</span>
          </div>
          {acumulado && (
            <div className="mt-1 text-[11px] text-text-tertiary">Recaudo acumulado: {cop(p.income)}{verEgresos ? ` / egresos ${cop(p.expense)}` : ""}</div>
          )}
          {onElegir && <div className="mt-1 text-[10px] text-text-tertiary">Clic para ver los movimientos</div>}
        </div>
      )}
    </div>

      {/* Franja del día elegido con el dedo */}
      {tactil && p && crudo ? (
        <div className="mt-2 rounded-xl border border-border-subtle bg-surface-2 p-3 text-[13px]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <button type="button" onClick={() => mover(-1)} disabled={sobre === 0} aria-label="Día anterior"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-surface disabled:opacity-40">
              <Icon name="chevron-left" size={16} />
            </button>
            <div className="text-center font-semibold text-text-primary">{etiquetaPunto(p.month, true)}</div>
            <button type="button" onClick={() => mover(1)} disabled={sobre === n - 1} aria-label="Día siguiente"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-surface disabled:opacity-40">
              <Icon name="chevron-right" size={16} />
            </button>
          </div>
          <Canales crudo={crudo} />
          {verEgresos && <Fila color="bg-error" label="Egresos" valor={crudo.expense} />}
          <div className="mt-1 flex justify-between gap-4 border-t border-border-subtle pt-1">
            <span className="text-text-tertiary">Neto</span>
            <span className={`font-semibold ${crudo.income - crudo.expense < 0 ? "text-error-text" : "text-success-text"}`}>{cop(crudo.income - crudo.expense)}</span>
          </div>
          {acumulado && (
            <div className="mt-1 text-[11px] text-text-tertiary">Recaudo acumulado: {cop(p.income)}{verEgresos ? ` / egresos ${cop(p.expense)}` : ""}</div>
          )}
          {onElegir && (
            <button type="button" onClick={() => onElegir(crudo)}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-[12px] font-semibold text-white">
              Ver movimientos de este {p.month.length > 7 ? "día" : "mes"} <Icon name="arrow-right" size={14} />
            </button>
          )}
        </div>
      ) : (
        <div className="mt-1 text-center text-[11px] text-text-tertiary sm:hidden">Toca un día (o desliza el dedo de lado) para ver sus cifras</div>
      )}
    </div>
  );
}

/** Lo que entró ese día, canal por canal, y el total que suman. */
function Canales({ crudo }: { crudo: PuntoFlujo }) {
  const wompi = crudo.wompi ?? 0;
  const bancos = crudo.bancos ?? 0;
  return (
    <>
      <Fila color="bg-success" label="Efectivo" valor={crudo.income - wompi - bancos} />
      <Fila color="bg-info-text" label="Wompi" valor={wompi} />
      <Fila color="bg-warning" label="Bancos" valor={bancos} />
      <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-0.5">
        <span className="text-text-tertiary">Total recaudo</span>
        <span className="font-semibold text-text-primary">{cop(crudo.income)}</span>
      </div>
    </>
  );
}

function Fila({ color, label, valor }: { color: string; label: string; valor: number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-text-secondary"><span className={`h-2 w-2 rounded-full ${color}`} />{label}</span>
      <span className="font-semibold text-text-primary">{cop(valor)}</span>
    </div>
  );
}
