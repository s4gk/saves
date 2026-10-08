import { ChartCard, DonutChart, HBarList, TrendStat } from "@/components/charts";
import { DataTable } from "@/components/ui/DataTable";
import { Icon } from "@/components/Icon";
import { nfmt } from "@/lib/reportes";
import { fmtFechaCon } from "@/lib/format";
import { Section } from "./Section";
import { OrdenesRevisiones } from "./OrdenesRevisiones";

/**
 * Órdenes de servicio SIN cortes ni reconexiones (las abre en lote la cartera y
 * tapaban todo lo demás: 4.253 de 5.297 en septiembre). Arriba, cómo va la empresa de
 * un mes a otro; abajo, el reparto del periodo elegido.
 */

type Mes = {
  mes: string; creadas: number; resueltas: number; anuladas: number; abiertas: number;
  reclamos: number; instalaciones: number; diasPromedio: number | null; pctEnDosDias: number | null; enCurso: boolean;
};

const nombreMes = (mes: string, opts: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" }) =>
  fmtFechaCon(`${mes}-01`, opts);

/**
 * Cambio frente al mes anterior, pintado según lo que significa MEJORAR: más
 * resueltas en 2 días es bueno, más reclamos o más días para resolver es malo.
 * `neutro` = subir o bajar no es ni bueno ni malo (el volumen de órdenes).
 */
function Cambio({ antes, ahora, mejor, unidad = "", neutro = false }: {
  antes: number | null | undefined; ahora: number | null | undefined; mejor?: "sube" | "baja"; unidad?: string; neutro?: boolean;
}) {
  if (antes == null || ahora == null) return null;
  const d = Math.round((ahora - antes) * 10) / 10;
  if (d === 0) return <span className="text-[11px] text-text-tertiary">= igual</span>;
  const bueno = neutro ? null : (d > 0) === (mejor === "sube");
  const color = bueno == null ? "text-text-tertiary" : bueno ? "text-success-text" : "text-error-text";
  const txt = unidad === "%" ? `${Math.abs(d).toLocaleString("es-CO")} pts`
    : unidad ? `${Math.abs(d).toLocaleString("es-CO")} ${unidad}`
    : nfmt(Math.abs(d));
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${color}`}>
      <Icon name={d > 0 ? "arrow-up" : "arrow-down"} size={11} />{txt}
    </span>
  );
}

const dias = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("es-CO", { maximumFractionDigits: 1 })} d`);
const pct = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("es-CO")}%`);

export function Ordenes({ data }: { data: any }) {
  const porEstado = data.porEstado ?? [];
  const porTipo = data.porTipo ?? [];
  const porTecnico = data.porTecnico ?? [];
  const total = porEstado.reduce((s: number, r: any) => s + (r.count ?? 0), 0);
  const meses: Mes[] = data.mesAMes ?? [];

  // La comparación de cabecera usa el último mes CERRADO: el mes en curso tiene
  // órdenes lentas sin cerrar y su promedio saldría mejor de lo que va a terminar.
  const cerrados = meses.filter((m) => !m.enCurso);
  const ult = cerrados[cerrados.length - 1];
  const ant = cerrados[cerrados.length - 2];
  const serie = (k: keyof Mes) => cerrados.map((m) => Number(m[k] ?? 0));
  const vs = ult && ant ? `${nombreMes(ult.mes, { month: "long" })} vs ${nombreMes(ant.mes, { month: "long" })}` : "";

  return (
    <>
      {ult && (
        <Section title={`Cómo vamos · ${nombreMes(ult.mes)}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <TrendStat label="Órdenes creadas" value={nfmt(ult.creadas)} icon="layers" spark={serie("creadas")}
              deltaLabel={ant ? `${vs}: ${ult.creadas >= ant.creadas ? "+" : "−"}${nfmt(Math.abs(ult.creadas - ant.creadas))}` : undefined} />
            <TrendStat label="Reclamos (fallas reportadas)" value={nfmt(ult.reclamos)} icon="alert-triangle" tone="error" spark={serie("reclamos")}
              deltaLabel={ant ? `${vs}: ${ult.reclamos >= ant.reclamos ? "+" : "−"}${nfmt(Math.abs(ult.reclamos - ant.reclamos))} · menos es mejor` : undefined} />
            <TrendStat label="Días promedio para resolver" value={dias(ult.diasPromedio)} icon="hourglass" tone="warning" spark={serie("diasPromedio")}
              deltaLabel={ant ? `${vs}: antes ${dias(ant.diasPromedio)} · menos es mejor` : undefined} />
            <TrendStat label="Resueltas en 2 días o menos" value={pct(ult.pctEnDosDias)} icon="clipboard-check" tone="success" spark={serie("pctEnDosDias")}
              deltaLabel={ant ? `${vs}: antes ${pct(ant.pctEnDosDias)} · más es mejor` : undefined} />
          </div>
        </Section>
      )}

      {meses.length > 0 && (
        <ChartCard title="Mes a mes" subtitle="Últimos 12 meses por mes de creación, sin cortes ni reconexiones. La flecha compara con el mes anterior." icon="calendar-range">
          <DataTable rows={[...meses].reverse()} empty="Sin órdenes." columns={[
            { key: "mes", header: "Mes", render: (m: Mes) => (
              <span className="font-medium text-text-primary">
                {nombreMes(m.mes)}{m.enCurso && <span className="ml-1 text-[11px] font-normal text-text-tertiary">(en curso)</span>}
              </span>
            ) },
            ...([
              ["creadas", "Creadas", undefined, true],
              ["reclamos", "Reclamos", "baja", false],
              ["instalaciones", "Instalaciones", "sube", false],
            ] as const).map(([k, h, mejor, neutro]) => ({
              key: k, header: h, align: "right" as const,
              render: (m: Mes) => {
                const prev = meses[meses.indexOf(m) - 1];
                return (
                  <span className="flex flex-col items-end">
                    <span className="font-semibold">{nfmt(m[k])}</span>
                    <Cambio antes={prev?.[k]} ahora={m[k]} mejor={mejor} neutro={neutro} />
                  </span>
                );
              },
            })),
            { key: "diasPromedio", header: "Días para resolver", align: "right", render: (m: Mes) => {
              const prev = meses[meses.indexOf(m) - 1];
              return (
                <span className="flex flex-col items-end">
                  <span className="font-semibold">{dias(m.diasPromedio)}</span>
                  <Cambio antes={prev?.diasPromedio} ahora={m.diasPromedio} mejor="baja" unidad="d" />
                </span>
              );
            } },
            { key: "pctEnDosDias", header: "En ≤ 2 días", align: "right", render: (m: Mes) => {
              const prev = meses[meses.indexOf(m) - 1];
              return (
                <span className="flex flex-col items-end">
                  <span className="font-semibold">{pct(m.pctEnDosDias)}</span>
                  <Cambio antes={prev?.pctEnDosDias} ahora={m.pctEnDosDias} mejor="sube" unidad="%" />
                </span>
              );
            } },
            { key: "abiertas", header: "Sin cerrar", align: "right", render: (m: Mes) => (m.abiertas ? nfmt(m.abiertas) : <span className="text-text-tertiary">0</span>) },
            { key: "anuladas", header: "Anuladas", align: "right", render: (m: Mes) => (m.anuladas ? nfmt(m.anuladas) : <span className="text-text-tertiary">0</span>) },
          ]} />
        </ChartCard>
      )}

      <ChartCard title="Órdenes por estado"
        subtitle={`${nfmt(total)} órdenes en el periodo${data.excluidas ? ` · sin contar ${nfmt(data.excluidas)} cortes y reconexiones` : ""}`} icon="layers">
        <DonutChart centerLabel="órdenes" centerValue={nfmt(total)} data={porEstado.map((r: any) => ({ label: r.estado, value: r.count }))} />
      </ChartCard>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Por tipo de orden" subtitle="Motivos más frecuentes" icon="list">
          <HBarList rows={porTipo.map((r: any) => ({ label: r.tipo, value: r.count }))} />
        </ChartCard>
        <ChartCard title="Carga por técnico" subtitle="Órdenes asignadas" icon="users">
          <HBarList monochrome rows={porTecnico.map((r: any) => ({ label: r.tecnico, value: r.count }))} />
        </ChartCard>
      </div>

      {/* Dos de cada tres órdenes son una revisión; su detalle va aquí. */}
      <OrdenesRevisiones rev={data.revisiones} />

      <ul className="flex list-disc flex-col gap-1 pl-5 text-[12px] text-text-secondary">
        <li>No se cuentan las órdenes de corte ni de reconexión (internet, TV y combo): están en el reporte de Cortes y activaciones.</li>
        <li>«Reclamos» son las órdenes que abre un cliente porque algo no funciona (revisión de internet, de TV…). Que bajen es buena señal.</li>
        <li>«Días para resolver» va del día en que se creó la orden al día en que se cerró; 0 es el mismo día. Del mes en curso aún faltan por cerrar las más lentas, por eso la cabecera compara el último mes completo.</li>
      </ul>
    </>
  );
}
