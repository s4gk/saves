/**
 * A qué servicio pertenece un renglón de factura, para partir el valor de la factura
 * en internet y televisión (Excel de /facturacion).
 *
 * Como en el cierre de caja (`treasury/cierre-informe.ts`), se decide por el NOMBRE
 * del producto: el legacy nunca guardó el tipo en el renglón. El orden importa:
 * "Afiliación Internet" y "Agregar Select…" hablan de internet/TV pero son cargos
 * sueltos, no mensualidad, así que se descartan antes de mirar el servicio.
 */
export type ServicioRenglon = 'internet' | 'television' | 'otro';

export function servicioDeRenglon(producto: string | null | undefined): ServicioRenglon {
  const p = (producto ?? '').toLowerCase();
  if (!p) return 'otro';
  // Cargos sueltos y ajustes: afiliaciones, traslados, reconexiones, notas, equipos.
  if (/afilia|traslado|reconex|nota (credito|cr[eé]dito|debito|d[eé]bito)|equipo|tdt|receptor|modem|cable utp|repetidor/.test(p)) return 'otro';
  if (/mega|hilo oscuro|dedicad|ipv4|ip p[uú]blica|agregar internet/.test(p)) return 'internet';
  // "Punto Adicional" y "PuntoComercial" son decos de TV extra (ver puntos adicionales).
  if (/tele|punto ?adicional|punto ?comercial|dgo/.test(p)) return 'television';
  return 'otro';
}
