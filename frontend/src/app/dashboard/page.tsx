"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeading } from "@/components/ui/PageHeading";
import { Icon } from "@/components/Icon";
import { PageSkeleton } from "@/components/skeletons/PageSkeleton";
import { LoadError } from "@/components/ui/LoadError";
import { useAuth } from "@/context/AuthProvider";
import { cop } from "@/lib/subscribers";
import { esCajera, tieneCaja } from "@/lib/treasury";
import { esTecnico } from "@/lib/support";
import { PanelCaja } from "@/components/treasury/PanelCaja";
import { PanelTecnico } from "@/components/support/PanelTecnico";
import { RangoFechas, RangoFechasValor, etiquetaRango, rangoDePreset } from "@/components/ui/RangoFechas";
import { Select } from "@/components/ui/Field";
import { MovimientoAbonadosModal, TipoMovimiento } from "@/components/subscribers/MovimientoAbonadosModal";
import { Sparkline } from "@/components/charts/Sparkline";
import { FlujoCaja, type PuntoFlujo } from "@/components/dashboard/FlujoCaja";
import { DonaInteractiva, type Tajada } from "@/components/dashboard/DonaInteractiva";

const nfmt = (n: number) => (n ?? 0).toLocaleString("es-CO");

/** Variación porcentual contra el periodo anterior; `null` si no hay con qué comparar. */
function variacion(actual: number, previo: number | undefined): number | null {
  if (previo == null || !Number.isFinite(previo) || previo === 0) return null;
  return ((actual - previo) / Math.abs(previo)) * 100;
}

/** "hace 40 s", "hace 3 min"… a partir de un instante ISO. */
function haceCuanto(iso: string | undefined, ahora: number): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`;
}

/**
 * El dashboard no es uno solo: depende de a qué se dedique quien entra.
 *
 * · CON caja asignada → su caja, y nada más (`PanelCaja`): el informe del recaudo del
 *                       día de ESA caja, con el botón de abrirla.
 * · Técnico  → su rendimiento (`PanelTecnico`). Sus órdenes NO van aquí desde
 *              2026-07-31: se atienden en `/soporte`, que ya sólo le muestra las suyas.
 * · Los demás → el panel ejecutivo de siempre (abonados, cartera, recaudo, red).
 *
 * Se decide con los permisos que ya trae la sesión, así que no hay ni parpadeo ni una
 * llamada de más: ni la cajera ni el técnico piden `/dashboard` (que además les
 * respondería 403, porque ese endpoint sigue siendo de gerencia). Cada panel se sirve
 * de sus propios endpoints, ya acotados a quien pregunta.
 *
 * LA CAJA MANDA SOBRE EL CARGO (2026-08-28, decisión del usuario). Quien tiene una caja
 * asignada (`User.cajaLegacyId`, en la sesión como `user.caja`) ve el tablero de esa
 * caja aunque además sea superusuario: son tres superusuarias que atienden ventanilla
 * (Paula Unas y Windy Muñoz en Yopal, Margarita Reyes en Villanueva 2) y su día es la
 * ventanilla, no la gerencia. Sustituye a las pestañas `Panel ejecutivo | Mi caja` que
 * estuvieron vivas un día: el ejecutivo ya no se les pinta, y las cifras de empresa se
 * miran desde una cuenta sin caja.
 *
 * OJO con el orden de las tres preguntas: la caja va PRIMERO, antes que `esCajera()` y
 * que `esTecnico()`, porque es justamente el caso del mando con caja el que hay que
 * atrapar antes de que gane su área. Y `GET /dashboard` (el endpoint del ejecutivo)
 * sigue abierto para un superusuario: esto es lo que ve, no un candado sobre el dato.
 */
export default function DashboardPage() {
  const { loading: authLoading, user } = useAuth();

  if (authLoading) return <PageSkeleton />;
  // `PanelCaja` guarda su día en la dirección y para eso lee `useSearchParams`, que en
  // el App Router exige una frontera de Suspense.
  if (tieneCaja(user) || esCajera(user)) {
    return (
      <Suspense fallback={<PageSkeleton />}>
        <PanelCaja />
      </Suspense>
    );
  }
  if (esTecnico(user)) return <PanelTecnico />;
  return <PanelEjecutivo />;
}

/** Dónde se recuerdan el último periodo y la última sede mirados, para no reelegirlos en cada visita. */
const CLAVE_RANGO = "dashboard:rango";
const CLAVE_SEDE = "dashboard:sede";
/** Preferencias de la gráfica y del refresco, también por navegador. */
const CLAVE_VIVO = "dashboard:vivo";
const CLAVE_ACUMULADO = "dashboard:acumulado";

/**
 * Cada cuánto se vuelve a pedir el panel con "En vivo" puesto. Coincide con el TTL de
 * la caché del backend (`DASHBOARD_TTL_MS`, 60 s): pedirlo más a menudo devolvería
 * las mismas cifras.
 */
const REFRESCO_MS = 60_000;

function PanelEjecutivo() {
  const { loading: authLoading, authFetch } = useAuth();
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [rango, setRango] = useState<RangoFechasValor>(() => rangoDePreset("mes"));
  // Sede mirada: "" = todas las que alcance el usuario. Viaja a la API como el
  // `legacyId` de la sede, que es lo que entienden el resto de filtros del sistema.
  const [sede, setSede] = useState("");
  // Card de abonados cuyo listado está abierto (null = ninguno).
  const [movimiento, setMovimiento] = useState<TipoMovimiento | null>(null);
  const [vivo, setVivo] = useState(true);
  const [acumulado, setAcumulado] = useState(false);
  const [verEgresos, setVerEgresos] = useState(true);
  // Wompi y bancos: parte del ingreso, en líneas aparte que se prenden y apagan.
  const [verWompi, setVerWompi] = useState(true);
  const [verBancos, setVerBancos] = useState(true);
  // Reloj para el "actualizado hace…"; avanza solo, sin volver a pedir nada.
  const [ahora, setAhora] = useState(() => Date.now());

  // El periodo elegido se recuerda entre visitas, pero las FECHAS se recalculan a
  // partir del atajo: guardado "este mes" en julio, al volver en agosto tiene que
  // enseñar agosto, no seguir clavado en julio.
  useEffect(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(CLAVE_RANGO) ?? "null") as RangoFechasValor | null;
      if (guardado?.preset === "personalizado") setRango(guardado);
      else if (guardado?.preset) setRango(rangoDePreset(guardado.preset));
    } catch { /* nada guardado o ilegible: se queda el mes en curso */ }
    try { setSede(localStorage.getItem(CLAVE_SEDE) ?? ""); } catch { /* modo privado */ }
    try { setVivo(localStorage.getItem(CLAVE_VIVO) !== "0"); } catch { /* modo privado */ }
    try { setAcumulado(localStorage.getItem(CLAVE_ACUMULADO) === "1"); } catch { /* modo privado */ }
  }, []);

  const cambiarRango = useCallback((next: RangoFechasValor) => {
    setRango(next);
    try { localStorage.setItem(CLAVE_RANGO, JSON.stringify(next)); } catch { /* modo privado */ }
  }, []);

  const cambiarSede = useCallback((next: string) => {
    setSede(next);
    try { localStorage.setItem(CLAVE_SEDE, next); } catch { /* modo privado */ }
  }, []);

  const alternarVivo = () => {
    setVivo((v) => {
      try { localStorage.setItem(CLAVE_VIVO, v ? "0" : "1"); } catch { /* modo privado */ }
      return !v;
    });
  };
  const cambiarAcumulado = (v: boolean) => {
    setAcumulado(v);
    try { localStorage.setItem(CLAVE_ACUMULADO, v ? "1" : "0"); } catch { /* modo privado */ }
  };

  const { desde, hasta } = rango;

  // Sólo la última petición pinta: con el refresco automático y el selector de fechas
  // pueden cruzarse dos, y la vieja no debe pisar a la nueva al llegar tarde.
  const pedido = useRef(0);
  const load = useCallback(() => {
    const yo = ++pedido.current;
    setErr(false);
    setCargando(true);
    void authFetch(`/dashboard?from=${desde}&to=${hasta}${sede ? `&sede=${sede}` : ""}`)
      .then((r) => {
        // 403 = la sede recordada ya no es suya (le cambiaron el alcance). Se olvida y
        // se vuelve a "todas" en vez de dejarlo con un panel roto que no sabe arreglar.
        if (r.status === 403 && sede) { cambiarSede(""); return null; }
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((json) => { if (json && yo === pedido.current) setD(json); })
      .catch(() => { if (yo === pedido.current) setErr(true); })
      .finally(() => { if (yo === pedido.current) setCargando(false); });
  }, [authFetch, desde, hasta, sede, cambiarSede]);

  useEffect(() => { if (!authLoading) load(); }, [authLoading, load]);

  // "En vivo": se repide cada minuto mientras la pestaña está a la vista, y al volver
  // a ella tras un rato fuera. Con la pestaña escondida no se pide nada.
  useEffect(() => {
    if (authLoading || !vivo) return;
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const id = window.setInterval(tick, REFRESCO_MS);
    const alVolver = () => {
      if (document.visibilityState !== "visible") return;
      const at = d?.calculadoEn ? new Date(d.calculadoEn).getTime() : 0;
      if (Date.now() - at > REFRESCO_MS) load();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", alVolver); };
  }, [authLoading, vivo, load, d?.calculadoEn]);

  useEffect(() => {
    const id = window.setInterval(() => setAhora(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  if (authLoading) return <PageSkeleton />;
  if (err && !d) return <div className="p-6"><LoadError message="No se pudo cargar el panel." onRetry={load} /></div>;
  if (!d) return <PageSkeleton />;

  const est = d.estadoClientes ?? {};
  // Cada tajada con estado propio abre /clientes filtrado por ese estado.
  const aClientes = (st: string) => `/clientes?status=${st}`;
  const baseSeg: Tajada[] = [
    { key: "ACTIVO", label: "Activos", value: est.ACTIVO ?? 0, cls: "text-success-text", href: aClientes("ACTIVO") },
    { key: "CARTERA", label: "Cartera", value: est.CARTERA ?? 0, cls: "text-warning-text", href: aClientes("CARTERA") },
    { key: "CORTADO", label: "Cortados", value: est.CORTADO ?? 0, cls: "text-error-text", href: aClientes("CORTADO") },
    { key: "SUSPENDIDO", label: "Suspendidos", value: est.SUSPENDIDO ?? 0, cls: "text-info-text", href: aClientes("SUSPENDIDO") },
    { key: "OTROS", label: "Otros", value: (est.COMPROMISO ?? 0) + (est.EXONERADO ?? 0) + (est.INSTALAR ?? 0) + (est.REPORTADO ?? 0), cls: "text-text-tertiary" },
  ].filter((s) => s.value > 0);
  const baseActiva = baseSeg.reduce((s, x) => s + x.value, 0);

  const ag = d.cartera.aging;
  const ageSeg: Tajada[] = [
    { key: "c", label: "Corriente (0-30)", value: ag.corriente, cls: "text-success-text" },
    { key: "d60", label: "31-60 días", value: ag.d31_60, cls: "text-warning-text" },
    { key: "d90", label: "61-90 días", value: ag.d61_90, cls: "text-brand" },
    { key: "d90+", label: "+90 días (crítico)", value: ag.d90, cls: "text-error-text" },
  ].filter((s) => s.value > 0);

  const maxSede = Math.max(1, ...(d.ventasPorSede ?? []).map((s: any) => s.total));
  const ordenesTipo: { type: string; count: number }[] = d.ordenesPorTipo ?? [];
  const maxTipo = Math.max(1, ...ordenesTipo.map((t) => t.count));

  const serie: PuntoFlujo[] = d.serieMensual ?? [];
  const porDia = d.rango?.granularidad === "dia";
  const cmp = d.comparacion ?? {};
  const periodoPrevio = cmp.desde ? etiquetaRango({ desde: cmp.desde, hasta: cmp.hasta }) : "";
  const neto = d.tesoreria.ingresos - d.tesoreria.egresos;

  const Rotulo = ({ children }: { children: React.ReactNode }) => (
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{children}</div>
  );

  const periodo = etiquetaRango(rango);
  // El clic en Recaudo/Egresos abre Movimientos con el MISMO periodo, la misma sede,
  // el tipo de la tarjeta y sólo vigentes (lo mismo que suma el panel), para que la
  // cifra de arriba sea la misma que se acaba de ver aquí.
  const aTesoreria = (de: string, a: string, tipo?: "INCOME" | "EXPENSE", caja?: number | null) => `/tesoreria?${new URLSearchParams({
    periodo: "personalizado", desde: de, hasta: a, ...(sede ? { sede } : {}),
    ...(tipo ? { tipo, estado: "VIGENTE" } : {}), ...(caja != null ? { caja: String(caja) } : {}),
  })}`;
  // Pulsar un punto de la gráfica abre ese día (o ese mes, recortado al rango).
  const abrirPunto = (p: PuntoFlujo) => {
    if (porDia) { router.push(aTesoreria(p.month, p.month)); return; }
    const ini = `${p.month}-01`;
    const fin = new Date(Date.UTC(Number(p.month.slice(0, 4)), Number(p.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    router.push(aTesoreria(ini < rango.desde ? rango.desde : ini, fin > rango.hasta ? rango.hasta : fin));
  };
  // Saldos a favor aplicados (sin caja) de una sede: Ingresos, que sí filtra por método.
  const aSaldosAFavor = (sedeCliente: number | null) => `/tesoreria/ingresos?${new URLSearchParams({
    periodo: "personalizado", desde: rango.desde, hasta: rango.hasta, metodo: "Balance", estado: "VIGENTE",
    ...(sedeCliente != null ? { sede: String(sedeCliente) } : sede ? { sede } : {}),
  })}`;
  const aSoporte = (tipo?: string) => `/soporte?${new URLSearchParams({ desde: rango.desde, hasta: rango.hasta, ...(tipo ? { detalle: tipo } : {}) })}`;

  // El catálogo lo trae la propia respuesta ya acotado a las sedes del usuario: no hay
  // llamada aparte, y quien sólo alcanza una sede no ve un desplegable que no le sirve.
  const sedes: { id: number; nombre: string }[] = d.sedes ?? [];
  // La sede que trae los datos que se están pintando (`d.sede`), no la del selector:
  // mientras vuelve la petición siguiente, los rótulos tienen que describir lo que hay
  // en pantalla. Y a quien sólo alcanza una sede se la nombra igual, aunque no filtre.
  const sedeActual = d.sede != null ? sedes.find((x) => x.id === d.sede) ?? null : null;
  const ambito = sedeActual ? sedeActual.nombre : "Todas las sedes";

  const tarjeta = "rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm";

  return (
    <>
      {/*
        El panel se lee SIEMPRE contra un periodo (por defecto el mes en curso). Lo que
        es una foto de hoy y no depende del rango —la base de abonados y la cartera—
        queda sólo en las donas, que lo dicen en su propio subtítulo: la franja "A hoy"
        se quitó a pedido del usuario (2026-08-08) por repetir esos mismos números.
      */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 [&>div]:mb-0">
          <PageHeading icon="layout-dashboard" title="Panel ejecutivo" subtitle={`${ambito} · ${periodo}`} />
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:pt-1">
          <button
            type="button"
            onClick={alternarVivo}
            title={vivo ? "Se actualiza solo cada minuto. Pulsa para pausar." : "Actualización automática en pausa. Pulsa para reanudar."}
            className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-2.5 py-1 text-[11px] text-text-secondary hover:border-border-strong"
          >
            <span className="relative flex h-2 w-2">
              {vivo && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${vivo ? "bg-success" : "bg-text-tertiary"}`} />
            </span>
            {vivo ? "En vivo" : "En pausa"}
            <span className="text-text-tertiary">· {haceCuanto(d.calculadoEn, ahora)}</span>
          </button>
          <button
            type="button"
            onClick={load}
            disabled={cargando}
            aria-label="Actualizar ahora"
            title="Actualizar ahora"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-surface text-text-secondary hover:border-border-strong disabled:opacity-60"
          >
            <Icon name={cargando ? "loader" : "refresh-cw"} size={14} className={cargando ? "animate-spin" : ""} />
          </button>
          {sedes.length > 1 && (
            <Select value={sede} onChange={(e) => cambiarSede(e.target.value)} className="w-auto" aria-label="Sede">
              <option value="">Todas las sedes</option>
              {sedes.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </Select>
          )}
          <RangoFechas value={rango} onChange={cambiarRango} />
        </div>
      </div>

      {/* Franja de KPIs del periodo, cada uno contra el periodo anterior. Cifras EXACTAS
          en pesos, nunca "$102.7M": se cotejan contra Tesorería (pedido 2026-09-28). */}
      <div className={`shrink-0 transition-opacity ${cargando ? "opacity-70" : ""}`}>
        <Rotulo>En el periodo{periodoPrevio && <span className="font-normal normal-case tracking-normal"> · comparado con {periodoPrevio}</span>}</Rotulo>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 2xl:grid-cols-6">
          <Kpi label="Facturado" value={cop(d.facturacion.total)} titulo={cop(d.facturacion.total)} icon="file-text" href="/facturacion"
            delta={variacion(d.facturacion.total, cmp.facturado)} previo={cmp.facturado != null ? cop(cmp.facturado) : undefined} />
          <Kpi label="Recaudo" value={cop(d.tesoreria.ingresos)} titulo={cop(d.tesoreria.ingresos)} icon="banknote" href={aTesoreria(rango.desde, rango.hasta, "INCOME")} tone="bg-success-soft text-success-text"
            delta={variacion(d.tesoreria.ingresos, cmp.ingresos)} previo={cmp.ingresos != null ? cop(cmp.ingresos) : undefined}
            spark={porDia ? serie.map((p) => p.income) : undefined} sparkColor="var(--color-success)" />
          <Kpi label="Egresos" value={cop(d.tesoreria.egresos)} titulo={cop(d.tesoreria.egresos)} icon="arrow-down" href={aTesoreria(rango.desde, rango.hasta, "EXPENSE")} tone="bg-error-soft text-error-text"
            delta={variacion(d.tesoreria.egresos, cmp.egresos)} previo={cmp.egresos != null ? cop(cmp.egresos) : undefined} subirEsMalo
            spark={porDia ? serie.map((p) => p.expense) : undefined} sparkColor="var(--color-error)" />
          <Kpi label="Órdenes creadas" value={nfmt(d.soporte.total)} icon="headphones" href={aSoporte()} tone="bg-info-soft text-info-text"
            delta={variacion(d.soporte.total, cmp.ordenes)} previo={cmp.ordenes != null ? nfmt(cmp.ordenes) : undefined} subirEsMalo />
          <Kpi label="Abonados nuevos" value={nfmt(d.nuevosAbonados ?? 0)} icon="user-plus" onClick={() => setMovimiento("nuevos")} tone="bg-success-soft text-success-text"
            delta={variacion(d.nuevosAbonados ?? 0, cmp.nuevos)} previo={cmp.nuevos != null ? nfmt(cmp.nuevos) : undefined} />
          <Kpi label="Retiros" value={nfmt(d.retirosAbonados ?? 0)} icon="user-minus" onClick={() => setMovimiento("retiros")} tone="bg-error-soft text-error-text"
            delta={variacion(d.retirosAbonados ?? 0, cmp.retiros)} previo={cmp.retiros != null ? nfmt(cmp.retiros) : undefined} subirEsMalo />
        </div>
      </div>

      {/* Gráfica hero: flujo de caja del periodo, interactiva */}
      <div className={tarjeta}>
        <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[14px] font-bold text-text-primary">Recaudo vs egresos</div>
            {/*
              Al filtrar por sede el movimiento se ata a SU CAJA, y lo que entra por los
              bancos (Wompi, consignaciones) a la sede del cliente que pagó: el recaudo
              de una sede es todo lo que pagaron sus clientes, no sólo la ventanilla.
            */}
            <div className="text-[11px] text-text-tertiary">
              Flujo de caja {porDia ? "por día" : "por mes"} · {periodo}
              {sedeActual && " · cajas de la sede + pagos por banco de sus clientes"}
            </div>
            <div className="mt-1 text-[12px] text-text-secondary">
              Neto del periodo: <span className={`font-semibold ${neto < 0 ? "text-error-text" : "text-success-text"}`}>{cop(neto)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <div className="flex overflow-hidden rounded-lg border border-border-subtle">
              {([["Por " + (porDia ? "día" : "mes"), false], ["Acumulado", true]] as const).map(([txt, v]) => (
                <button key={txt} type="button" onClick={() => cambiarAcumulado(v)}
                  className={`px-2.5 py-1 ${acumulado === v ? "bg-brand text-white" : "bg-surface text-text-secondary hover:bg-surface-2"}`}>
                  {txt}
                </button>
              ))}
            </div>
            <span className="flex items-center gap-1 rounded-lg px-1.5 py-1"><span className="h-[3px] w-4 rounded-full bg-success" /> Efectivo</span>
            <button type="button" onClick={() => setVerEgresos((v) => !v)} aria-pressed={verEgresos}
              className={`flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-surface-2 ${verEgresos ? "" : "opacity-45 line-through"}`}>
              <span className="h-[3px] w-4 rounded-full bg-error" /> Egresos
            </button>
            {([["Wompi", "bg-info-text", verWompi, setVerWompi], ["Bancos", "bg-warning", verBancos, setVerBancos]] as const).map(([txt, color, on, set]) => (
              <button key={txt} type="button" onClick={() => set((v) => !v)} aria-pressed={on}
                title={`Lo que del ingreso entró por ${txt === "Wompi" ? "Wompi" : "los bancos"}`}
                className={`flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-surface-2 ${on ? "" : "opacity-45 line-through"}`}>
                <span className={`h-[3px] w-4 rounded-full ${color}`} /> {txt}
              </button>
            ))}
          </div>
        </div>
        <FlujoCaja serie={serie} acumulado={acumulado} verEgresos={verEgresos} verWompi={verWompi} verBancos={verBancos} onElegir={abrirPunto} />
      </div>

      {/* Por dónde entró el recaudo: las tres partes suman la tarjeta «Recaudo» */}
      <RecaudoPorCanal
        canales={d.tesoreria.canales ?? []} total={d.tesoreria.ingresos} previo={cmp.canales}
        subtitulo={`${ambito} · ${periodo}`}
        aCuenta={(k) => (k.id != null ? aTesoreria(rango.desde, rango.hasta, "INCOME", k.id) : aSaldosAFavor(k.sede ?? null))}
      />

      {/* Foto de hoy: base, cartera y quién debe más */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <div className={tarjeta}>
          <div className="text-[13px] font-bold text-text-primary">Distribución de la base activa</div>
          <div className="mb-3 text-[11px] text-text-tertiary">Cómo está la base hoy · pulsa un estado para ver esos clientes</div>
          <DonaInteractiva tajadas={baseSeg} centro={nfmt(baseActiva)} centroLabel="conectados" fmt={nfmt} />
        </div>
        <div className={tarjeta}>
          <div className="text-[13px] font-bold text-text-primary">Cartera por antigüedad</div>
          <div className="mb-3 text-[11px] text-text-tertiary">Deuda a hoy según los días que lleva vencida</div>
          <DonaInteractiva tajadas={ageSeg} centro={cop(d.cartera.total)} centroLabel="pendiente" fmt={cop} />
        </div>
        <div className={`${tarjeta} lg:col-span-2 xl:col-span-1`}>
          <div className="text-[13px] font-bold text-text-primary">Top clientes en mora</div>
          <div className="mb-2 text-[11px] text-text-tertiary">Deuda acumulada a hoy · solo activos y cartera (lo recuperable)</div>
          <div className="flex flex-col">
            {(d.topDeudores ?? []).slice(0, 10).map((r: any, i: number) => {
              const maxDeuda = d.topDeudores?.[0]?.balance || 1;
              return (
                <Link key={r.id} href={`/clientes/${r.id}`} className="group relative flex items-center justify-between gap-2 overflow-hidden rounded-md px-1 py-1.5 text-[12px] hover:text-brand">
                  <span className="absolute inset-y-1 left-0 rounded-md bg-error-soft/60 transition-[width] duration-700 group-hover:bg-error-soft" style={{ width: `${(r.balance / maxDeuda) * 100}%` }} />
                  <span className="relative truncate"><span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-surface-2 text-[9px] font-bold text-text-tertiary">{i + 1}</span>{r.name}</span>
                  <span className="relative shrink-0 font-semibold text-error-text">{cop(r.balance)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Facturación por sede + órdenes por tipo */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={tarjeta}>
          <div className="text-[13px] font-bold text-text-primary">Facturación por sede</div>
          {/*
            Esta tarjeta NO se filtra a propósito: es la comparativa entre sedes, y
            filtrada sería una sola barra al 100%, que no compara nada. Al elegir una
            sede se resalta la suya y se atenúan las demás.
          */}
          <div className="mb-3 text-[11px] text-text-tertiary">
            Facturado y abonados facturados en el periodo · pulsa una sede para filtrar el panel
            {sedeActual && sedes.length > 1 && " · todas las sedes, para comparar"}
          </div>
          <div className="flex flex-col gap-3">
            {!(d.ventasPorSede ?? []).length && <div className="py-6 text-center text-[12px] text-text-tertiary">Sin facturación en el periodo</div>}
            {(d.ventasPorSede ?? []).map((s: any) => {
              const elegida = !!sedeActual && s.id === d.sede;
              const atenuada = !!sedeActual && !elegida;
              return (
                <button
                  key={s.sede}
                  type="button"
                  // La barra es también el filtro: es donde uno mira cuando piensa "¿y
                  // qué pasa en Monterrey?". Volver a pulsarla quita el filtro.
                  onClick={() => cambiarSede(elegida || s.id == null ? "" : String(s.id))}
                  className={`tap flex items-center gap-3 rounded-lg px-1 py-0.5 text-left transition-opacity hover:bg-surface-2 ${atenuada ? "opacity-45" : ""}`}
                  aria-pressed={elegida}
                >
                  <span className={`w-24 shrink-0 truncate text-[12px] font-semibold ${elegida ? "text-brand" : "text-text-primary"}`}>{s.sede}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out" style={{ width: `${(s.total / maxSede) * 100}%` }} /></div>
                  <div className="w-32 shrink-0 text-right">
                    <div className="text-[12px] font-bold text-text-primary" title={cop(s.total)}>{cop(s.total)}</div>
                    <div className="text-[10px] text-text-tertiary">{nfmt(s.abonados)} abonados</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div className={tarjeta}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[13px] font-bold text-text-primary">Órdenes de servicio</div>
              <div className="mb-3 text-[11px] text-text-tertiary">Las más pedidas en el periodo · pulsa un tipo para verlas</div>
            </div>
            <div className="flex shrink-0 gap-3 text-right text-[11px]">
              <div><div className="text-[15px] font-bold text-warning-text">{nfmt(d.soporte.pendientes)}</div><div className="text-text-tertiary">abiertas</div></div>
              <div><div className="text-[15px] font-bold text-success-text">{nfmt(d.soporte.resueltas)}</div><div className="text-text-tertiary">resueltas</div></div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {!ordenesTipo.length && <div className="py-6 text-center text-[12px] text-text-tertiary">Sin órdenes en el periodo</div>}
            {ordenesTipo.map((t) => (
              <Link key={t.type} href={aSoporte(t.type)} className="group flex items-center gap-3 rounded-lg px-1 py-0.5 hover:bg-surface-2">
                <span className="w-36 shrink-0 truncate text-[12px] text-text-secondary group-hover:text-brand" title={t.type}>{t.type || "—"}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-info transition-[width] duration-700 ease-out" style={{ width: `${(t.count / maxTipo) * 100}%` }} /></div>
                <span className="w-10 shrink-0 text-right text-[12px] font-semibold text-text-primary">{nfmt(t.count)}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
      <MovimientoAbonadosModal tipo={movimiento} desde={desde} hasta={hasta} sede={sede} periodo={`${ambito} · ${periodo}`} onClose={() => setMovimiento(null)} />
    </>
  );
}

/**
 * Tarjeta de KPI con su variación contra el periodo anterior. `subirEsMalo` invierte
 * el color (más egresos o más retiros es una flecha arriba en rojo, no en verde).
 * Con `onClick` en vez de `href` abre un detalle en el sitio (el listado de abonados
 * nuevos o de retiros) en lugar de navegar a otra pantalla.
 */
/** `id` null = saldos a favor aplicados (sin caja), uno por sede del cliente (`sede`). */
type CuentaRecaudo = { id: number | null; nombre: string; total: number; n: number; sede?: number | null };
type CanalRecaudo = { canal: "ventanilla" | "wompi" | "bancos"; total: number; n: number; cuentas: CuentaRecaudo[] };

const CANAL: Record<CanalRecaudo["canal"], { label: string; icon: string; tone: string; barra: string; ayuda: string }> = {
  ventanilla: { label: "Efectivo", icon: "wallet", tone: "bg-brand-soft text-brand", barra: "bg-brand", ayuda: "Lo que se cobró en las cajas de las oficinas" },
  wompi: { label: "Wompi", icon: "globe", tone: "bg-info-soft text-info-text", barra: "bg-info-text", ayuda: "Pagos en línea (PSE, tarjeta, Nequi) desde el portal" },
  bancos: { label: "Bancos", icon: "landmark", tone: "bg-warning-soft text-warning-text", barra: "bg-warning", ayuda: "Consignaciones y corresponsales cargados a las cuentas de banco" },
};

/**
 * El recaudo partido por canal: ventanilla, Wompi y bancos. Sale del MISMO cálculo
 * que la tarjeta «Recaudo» (sede, periodo, sin arrastre ni consignaciones internas),
 * así que las tres partes suman su cifra al peso. Cada cuenta abre sus ingresos en
 * Tesorería con el mismo periodo y la misma sede.
 */
/**
 * En efectivo la cuenta es la caja de una sede ("Yopal"): se lee «Efectivo», y sólo
 * si hay varias cajas (todas las sedes) se dice de cuál («Efectivo · Yopal»). Los
 * saldos a favor no son efectivo: ya traen su nombre («Saldos a favor · Yopal»).
 */
function nombreCuenta(c: CanalRecaudo, k: CuentaRecaudo): string {
  if (c.canal !== "ventanilla" || k.id == null) return k.nombre;
  return c.cuentas.filter((x) => x.id != null).length === 1 ? "Efectivo" : `Efectivo · ${k.nombre}`;
}

function RecaudoPorCanal({ canales, total, previo, subtitulo, aCuenta }: {
  canales: CanalRecaudo[]; total: number; previo?: Record<string, number>; subtitulo: string; aCuenta: (k: CuentaRecaudo) => string;
}) {
  if (!canales.length) return null;
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm">
      <div className="text-[14px] font-bold text-text-primary">Recaudo por canal</div>
      <div className="mb-3 text-[11px] text-text-tertiary">Por dónde entró la plata · {subtitulo} · pulsa una cuenta para ver sus pagos</div>
      {/* Barra apilada: la proporción de cada canal sobre el recaudo */}
      <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-surface-2">
        {canales.map((c) => (
          <div key={c.canal} className={`${CANAL[c.canal].barra} transition-[width] duration-700 ease-out`} style={{ width: `${pct(c.total)}%` }} title={`${CANAL[c.canal].label}: ${cop(c.total)}`} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {canales.map((c) => {
          const meta = CANAL[c.canal];
          const delta = variacion(c.total, previo?.[c.canal]);
          return (
            <div key={c.canal} className="min-w-0">
              <div className="flex items-center gap-3" title={meta.ayuda}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}><Icon name={meta.icon} size={17} /></span>
                <div className="min-w-0">
                  <div className="whitespace-nowrap text-[17px] font-bold leading-none text-text-primary">{cop(c.total)}</div>
                  <div className="truncate text-[11px] text-text-tertiary">
                    {meta.label} · {pct(c.total).toFixed(0)}% · {nfmt(c.n)} {c.n === 1 ? "pago" : "pagos"}
                  </div>
                </div>
                {delta != null && (
                  <span title={previo?.[c.canal] != null ? `Periodo anterior: ${cop(previo[c.canal])}` : undefined}
                    className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                      Math.abs(delta) < 0.5 ? "bg-surface-2 text-text-secondary" : delta > 0 ? "bg-success-soft text-success-text" : "bg-error-soft text-error-text"}`}>
                    {delta > 0 ? "+" : ""}{delta.toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-col">
                {!c.cuentas.length && <div className="px-1 py-1 text-[12px] text-text-tertiary">Sin pagos en el periodo</div>}
                {c.cuentas.map((k) => (
                  <Link key={k.id ?? k.nombre} href={aCuenta(k)} className="flex items-center justify-between gap-2 rounded-md px-1 py-1 text-[12px] hover:bg-surface-2 hover:text-brand">
                    <span className="truncate">{nombreCuenta(c, k)}</span>
                    <span className="shrink-0 font-semibold" title={`${nfmt(k.n)} pagos`}>{cop(k.total)}</span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Kpi({
  label, value, titulo, icon, href, onClick, tone, delta, previo, subirEsMalo, spark, sparkColor,
}: {
  label: string; value: string; titulo?: string; icon: string; href?: string; onClick?: () => void; tone?: string;
  delta?: number | null; previo?: string; subirEsMalo?: boolean; spark?: number[]; sparkColor?: string;
}) {
  const cls = "group flex min-w-0 flex-col gap-2 rounded-xl border border-border-subtle bg-surface px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md";
  const sube = (delta ?? 0) >= 0;
  const bueno = subirEsMalo ? !sube : sube;
  const cuerpo = (
    <>
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone ?? "bg-brand-soft text-brand"}`}><Icon name={icon} size={17} /></span>
        <div className="min-w-0">
          <div className="whitespace-nowrap text-[15px] font-bold leading-none text-text-primary" title={titulo}>{value}</div>
          <div className="truncate text-[11px] text-text-tertiary">{label}</div>
        </div>
      </div>
      {spark && spark.length > 1 && <Sparkline points={spark} height={26} color={sparkColor} />}
      {delta != null ? (
        <div className="flex items-center gap-1.5 text-[11px]" title={previo ? `Periodo anterior: ${previo}` : undefined}>
          <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold ${
            Math.abs(delta) < 0.5 ? "bg-surface-2 text-text-secondary" : bueno ? "bg-success-soft text-success-text" : "bg-error-soft text-error-text"
          }`}>
            <Icon name={sube ? "trending-up" : "trending-down"} size={11} />
            {`${sube ? "+" : ""}${delta.toFixed(Math.abs(delta) < 10 ? 1 : 0)}%`}
          </span>
          {previo && <span className="truncate text-text-tertiary">antes {previo}</span>}
        </div>
      ) : previo != null ? (
        <div className="text-[11px] text-text-tertiary">antes {previo}</div>
      ) : null}
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className={cls}>{cuerpo}</button>
    : <Link href={href ?? "#"} className={cls}>{cuerpo}</Link>;
}
