/**
 * Categorías y tipos de equipo (2026-10-07). El legacy no clasifica `equipos`: todo
 * lo que hay ahí es «un equipo con marca y MAC», y en la práctica casi todo son ONUs.
 * Esto vive SOLO en nexus (`Equipment.category` / `Equipment.equipmentType`): no sube
 * al legacy ni el sync lo pisa, porque `mapEquipo` no conoce esas columnas.
 *
 * La misma lista está en `frontend/src/lib/equipos-catalogo.ts`: cambiar las dos.
 */
export const CATALOGO_EQUIPOS: Record<string, string[]> = {
  'Equipo de cliente (CPE)': ['ONU', 'Router WiFi', 'Repetidor / Mesh', 'Decodificador TV', 'Esclavo EOC'],
  'Red de acceso': ['OLT', 'Tarjeta de OLT', 'Módulo SFP', 'Maestro EOC', 'Nodo óptico', 'Amplificador óptico (EDFA)', 'Transmisor óptico'],
  'Enrutamiento y núcleo': ['RB Mikrotik (RouterBoard)', 'Router', 'Switch', 'Servidor'],
  'Radioenlace': ['Antena / Radio', 'Punto de acceso'],
  'Cabecera de TV': ['Receptor satelital', 'Modulador', 'Encoder / IRD'],
  'Energía': ['UPS', 'Inversor', 'Fuente / Rectificador', 'Batería'],
  'Otro': ['Otro'],
};

/** null si la pareja es válida; si no, el mensaje para el 400. */
export function errorCategoriaTipo(category: string | null, equipmentType: string | null): string | null {
  if (!category && !equipmentType) return null;
  if (!category || !CATALOGO_EQUIPOS[category]) return `Categoría no válida. Elige una de: ${Object.keys(CATALOGO_EQUIPOS).join(', ')}.`;
  if (!equipmentType) return 'Elige el tipo de equipo.';
  if (!CATALOGO_EQUIPOS[category].includes(equipmentType)) return `«${equipmentType}» no es un tipo de la categoría ${category}.`;
  return null;
}
