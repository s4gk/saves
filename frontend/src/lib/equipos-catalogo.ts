/**
 * Categorías y tipos de equipo. Copia de `backend/src/network/equipos-catalogo.ts`
 * (el backend valida la pareja): cambiar las dos a la vez.
 */
export const CATALOGO_EQUIPOS: Record<string, string[]> = {
  "Equipo de cliente (CPE)": ["ONU", "Router WiFi", "Repetidor / Mesh", "Decodificador TV", "Esclavo EOC"],
  "Red de acceso": ["OLT", "Tarjeta de OLT", "Módulo SFP", "Maestro EOC", "Nodo óptico", "Amplificador óptico (EDFA)", "Transmisor óptico"],
  "Enrutamiento y núcleo": ["RB Mikrotik (RouterBoard)", "Router", "Switch", "Servidor"],
  "Radioenlace": ["Antena / Radio", "Punto de acceso"],
  "Cabecera de TV": ["Receptor satelital", "Modulador", "Encoder / IRD"],
  "Energía": ["UPS", "Inversor", "Fuente / Rectificador", "Batería"],
  "Otro": ["Otro"],
};

export const CATEGORIAS_EQUIPO = Object.keys(CATALOGO_EQUIPOS);
