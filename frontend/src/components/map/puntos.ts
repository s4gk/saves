// Tipos y colores del mapa, SIN Leaflet: las páginas los importan de aquí. Si los
// sacaran de Mapa.tsx, ese import (que no es sólo de tipos) arrastra Leaflet al
// render del servidor y la página revienta con "window is not defined".

export type TipoPunto = "abonado" | "nap" | "tecnico" | "yo" | "oficina";

export type PuntoMapa = {
  id: string;
  tipo: TipoPunto;
  lat: number;
  lng: number;
  titulo: string;
  /** Líneas "etiqueta: valor" del globo. */
  detalles?: { label: string; valor: string | null | undefined }[];
  /** Colorea el pin (estado del abonado). */
  color?: string;
  /** Enlace del botón "Abrir ficha" del globo. */
  href?: string;
  /** Círculo de incertidumbre en metros (precisión del GPS). */
  radioM?: number;
  /** Ofrece "Cómo llegar" en el globo (requiere `onComoLlegar`). */
  rutaHasta?: boolean;
};

/** Color por estado del abonado. El mapa se lee de un vistazo o no sirve. */
export const COLOR_ESTADO: Record<string, string> = {
  ACTIVO: "#10b981",
  CARTERA: "#f2ae2e",
  COMPROMISO: "#f28d35",
  CORTADO: "#bf303c",
  SUSPENDIDO: "#bf303c",
  REPORTADO: "#94252f",
  INSTALAR: "#0ea5e9",
  POR_RETIRAR: "#8b5cf6",
  RETIRADO: "#94a3b8",
  DEPURADO: "#94a3b8",
  EXONERADO: "#64748b",
  EVENTO: "#64748b",
};
