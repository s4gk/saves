/**
 * Ubicación de las cajas NAP desde un KMZ/KML de Google Earth.
 *
 * El área de redes lleva el plano de la red en Google Earth: cada caja es un
 * marcador (Placemark) con el nombre de la caja y un punto. Aquí se lee ese
 * fichero y se empareja cada marcador con su `Nap` POR NOMBRE, dentro de una sede.
 *
 * Los nombres no coinciden letra a letra: los del legacy vienen con espacios y
 * guiones sueltos (`MY- VLS13 _12`, `VN-  PAR5 _08`) y en Google Earth se escriben
 * como a cada quien le salga. Por eso se comparan normalizados —mayúsculas, sin
 * tildes, sin nada que no sea letra o número—. Si así no aparece, se prueba una
 * coincidencia "parecida" (uno termina en el otro: `VLS13_12` ↔ `MY- VLS13 _12`),
 * que sólo vale si es ÚNICA y que la pantalla enseña aparte para revisarla.
 *
 * Todo lo de este fichero es puro (sin base de datos) para poder probarlo.
 */
import JSZip from 'jszip';
import { distMeters, parsePoint } from '../geo/geo.util';

export type MarcadorKmz = { nombre: string; carpeta: string; lat: number; lng: number };

/** Lee un .kmz (zip con un .kml dentro) o un .kml suelto y devuelve sus puntos. */
export async function leerKmz(buf: Buffer): Promise<{ marcadores: MarcadorKmz[]; descartados: number }> {
  let kml: string;
  // Un zip empieza por "PK". Lo demás se trata como KML en texto.
  if (buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buf);
    const kmls = Object.values(zip.files).filter((f) => !f.dir && /\.kml$/i.test(f.name));
    if (!kmls.length) throw new Error('El KMZ no trae ningún .kml dentro.');
    // Google Earth guarda el principal como doc.kml; si hay varios, se leen todos.
    kmls.sort((a, b) => (a.name.toLowerCase() === 'doc.kml' ? -1 : b.name.toLowerCase() === 'doc.kml' ? 1 : 0));
    kml = (await Promise.all(kmls.map((f) => f.async('string')))).join('\n');
  } else {
    kml = buf.toString('utf8');
    if (!/<kml[\s>]/i.test(kml)) throw new Error('El archivo no es un KMZ ni un KML de Google Earth.');
  }
  return leerKml(kml);
}

/**
 * Recorre el KML guardando en qué carpeta está cada marcador (la carpeta suele
 * decir la sede o el sector, y ayuda a revisar). Sólo interesan los marcadores
 * con UN punto: las líneas (rutas de fibra) y polígonos se ignoran.
 */
export function leerKml(kml: string): { marcadores: MarcadorKmz[]; descartados: number } {
  const marcadores: MarcadorKmz[] = [];
  let descartados = 0;
  const carpetas: string[] = [];
  const re = /<(\/?)(Folder|Document|Placemark)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(kml))) {
    const cierra = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'placemark') {
      if (cierra) continue;
      const fin = kml.indexOf('</Placemark>', re.lastIndex);
      const cuerpo = kml.slice(re.lastIndex, fin < 0 ? undefined : fin);
      re.lastIndex = fin < 0 ? kml.length : fin + '</Placemark>'.length;
      const nombre = texto(etiqueta(cuerpo, 'name'));
      const punto = /<Point\b[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i.exec(cuerpo);
      if (!punto) continue; // línea o polígono: no es una caja
      // KML guarda "lng,lat[,alt]".
      const [lng, lat] = punto[1].trim().split(/[\s]+/)[0].split(',');
      const p = parsePoint(lat, lng);
      if (!nombre || !p) { descartados++; continue; }
      marcadores.push({ nombre, carpeta: carpetas.filter(Boolean).join(' / '), lat: p.lat, lng: p.lng });
    } else if (cierra) {
      carpetas.pop();
    } else {
      // El <name> de la carpeta es el primero que aparece antes de su primer hijo.
      const resto = kml.slice(re.lastIndex, re.lastIndex + 2000);
      const hijo = resto.search(/<(Folder|Placemark|Document)\b/i);
      carpetas.push(texto(etiqueta(hijo < 0 ? resto : resto.slice(0, hijo), 'name')));
    }
  }
  return { marcadores, descartados };
}

function etiqueta(xml: string, tag: string): string {
  const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return r ? r[1] : '';
}

function texto(raw: string): string {
  return raw
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `MY- VLS13 _12` → `MYVLS1312`. */
export function normalizarNombreNap(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type NapConGps = { id: string; name: string; gpsLat: string | null; gpsLng: string | null };

export type FilaKmz = {
  kmz: string;
  carpeta: string;
  lat: number;
  lng: number;
  /** exacta | parecida (uno termina en el otro) | ambigua (varias cajas) | sin_caja | repetida (otro marcador ya la reclamó) */
  coincidencia: 'exacta' | 'parecida' | 'ambigua' | 'sin_caja' | 'repetida';
  napId: string | null;
  nap: string | null;
  /** Para `ambigua`: los nombres entre los que no se pudo decidir. */
  candidatas?: string[];
  /** nueva (no tenía GPS) | mueve (tenía otro punto) | igual (≤ 15 m) */
  efecto: 'nueva' | 'mueve' | 'igual' | null;
  /** Distancia al punto que ya tenía, si tenía. */
  distancia: number | null;
};

/** Por debajo de esto se considera el mismo sitio (precisión de GPS de celular). */
export const MISMO_SITIO_M = 15;

/** Empareja cada marcador con una caja de la sede. No toca nada. */
export function emparejar(marcadores: MarcadorKmz[], naps: NapConGps[]): FilaKmz[] {
  const porNombre = new Map<string, NapConGps[]>();
  for (const n of naps) {
    const k = normalizarNombreNap(n.name);
    if (!k) continue;
    porNombre.set(k, [...(porNombre.get(k) ?? []), n]);
  }
  const claves = [...porNombre.keys()];
  const tomadas = new Set<string>();

  return marcadores.map((mk): FilaKmz => {
    const base = { kmz: mk.nombre, carpeta: mk.carpeta, lat: mk.lat, lng: mk.lng };
    const k = normalizarNombreNap(mk.nombre);
    let coincidencia: FilaKmz['coincidencia'] = 'exacta';
    let cands = k ? porNombre.get(k) ?? [] : [];
    if (!cands.length && k.length >= 4) {
      // Uno termina en el otro, y debe quedar una sola caja: con dos, adivinar
      // sería poner la caja en el poste de la de al lado.
      const sim = claves.filter((c) => (c.endsWith(k) || k.endsWith(c)) && c.length >= 4);
      cands = sim.flatMap((c) => porNombre.get(c)!);
      coincidencia = 'parecida';
    }
    if (!cands.length) return { ...base, coincidencia: 'sin_caja', napId: null, nap: null, efecto: null, distancia: null };
    if (cands.length > 1) {
      return { ...base, coincidencia: 'ambigua', napId: null, nap: null, candidatas: cands.map((c) => c.name), efecto: null, distancia: null };
    }
    const nap = cands[0];
    if (tomadas.has(nap.id)) return { ...base, coincidencia: 'repetida', napId: nap.id, nap: nap.name, efecto: null, distancia: null };
    tomadas.add(nap.id);
    const antes = parsePoint(nap.gpsLat, nap.gpsLng);
    const distancia = antes ? distMeters(antes.lat, antes.lng, mk.lat, mk.lng) : null;
    const efecto = distancia == null ? 'nueva' : distancia <= MISMO_SITIO_M ? 'igual' : 'mueve';
    return { ...base, coincidencia, napId: nap.id, nap: nap.name, efecto, distancia };
  });
}
