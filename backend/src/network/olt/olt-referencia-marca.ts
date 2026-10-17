/**
 * Perfiles de alta copiados de una vecina de la MISMA MARCA (17-oct-2026).
 *
 * El alta copia los perfiles de las ONUs que ya cuelgan del puerto. Antes los
 * sacaba por mayoría, sin mirar la marca y por separado (line-profile de unas,
 * srv-profile de otras). En MONTERREY 0/1/5 —lleno de ZTE y genéricas— una Huawei
 * (equipo 900060, abonado 2369) recibió lp 150 "vlan150" + sp 50 "catv": quedó
 * `config failed`, en línea y sin que un solo paquete PPPoE llegara al Mikrotik.
 * La Huawei vecina que navega usa lp 13 + sp 21 "Generic_1_V150"; con ese par
 * quedó `normal` y conectó en un minuto.
 *
 * Aquí viven las piezas puras de esa elección, para poder probarlas con la
 * salida real de la OLT.
 */

/**
 * Marca de la ONU según su SN: los 4 primeros caracteres del vendor-id
 * ("HWTC", "ZTEG", "DC80", "GPON"…). La OLT Huawei da el SN en hexadecimal
 * (485754433058BEAD → HWTC); el autofind de otras puede darlo ya legible
 * (HWTC3058BEAD). Sin SN legible → null (no se puede filtrar por marca).
 */
export function marcaDeSn(sn: string | null | undefined): string | null {
  const s = String(sn ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[0-9A-F]{16}$/.test(s)) {
    let out = '';
    for (let i = 0; i < 8; i += 2) out += String.fromCharCode(parseInt(s.slice(i, i + 2), 16));
    return /^[\x20-\x7E]{4}$/.test(out) ? out.toUpperCase() : null;
  }
  if (/^[A-Z0-9]{4}[0-9A-F]{8}$/.test(s)) return s.slice(0, 4);
  return null;
}

/** La misma marca, con las dos ONUs identificadas. Sin marca en alguna: no se afirma nada. */
export function mismaMarca(a: string | null | undefined, b: string | null | undefined): boolean {
  const ma = marcaDeSn(a);
  const mb = marcaDeSn(b);
  return !!ma && ma === mb;
}

/**
 * VLANs que lleva DENTRO cada perfil, leídas de `display ont info F S P ID`:
 *  - `lp`: las de la tabla "Mapping VLAN" de los GEM del line-profile.
 *  - `sp`: las S-VLAN/C-VLAN de las filas "Translation" de los puertos ETH del
 *    srv-profile (p. ej. `ETH 1 Translation 1 150 - 150`).
 * Un perfil que lleva una VLAN dentro solo vale para un puerto de esa VLAN:
 * copiarlo de otro PON deja a la ONU marcando en la VLAN equivocada.
 */
export function vlansDelDetalleOnt(raw: string): { lp: number[]; sp: number[] } {
  const lp = new Set<number>();
  const sp = new Set<number>();
  let enMapeo = false;
  // El paginador de la OLT ("---- More ( Press 'Q' to break ) ----" + escapes
  // de cursor) se pega al principio de la línea que sigue: se limpia antes.
  const limpio = String(raw ?? '')
    .replace(/-+\s*More\s*\(\s*Press 'Q' to break\s*\)\s*-+/gi, '')
    .replace(/\x1b\[\d*[A-Za-z]/g, '');
  for (const linea of limpio.split(/\r?\n/)) {
    if (/Mapping\s+VLAN\s+Priority/i.test(linea)) { enMapeo = true; continue; }
    if (enMapeo) {
      // "    1       150   -        -       -     -       -     -"
      const m = linea.match(/^\s*(\d+)\s+(\d+)\s+\S+\s+\S+/);
      if (m) { lp.add(Number(m[2])); continue; }
      // Se sale de la tabla en la primera línea que no es fila ni separador ni cabecera.
      if (!/^\s*(-+|index\b.*)?\s*$/i.test(linea)) enMapeo = false;
    }
    const t = linea.match(/^\s*ETH\s+\d+\s+Translation\s+\d+\s+(\d+)\s+\S+\s+(\d+)/i);
    if (t) { sp.add(Number(t[1])); sp.add(Number(t[2])); }
  }
  return { lp: [...lp].sort((a, b) => a - b), sp: [...sp].sort((a, b) => a - b) };
}

/**
 * ¿Los perfiles de esa vecina sirven para un alta en la VLAN `vlan`? Sí si no
 * llevan VLAN dentro (la pone el service-port) o si la que llevan es esa.
 * Sin VLAN conocida del puerto no se puede comprobar: solo se aceptan perfiles
 * sin VLAN dentro.
 */
export function perfilesValenParaVlan(v: { lp: number[]; sp: number[] }, vlan: number | null): boolean {
  const ok = (vs: number[]) => vs.length === 0 || (vlan !== null && vs.every((x) => x === vlan));
  return ok(v.lp) && ok(v.sp);
}

/** Una ONU que funciona y de la que se copian los dos perfiles juntos. */
export interface ReferenciaDeMarca {
  fsp: string;
  ont_id: string;
  sn: string;
  lineprofile: string;
  srvprofile: string;
  srvprofileNombre: string | null;
  /** PUERTO = vecina del mismo PON; OLT = misma marca en otro puerto de la OLT. */
  origen: 'PUERTO' | 'OLT';
  /** Primer GEM que declara su line-profile (null si no se pudo leer). */
  gemport: string | null;
}
