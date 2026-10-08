"use client";

import { Select, Field } from "@/components/ui/Field";
import { CATALOGO_EQUIPOS, CATEGORIAS_EQUIPO } from "@/lib/equipos-catalogo";

/**
 * Par de selects Categoría → Tipo de equipo. Al cambiar la categoría el tipo se
 * resetea al primero de esa categoría (o vacío si la categoría se quita).
 */
export function CategoriaTipoEquipo({ category, equipmentType, onChange, required }: {
  category: string; equipmentType: string;
  onChange: (v: { category: string; equipmentType: string }) => void;
  required?: boolean;
}) {
  const tipos = CATALOGO_EQUIPOS[category] ?? [];
  return (
    <>
      <Field label="Categoría" required={required}>
        <Select value={category} onChange={(e) => onChange({ category: e.target.value, equipmentType: CATALOGO_EQUIPOS[e.target.value]?.[0] ?? "" })}>
          <option value="">{required ? "Elige una categoría…" : "— sin categoría"}</option>
          {CATEGORIAS_EQUIPO.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </Field>
      <Field label="Tipo de equipo" required={required}>
        <Select value={equipmentType} disabled={!category} onChange={(e) => onChange({ category, equipmentType: e.target.value })}>
          {!category && <option value="">—</option>}
          {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </Field>
    </>
  );
}
