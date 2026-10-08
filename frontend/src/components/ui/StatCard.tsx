import { Icon } from "@/components/Icon";

/**
 * Tarjeta de cifra: icono + etiqueta + valor. La fila de indicadores que encabeza
 * casi todos los listados del ERP.
 *
 * Estaba definida **9 veces** copiada en otras tantas páginas, con la misma API y
 * diferencias sólo de tamaño de fuente (17 px en inventario, 18 px en el resto).
 * Aquí se unifica en 18 px.
 *
 * OJO: `components/accounting/StatCard.tsx` NO es este componente aunque se llame
 * igual — usa `tone` como nombre de variante ("default" | …) y otra maquetación.
 * Se deja como está para no cambiar el aspecto de contabilidad; si algún día se
 * fusionan, hay que reconciliar las dos APIs a conciencia.
 */
export function StatCard({
  label,
  value,
  icon,
  tone = "text-text-primary",
  onClick,
  active = false,
}: {
  label: string;
  /** Acepta número además de texto: varias pantallas pasan el conteo crudo. */
  value: string | number;
  icon: string;
  /** Clase Tailwind de color para el valor (no una variante). */
  tone?: string;
  /** Si viene, la tarjeta es un botón (p. ej. filtra la tabla de abajo). */
  onClick?: () => void;
  /** Resalta la tarjeta cuando su filtro está puesto. */
  active?: boolean;
}) {
  const base = "flex items-center gap-3 rounded-xl border bg-surface px-4 py-3 shadow-sm";
  const cuerpo = (
    <>
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
        <Icon name={icon} size={17} />
      </span>
      <div className="flex flex-col leading-tight">
        <span className="text-[11px] font-medium text-text-tertiary">{label}</span>
        <span className={`text-[18px] font-bold ${tone}`}>{value}</span>
      </div>
    </>
  );
  if (!onClick) return <div className={`${base} border-border-subtle`}>{cuerpo}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} cursor-pointer text-left transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
        active ? "border-brand ring-1 ring-brand" : "border-border-subtle"
      }`}
    >
      {cuerpo}
    </button>
  );
}
