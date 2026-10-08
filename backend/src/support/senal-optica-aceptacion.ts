/**
 * CRITERIO DE ACEPTACIÓN DE LA SEÑAL ÓPTICA para autenticar una ONU desde la orden.
 *
 * Sale del protocolo técnico de VESTEL, punto 4.5 «Pruebas de señal y criterios de
 * aceptación» (pedido del usuario, 2026-09-25). Se mide la potencia que RECIBE la
 * ONU (`Rx optical power(dBm)` de `display ont optical-info`):
 *
 *   -15,00 a -24,00 dBm  Óptimo    → aprobar y proceder con el aprovisionamiento.
 *   -25,00 a -27,00 dBm  Marginal  → revisar limpieza, macrocurvaturas y estrangulamientos.
 *   peor que -28,00 dBm  Crítico   → rehacer conector, revisar empalmes o cambiar el drop.
 *
 * Decisiones que la tabla no cubre (tomadas con el usuario el mismo día):
 *  · SOLO el Óptimo autentica: el Marginal también se rechaza, porque el protocolo
 *    solo dice «proceder con el aprovisionamiento» en el Óptimo.
 *  · Los huecos entre franjas (-24,01…-24,99 y -27,01…-28,00) no son Óptimos: van
 *    como Marginal. Crítico es estrictamente peor que -28.
 *  · Más fuerte que -15 dBm (p. ej. -10) cuenta como Marginal: «señal muy alta».
 *  · Sin lectura (ONU offline, la OLT no responde) tampoco es Óptimo: no se aprueba
 *    lo que no se midió.
 *  · El superadministrador puede forzar cualquier rechazo con un motivo escrito,
 *    que queda en las notas de la orden.
 */
export const RX_OPTIMO_MAX = -15;
export const RX_OPTIMO_MIN = -24;
export const RX_CRITICO_BAJO = -28;

export type NivelSenal = 'OPTIMO' | 'MARGINAL' | 'CRITICO' | 'SIN_LECTURA';

export interface EvaluacionSenal {
  nivel: NivelSenal;
  /** Potencia que recibe la ONU, en dBm (null si no se pudo leer). */
  rx: number | null;
  aprobada: boolean;
  etiqueta: string;
  /** Qué tiene que hacer el técnico, tal como lo dice el protocolo. */
  accion: string;
}

export function evaluarSenalRx(rx: number | null | undefined): EvaluacionSenal {
  if (rx === null || rx === undefined || !Number.isFinite(rx)) {
    return {
      nivel: 'SIN_LECTURA', rx: null, aprobada: false, etiqueta: 'Sin lectura',
      accion: 'No se pudo medir la potencia que recibe la ONU. Verifique que esté encendida y con la fibra conectada, y vuelva a intentar.',
    };
  }
  if (rx < RX_CRITICO_BAJO) {
    return {
      nivel: 'CRITICO', rx, aprobada: false, etiqueta: 'Crítico / Rechazado',
      accion: 'Rehacer conector, revisar empalmes o cambiar el drop si está dañado.',
    };
  }
  if (rx > RX_OPTIMO_MAX) {
    return {
      nivel: 'MARGINAL', rx, aprobada: false, etiqueta: 'Marginal (señal muy alta)',
      accion: `La señal está por encima de ${RX_OPTIMO_MAX} dBm: revise la atenuación del tramo antes de autenticar.`,
    };
  }
  if (rx < RX_OPTIMO_MIN) {
    return {
      nivel: 'MARGINAL', rx, aprobada: false, etiqueta: 'Marginal',
      accion: 'Revisar limpieza, macrocurvaturas y estrangulamientos.',
    };
  }
  return { nivel: 'OPTIMO', rx, aprobada: true, etiqueta: 'Óptimo', accion: 'Aprobar y proceder con el aprovisionamiento.' };
}

/** "-21.35 dBm" con coma decimal, como se lee en campo. */
export function dbmTexto(rx: number | null): string {
  return rx === null ? 'sin lectura' : `${rx.toFixed(2).replace('.', ',')} dBm`;
}

export const RANGO_OPTIMO_TEXTO = `${RX_OPTIMO_MAX} a ${RX_OPTIMO_MIN} dBm`;
