"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type Tajada = { key: string; label: string; value: number; cls: string; href?: string };

/**
 * Dona con leyenda enlazada: pasar por una tajada (o por su fila de la leyenda) la
 * resalta y el centro pasa a decir su cifra y su porcentaje; si trae `href`, pulsarla
 * abre el listado de esos clientes. Las tajadas crecen al cargar y al cambiar de sede.
 */
export function DonaInteractiva({
  tajadas,
  centro,
  centroLabel,
  fmt,
  size = 148,
}: {
  tajadas: Tajada[];
  centro: string;
  centroLabel: string;
  fmt: (n: number) => string;
  size?: number;
}) {
  const router = useRouter();
  const [sobre, setSobre] = useState<string | null>(null);
  // Arranca vacía y se llena en el primer cuadro, para que se vea crecer.
  const [lista, setLista] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setLista(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const total = tajadas.reduce((s, x) => s + x.value, 0) || 1;
  const activa = tajadas.find((t) => t.key === sobre) ?? null;
  let acc = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90">
          <circle cx="21" cy="21" r="15.915" fill="none" className="text-surface-2" stroke="currentColor" strokeWidth="4.5" />
          {tajadas.map((t) => {
            const pct = lista ? (t.value / total) * 100 : 0;
            const offset = -acc;
            acc += pct;
            const tenue = sobre != null && sobre !== t.key;
            const circulo = (
              <circle
                cx="21" cy="21" r="15.915" fill="none" stroke="currentColor"
                className={`${t.cls} transition-all duration-700 ease-out ${tenue ? "opacity-30" : ""} ${t.href ? "cursor-pointer" : ""}`}
                strokeWidth={sobre === t.key ? 6 : 4.5}
                strokeDasharray={`${pct} ${100 - pct}`}
                strokeDashoffset={offset}
                onPointerEnter={() => setSobre(t.key)}
                onPointerLeave={() => setSobre(null)}
                onClick={t.href ? () => router.push(t.href!) : undefined}
              />
            );
            // Dentro del SVG no va un <Link> (sería un <a> de SVG
            // ): la tajada navega con
            // el router y la leyenda de al lado, que sí es un enlace, cubre el teclado.
            return <g key={t.key}>{circulo}</g>;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {/* Una cifra exacta en pesos ("$ 1.234.567.890") no cabe a 19 px en el hueco. */}
          {(() => {
            const txt = activa ? fmt(activa.value) : centro;
            const tam = txt.length > 13 ? "text-[12px]" : txt.length > 9 ? "text-[14px]" : "text-[19px]";
            return <span className={`${tam} font-bold leading-none text-text-primary`}>{txt}</span>;
          })()}
          <span className="mt-0.5 text-[10px] text-text-tertiary">
            {activa ? `${activa.label} · ${((activa.value / total) * 100).toFixed(1)}%` : centroLabel}
          </span>
        </div>
      </div>
      <div className="flex w-full flex-1 flex-col justify-center gap-0.5">
        {tajadas.map((t) => {
          const cuerpo = (
            <>
              <span className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-sm ${t.cls.replace("text-", "bg-")}`} />
                <span className="text-text-secondary">{t.label}</span>
              </span>
              <span className="flex items-baseline gap-2">
                <span className="text-[10px] text-text-tertiary">{((t.value / total) * 100).toFixed(0)}%</span>
                <span className="font-semibold text-text-primary">{fmt(t.value)}</span>
              </span>
            </>
          );
          const cls = `flex items-center justify-between gap-3 rounded-md px-1.5 py-1 text-[12px] transition-colors ${sobre === t.key ? "bg-surface-2" : ""}`;
          const eventos = { onPointerEnter: () => setSobre(t.key), onPointerLeave: () => setSobre(null) };
          return t.href
            ? <Link key={t.key} href={t.href} className={`${cls} hover:text-brand`} {...eventos}>{cuerpo}</Link>
            : <div key={t.key} className={cls} {...eventos}>{cuerpo}</div>;
        })}
      </div>
    </div>
  );
}
