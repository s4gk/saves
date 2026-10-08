import Link from "next/link";
import { ChartCard, HBarList, TrendStat } from "@/components/charts";
import { DataTable } from "@/components/ui/DataTable";
import { Icon } from "@/components/Icon";
import { nfmt } from "@/lib/reportes";
import { fmtDate, fmtFechaCon } from "@/lib/format";
import { Section } from "./Section";

/**
 * El detalle de las REVISIONES, que son dos de cada tres órdenes (647 de las 1.001 de
 * septiembre). El reporte de arriba dice cuántas hubo; esto dice de qué son y dónde
 * están, que es lo único con lo que se puede hacer algo:
 *
 *   · «de qué» sale del texto del reclamo, así que es aproximado y la pantalla lo dice
 *   · «dónde» sale del barrio del abonado y de la caja NAP y la VLAN por donde entra
 *
 * La fila que de verdad importa es la última: el cliente al que se le fue el técnico
 * tres veces en el mes. Antes había que abrir ficha por ficha para encontrarlo.
 */

export type Revisiones = {
  total: number;
  sinBarrio: number;
  sinCaja: number;
  desde: string;
  hasta: string;
  porSintoma: { sintoma: string; total: number; internet: number; tv: number; combo: number }[];
  porBarrio: { barrio: string; sede: string | null; revisiones: number; clientes: number; abonados: number | null; por100: number | null }[];
  /** Revisiones por 100 abonados de toda la base medida: el "contra qué" de la columna. */
  por100Promedio: number | null;
  porCaja: { caja: string; vlan: number | null; detalle: string | null; sede: string | null; puertos: number | null; revisiones: number; clientes: number }[];
  porVlan: { vlan: number | null; detalle: string | null; olt: string | null; sede: string | null; revisiones: number; clientes: number }[];
  porTecnologia: { tecnologia: string; revisiones: number }[];
  reincidentes: { id: string; abonado: number; nombre: string | null; barrio: string; caja: string | null; sede: string | null; revisiones: number; sintomas: string | null; ultima: string }[];
};

/** Un decimal, con la coma de aquí. */
const num1 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });

/**
 * Entre cuántos clientes se reparten las revisiones de la fila. Es la mitad que
 * decide qué hacer: 20 revisiones de 20 clientes son 20 casas; 20 de 3 clientes son
 * tres clientes a los que no se les ha resuelto nada.
 */
const repartidas = (revisiones: number, clientes: number) =>
  !clientes ? "" : `${nfmt(clientes)} clientes · ${num1(revisiones / clientes)} c/u`;

/** Celda de dos pisos: el dato y, debajo, de dónde es. */
function Dos({ arriba, abajo }: { arriba: React.ReactNode; abajo?: React.ReactNode }) {
  return (
    <span className="flex flex-col">
      <span className="font-medium text-text-primary">{arriba}</span>
      {abajo ? <span className="text-[11px] text-text-tertiary">{abajo}</span> : null}
    </span>
  );
}

export function OrdenesRevisiones({ rev }: { rev: Revisiones }) {
  if (!rev || !rev.total) return null;

  // Con mes en letra: "1/11/2025" se lee como 11 de enero la mitad de las veces.
  const dia = (d: string) => fmtFechaCon(d, { day: "numeric", month: "short", year: "numeric" });
  const ventana = `${dia(rev.desde)} → ${dia(rev.hasta)}`;
  const conCaja = rev.total - rev.sinCaja;
  const reinc = rev.reincidentes ?? [];
  const visitasReinc = reinc.reduce((s, r) => s + r.revisiones, 0);
  const top = rev.porSintoma?.[0];
  const media = rev.por100Promedio;

  return (
    <>
      <Section title={`Revisiones a detalle · ${ventana}`}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TrendStat label="Revisiones en la ventana" value={nfmt(rev.total)} icon="search"
            hint="De internet, de TV y de las dos" />
          <TrendStat label="Motivo más frecuente" value={top?.sintoma ?? "—"} icon="message-square" tone="warning"
            hint={top ? `${nfmt(top.total)} revisiones · ${Math.round((100 * top.total) / rev.total)}% del total` : ""} />
          <TrendStat label="Clientes con 3 o más" value={nfmt(reinc.length)} icon="repeat" tone="error"
            hint={reinc.length ? `${nfmt(visitasReinc)} visitas entre todos` : "Ninguno repitió tanto"} />
          <TrendStat label="Ubicadas en una caja NAP" value={nfmt(conCaja)} icon="boxes"
            hint={rev.sinCaja ? `${nfmt(rev.sinCaja)} sin caja (radio, EOC o sin puerto asignado)` : "Todas"} />
        </div>
      </Section>

      <ChartCard title="De qué son las revisiones" icon="message-square"
        subtitle="Deducido del texto con que se abre la orden, así que es orientativo. El detalle de cada línea dice qué servicio se revisó.">
        <HBarList rows={(rev.porSintoma ?? []).map((s) => ({
          label: s.sintoma,
          value: s.total,
          hint: [s.internet && `${nfmt(s.internet)} internet`, s.tv && `${nfmt(s.tv)} TV`, s.combo && `${nfmt(s.combo)} TV e internet`]
            .filter(Boolean).join(" · "),
        }))} />
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="Barrios con más revisiones" icon="map-pin"
          subtitle={media == null
            ? "«Por 100» relativiza con los abonados del barrio: uno grande siempre va a tener más revisiones en bruto."
            : `«Por 100» relativiza con los abonados del barrio. La media de la empresa en esta ventana es ${num1(media)}; en rojo, los que pasan del doble.`}>
          <DataTable rows={rev.porBarrio ?? []} empty="Sin revisiones." columns={[
            { key: "barrio", header: "Barrio", render: (r: Revisiones["porBarrio"][0]) => <Dos arriba={r.barrio} abajo={r.sede} /> },
            { key: "revisiones", header: "Revisiones", align: "right",
              render: (r: Revisiones["porBarrio"][0]) => (
                <span className="flex flex-col items-end">
                  <span className="font-semibold">{nfmt(r.revisiones)}</span>
                  <span className="text-[11px] text-text-tertiary">{repartidas(r.revisiones, r.clientes)}</span>
                </span>
              ) },
            { key: "por100", header: "Por 100 abonados", align: "right", sortValue: (r: Revisiones["porBarrio"][0]) => r.por100 ?? -1,
              render: (r: Revisiones["porBarrio"][0]) => (
                r.por100 == null ? <span className="text-text-tertiary">—</span> : (
                  <span className="flex flex-col items-end">
                    {/* En rojo el que dobla la media de la ventana, no un número fijo:
                        la media de un mes y la de doce meses no se parecen en nada. */}
                    <span className={`font-semibold ${media != null && r.por100 >= 2 * media ? "text-error-text" : ""}`}>
                      {num1(r.por100)}
                    </span>
                    <span className="text-[11px] text-text-tertiary">de {nfmt(r.abonados ?? 0)}</span>
                  </span>
                )
              ) },
          ]} />
        </ChartCard>

        <ChartCard title="Cajas NAP con más revisiones" icon="boxes"
          subtitle="Varias revisiones en la misma caja, y más si son de pocos clientes, es una caja — no son casas distintas.">
          <DataTable rows={rev.porCaja ?? []} empty="Ninguna revisión se pudo ubicar en una caja." columns={[
            { key: "caja", header: "Caja", render: (r: Revisiones["porCaja"][0]) => (
              <Dos arriba={r.caja} abajo={[r.sede, r.vlan ? `VLAN ${r.vlan}` : null, r.detalle].filter(Boolean).join(" · ")} />
            ) },
            { key: "revisiones", header: "Revisiones", align: "right",
              render: (r: Revisiones["porCaja"][0]) => (
                <span className="flex flex-col items-end">
                  <span className="font-semibold">{nfmt(r.revisiones)}</span>
                  <span className="text-[11px] text-text-tertiary">{repartidas(r.revisiones, r.clientes)}</span>
                </span>
              ) },
            { key: "puertos", header: "Puertos", align: "right",
              render: (r: Revisiones["porCaja"][0]) => (r.puertos ? nfmt(r.puertos) : <span className="text-text-tertiary">—</span>) },
          ]} />
        </ChartCard>
      </div>

      {/* items-start: sin esto la tarjeta de tecnología se estira hasta la altura de
          la tabla de VLAN y queda media tarjeta en blanco. */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="VLAN con más revisiones" icon="network"
          subtitle="La VLAN agrupa varias cajas: si sube entera, el problema está en el uplink o en el puerto de la OLT, no en una caja.">
          <DataTable rows={rev.porVlan ?? []} empty="Sin VLAN identificada." columns={[
            { key: "vlan", header: "VLAN", render: (r: Revisiones["porVlan"][0]) => (
              <Dos arriba={`VLAN ${r.vlan}`} abajo={r.detalle} />
            ) },
            { key: "olt", header: "OLT", render: (r: Revisiones["porVlan"][0]) => (
              <Dos arriba={r.olt ?? "—"} abajo={r.sede} />
            ) },
            { key: "revisiones", header: "Revisiones", align: "right",
              render: (r: Revisiones["porVlan"][0]) => (
                <span className="flex flex-col items-end">
                  <span className="font-semibold">{nfmt(r.revisiones)}</span>
                  <span className="text-[11px] text-text-tertiary">{repartidas(r.revisiones, r.clientes)}</span>
                </span>
              ) },
          ]} />
        </ChartCard>

        <ChartCard title="Por tecnología" subtitle="Con qué está instalado el cliente que llama" icon="radio-tower">
          <HBarList monochrome rows={(rev.porTecnologia ?? []).map((t) => ({ label: t.tecnologia, value: t.revisiones }))} />
        </ChartCard>
      </div>

      {reinc.length > 0 && (
        <ChartCard title="Clientes con 3 o más revisiones" icon="repeat"
          subtitle="Lo mismo sin resolver. Cada fila es un técnico que fue tres veces a la misma casa.">
          <DataTable rows={reinc} empty="Ninguno." columns={[
            { key: "abonado", header: "Abonado", render: (r: Revisiones["reincidentes"][0]) => (
              <span className="font-mono text-[12px] text-text-secondary">{r.abonado}</span>
            ) },
            { key: "nombre", header: "Cliente", render: (r: Revisiones["reincidentes"][0]) => (
              <Link href={`/clientes/${r.id}`} className="font-medium text-brand hover:underline">
                {r.nombre ?? `Abonado ${r.abonado}`}
              </Link>
            ) },
            { key: "barrio", header: "Dónde", render: (r: Revisiones["reincidentes"][0]) => (
              <Dos arriba={r.barrio} abajo={[r.sede, r.caja].filter(Boolean).join(" · ")} />
            ) },
            { key: "sintomas", header: "De qué", render: (r: Revisiones["reincidentes"][0]) => (
              <span className="text-[12px] text-text-secondary">{r.sintomas ?? "—"}</span>
            ) },
            { key: "revisiones", header: "Revisiones", align: "right", render: (r: Revisiones["reincidentes"][0]) => (
              <span className="inline-flex items-center gap-1 font-semibold text-error-text">
                <Icon name="repeat" size={12} />{nfmt(r.revisiones)}
              </span>
            ) },
            { key: "ultima", header: "Última", align: "right", render: (r: Revisiones["reincidentes"][0]) => (
              <span className="text-[12px] text-text-secondary">{fmtDate(r.ultima)}</span>
            ) },
          ]} />
        </ChartCard>
      )}

      <ul className="flex list-disc flex-col gap-1 pl-5 text-[12px] text-text-secondary">
        <li>«De qué» se deduce del texto con que se abre la orden, que es libre: sirve para ver el reparto, no para contar al detalle. Lo que no encaja en ningún motivo queda en «Sin clasificar».</li>
        <li>El barrio sale de la ficha del abonado; la caja y la VLAN, del puerto que tiene asignado en la red.{rev.sinCaja ? ` ${nfmt(rev.sinCaja)} revisiones no tienen caja: son de radio o EOC, o el cliente no tiene puerto asignado.` : ""}</li>
        <li>Sin filtro de fechas, este bloque mira los últimos 12 meses — los mismos de «Mes a mes»: una caja que dio guerra hace tres años taparía la que está mala hoy.</li>
      </ul>
    </>
  );
}
