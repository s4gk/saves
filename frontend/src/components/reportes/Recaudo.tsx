import Link from "next/link";
import { ChartCard, DonutChart, HBarList, TrendStat, compactCOP } from "@/components/charts";
import { DataTable } from "@/components/ui/DataTable";
import { cop } from "@/lib/subscribers";
import { nfmt } from "@/lib/reportes";
import { Section } from "./Section";

/**
 * Enlace a los saldos a favor aplicados del periodo en Tesorería › Ingresos: son la fila
 * «Saldos a favor» del recaudo (ver `ReportsService.recaudo`), plata que ya entró por una caja
 * el día del adelanto. Tesorería sólo acepta el rango completo, así que un extremo vacío se cierra
 * con hoy o con una fecha que cubra todo el histórico.
 */
function hrefSaldosAplicados(from: string, to: string, sedeLegacy: number | null) {
  const qs = new URLSearchParams({ metodo: "Balance" });
  if (from || to) {
    qs.set("desde", from || "2000-01-01");
    qs.set("hasta", to || new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }));
  } else {
    qs.set("periodo", "anio");
  }
  if (sedeLegacy != null) qs.set("sede", String(sedeLegacy));
  return `/tesoreria/ingresos?${qs}`;
}

export function Recaudo({ data, from = "", to = "" }: { data: any; from?: string; to?: string }) {
  const saldos = data.saldosAplicados;
  return (
    <>
      <Section>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TrendStat label="Total recaudado" value={cop(data.total ?? 0)} icon="banknote" tone="success" hint={`${nfmt(data.count ?? 0)} movimientos`} />
          <TrendStat label="Cajas activas" value={nfmt((data.porCaja ?? []).length)} icon="wallet" hint="Con recaudo en el periodo" />
          <TrendStat label="Métodos de pago" value={nfmt((data.porMetodo ?? []).length)} icon="hand-coins" hint="Canales usados" />
        </div>
        {saldos?.count > 0 && (
          <p className="mt-3 text-sm text-text-secondary">
            «Saldos a favor» son {cop(saldos.total)} de sobrantes y adelantos aplicados a facturas ({nfmt(saldos.count)} movimientos): esa plata ya se contó en la caja por la que entró el adelanto.{" "}
            <Link href={hrefSaldosAplicados(from, to, saldos.sedeLegacy)} className="font-medium text-brand hover:underline">
              Ver saldos aplicados →
            </Link>
          </p>
        )}
      </Section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Recaudo por método" subtitle="Participación de cada canal de pago" icon="hand-coins">
          <DonutChart
            centerLabel="recaudado"
            centerValue={compactCOP(data.total ?? 0)}
            valueFormat={compactCOP}
            data={(data.porMetodo ?? []).map((r: any) => ({ label: r.metodo, value: r.total }))}
          />
        </ChartCard>
        <ChartCard title="Recaudo por caja" subtitle="Ranking de cajas por monto" icon="wallet">
          <HBarList
            valueFormat={compactCOP}
            rows={(data.porCaja ?? []).map((r: any) => ({ label: r.caja, value: r.total, hint: `${nfmt(r.count)} movimientos` }))}
          />
        </ChartCard>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Detalle por caja" icon="list-tree">
          <DataTable rows={data.porCaja ?? []} empty="Sin datos." columns={[
            { key: "caja", header: "Caja", render: (r: any) => r.caja },
            { key: "n", header: "Mov.", align: "right", render: (r: any) => nfmt(r.count) },
            { key: "t", header: "Total", align: "right", render: (r: any) => <span className="font-semibold">{cop(r.total)}</span> },
          ]} />
        </ChartCard>
        <ChartCard title="Detalle por método" icon="list-tree">
          <DataTable rows={data.porMetodo ?? []} empty="Sin datos." columns={[
            { key: "m", header: "Método", render: (r: any) => r.metodo },
            { key: "n", header: "Mov.", align: "right", render: (r: any) => nfmt(r.count) },
            { key: "t", header: "Total", align: "right", render: (r: any) => <span className="font-semibold">{cop(r.total)}</span> },
          ]} />
        </ChartCard>
      </div>
    </>
  );
}
