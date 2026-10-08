"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChartCard, AreaLineChart, TrendStat } from "@/components/charts";
import { DataTable } from "@/components/ui/DataTable";
import { PagedTable } from "@/components/ui/PagedTable";
import { Segmented } from "@/components/ui/Segmented";
import { Badge } from "@/components/ui/Badge";
import { nfmt } from "@/lib/reportes";
import { fmtDate, fmtFechaCon } from "@/lib/format";
import { Section } from "./Section";

/**
 * Cortes y activaciones, contados desde las ÓRDENES resueltas y comprobados en el
 * router. El cálculo y sus reglas viven en `backend/src/reports/cortes-activaciones.ts`;
 * aquí sólo se pinta. Las notas de lectura también llegan del backend, para que la
 * pantalla, el PDF y el chatbot expliquen las cifras con las mismas palabras.
 */

const TARJETAS: { evento: string; icon: string; tone: "error" | "success" | "warning" | "default" }[] = [
  { evento: "CORTE", icon: "wifi-off", tone: "error" },
  { evento: "RECONEXION", icon: "zap", tone: "success" },
  { evento: "SUSPENSION", icon: "history", tone: "warning" },
  { evento: "RETIRO", icon: "log-out", tone: "default" },
  { evento: "INSTALACION", icon: "user-plus", tone: "default" },
];

const COLOR: Record<string, string> = {
  CORTE: "var(--color-error)",
  RECONEXION: "var(--color-success)",
  SUSPENSION: "var(--color-warning)",
  RETIRO: "var(--color-text-tertiary)",
  INSTALACION: "var(--color-info-text)",
};

const ACCION: Record<string, string> = {
  CUT: "Corte", MOROSO_ON: "Pasado a MOROSOS", RECONNECT: "Reconexión", MOROSO_OFF: "Sacado de MOROSOS",
};

/** "1.107 sí · 64 sin registro", o "—" donde el router no puede opinar. */
function Router({ con, sin }: { con: number | null; sin: number | null }) {
  if (con == null) return <span className="text-text-tertiary" title="El router sólo confirma internet">—</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="text-success-text">{nfmt(con)} sí</span>
      {sin ? <span className="text-text-tertiary"> · {nfmt(sin)} sin registro</span> : null}
    </span>
  );
}

export function CortesActivaciones({ data }: { data: any }) {
  const resumen: any[] = data.resumen ?? [];
  const filas: any[] = data.filas ?? [];
  const porDia: any[] = data.porDia ?? [];
  const detalle: any[] = data.detalle ?? [];
  const sinOrden = data.routerSinOrden ?? { cortes: 0, reconexiones: 0, porDia: [] };
  const etiqueta = (e: string) => resumen.find((r) => r.evento === e)?.label ?? e;

  const [evento, setEvento] = useState<string>("TODOS");
  const [servicio, setServicio] = useState<string>("TODOS");
  const [router, setRouter] = useState<string>("TODOS");
  const [q, setQ] = useState("");
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return detalle.filter((d) =>
      (evento === "TODOS" || d.evento === evento) &&
      (servicio === "TODOS" || d.servicio === servicio) &&
      (router === "TODOS" || (router === "SI" ? d.router === true : d.router === false)) &&
      (!t || String(d.abonado).includes(t) || (d.nombre ?? "").toLowerCase().includes(t) || String(d.orden ?? "").includes(t)));
  }, [detalle, evento, servicio, router, q]);

  return (
    <>
      <Section>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {TARJETAS.map(({ evento: e, icon, tone }) => {
            const r = resumen.find((x) => x.evento === e);
            return (
              <TrendStat key={e} label={etiqueta(e)} value={nfmt(r?.hechos ?? 0)} icon={icon} tone={tone}
                hint={`${nfmt(r?.clientes ?? 0)} clientes`} />
            );
          })}
        </div>
      </Section>

      <ChartCard title="Por servicio" subtitle="Órdenes resueltas en el periodo, por el día en que se cerraron" icon="list-tree">
        <DataTable rows={filas} empty="No hubo cortes ni reconexiones en este periodo." columns={[
          { key: "evento", header: "Evento", render: (f: any) => <span className="font-medium text-text-primary">{etiqueta(f.evento)}</span>,
            sortValue: (f: any) => resumen.findIndex((r) => r.evento === f.evento) },
          { key: "servicio", header: "Servicio", render: (f: any) => (f.servicio === "General" ? "—" : f.servicio) },
          { key: "hechos", header: "Órdenes", align: "right", render: (f: any) => <span className="font-semibold">{nfmt(f.hechos)}</span> },
          { key: "clientes", header: "Clientes", align: "right", render: (f: any) => nfmt(f.clientes) },
          { key: "conRouter", header: "Registro en el router", align: "right", render: (f: any) => <Router con={f.conRouter} sin={f.sinRouter} /> },
          { key: "anuladas", header: "Anuladas", align: "right", render: (f: any) => (f.anuladas ? nfmt(f.anuladas) : <span className="text-text-tertiary">0</span>) },
          { key: "abiertas", header: "Sin cerrar", align: "right", render: (f: any) => (f.abiertas ? nfmt(f.abiertas) : <span className="text-text-tertiary">0</span>) },
        ]} />
      </ChartCard>

      {porDia.length > 1 && (
        <ChartCard title="Día a día" subtitle="Cortes y reconexiones cerrados cada día" icon="activity"
          action={
            <span className="flex gap-3 text-[11px]">
              {["CORTE", "RECONEXION"].map((e) => (
                <span key={e} className="flex items-center gap-1"><span className="h-[3px] w-4 rounded-full" style={{ background: COLOR[e] }} /> {etiqueta(e)}</span>
              ))}
            </span>
          }>
          <AreaLineChart smooth={false} area={false} yFormat={(n) => nfmt(n)}
            labels={porDia.map((d) => fmtFechaCon(d.fecha, { day: "numeric", month: "short" }))}
            series={["CORTE", "RECONEXION"].map((e) => ({ name: etiqueta(e), color: COLOR[e], points: porDia.map((d) => d[e] ?? 0) }))} />
        </ChartCard>
      )}

      {sinOrden.porDia?.length > 0 && (
        <ChartCard title="En el router sin orden"
          subtitle={`${nfmt(sinOrden.cortes)} cortes y ${nfmt(sinOrden.reconexiones)} reconexiones sin una orden de ese cliente ese día. No suman a los totales de arriba.`}
          icon="router">
          <DataTable rows={sinOrden.porDia} empty="—" columns={[
            { key: "fecha", header: "Día", render: (r: any) => fmtDate(r.fecha) },
            { key: "accion", header: "Acción", render: (r: any) => ACCION[r.accion] ?? r.accion },
            { key: "acciones", header: "Acciones", align: "right", render: (r: any) => <span className="font-semibold">{nfmt(r.acciones)}</span> },
            { key: "clientes", header: "Clientes", align: "right", render: (r: any) => nfmt(r.clientes) },
          ]} />
        </ChartCard>
      )}

      <ChartCard title="Cliente por cliente"
        subtitle={data.detalleTotal > detalle.length
          ? `Se muestran ${nfmt(detalle.length)} de ${nfmt(data.detalleTotal)} eventos: acorta el periodo para verlos todos`
          : `${nfmt(visibles.length)} de ${nfmt(detalle.length)} eventos`}
        icon="users">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmented ariaLabel="Evento" value={evento} onChange={setEvento}
            options={[{ value: "TODOS", label: "Todos" }, ...resumen.filter((r) => r.hechos).map((r) => ({ value: r.evento, label: r.label }))]} />
          <Segmented ariaLabel="Servicio" value={servicio} onChange={setServicio}
            options={[{ value: "TODOS", label: "Todo servicio" }, { value: "Internet", label: "Internet" }, { value: "TV", label: "TV" }, { value: "Combo", label: "Combo" }]} />
          <Segmented ariaLabel="Router" value={router} onChange={setRouter}
            options={[{ value: "TODOS", label: "Router: todo" }, { value: "SI", label: "Con registro" }, { value: "NO", label: "Sin registro" }]} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Abonado, nombre u orden"
            className="h-8 w-full rounded-lg border border-border-subtle bg-surface px-2.5 text-[12px] sm:w-56" />
        </div>
        <PagedTable rows={visibles} defaultPageSize={50} empty="Ningún evento con esos filtros." columns={[
          { key: "fecha", header: "Cierre", render: (d: any) => fmtDate(d.fecha) },
          { key: "cliente", header: "Cliente", sortValue: (d: any) => d.abonado, render: (d: any) => (
            <Link href={`/clientes/${d.clienteId}`} className="text-brand hover:underline">
              {d.nombre ?? "Sin nombre"} <span className="text-text-tertiary">· {d.abonado}</span>
            </Link>
          ) },
          { key: "sede", header: "Sede", render: (d: any) => d.sede ?? "—" },
          { key: "evento", header: "Evento", render: (d: any) => (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR[d.evento] }} />
              {etiqueta(d.evento)}{d.servicio !== "General" && <span className="text-text-tertiary">· {d.servicio}</span>}
            </span>
          ) },
          { key: "orden", header: "Orden", render: (d: any) => (d.orden ? `#${d.orden}` : <span className="text-text-tertiary" title={d.tipo}>sin orden</span>) },
          { key: "router", header: "Router", sortValue: (d: any) => (d.router == null ? 2 : d.router ? 0 : 1), render: (d: any) =>
            d.router == null ? <span className="text-text-tertiary">—</span>
              : d.router ? <Badge label="Registrado" tone="success" /> : <Badge label="Sin registro" tone="warning" /> },
        ]} />
      </ChartCard>

      {(data.notas ?? []).length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[12px] text-text-secondary">
          {data.notas.map((n: string) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </>
  );
}
