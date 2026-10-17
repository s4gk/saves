/**
 * Router → ficha: qué cambió en el `/ppp/secret` y hay que traer a la ficha.
 *
 * Hasta 2026-10-17 los datos de conexión viajaban en un solo sentido: la ficha se
 * llevaba al router (`conciliarSecret`) y lo que alguien cambiara en Winbox nunca
 * volvía. Caso que lo destapó: abonada 57372 (Tauramena). En el router le pusieron
 * 10.30.0.1 / 10.30.1.3 y la ficha siguió con 10.100.0.1 / 80.0.9.206. Peor
 * todavía: el siguiente guardado de la ficha habría devuelto al router las IPs viejas.
 *
 * Comparar router contra ficha no dice QUIÉN cambió. Para eso se guarda la última
 * foto del secret que vimos (`SecretEnRouter`) y se hace una fusión a tres bandas:
 *
 *   router = foto, ficha ≠ foto → cambió la ficha: lo lleva el guardado o el barrido.
 *   router ≠ foto, ficha = foto → cambió el router: se trae a la ficha.
 *   router ≠ foto, ficha ≠ foto → cambiaron los dos: gana el router, porque es lo que
 *                                  tiene navegando al cliente. Se anota como conflicto.
 *
 * Nunca se trae un valor VACÍO del router: un secret sin comentario o sin IP no es
 * una orden de borrar el dato de la ficha, y una clave vacía no autentica a nadie.
 */
import type { SnapshotConexion } from './mikrotik.service';

export type CampoFicha = keyof SnapshotConexion;

export const CAMPOS_DEL_SECRET: readonly { prop: string; campo: CampoFicha; etiqueta: string }[] = [
  { prop: 'name', campo: 'pppUsername', etiqueta: 'usuario PPP' },
  { prop: 'password', campo: 'pppPassword', etiqueta: 'clave PPP' },
  { prop: 'profile', campo: 'pppProfile', etiqueta: 'perfil' },
  { prop: 'remote-address', campo: 'ipRemote', etiqueta: 'IP remota' },
  { prop: 'local-address', campo: 'ipLocal', etiqueta: 'IP local' },
  { prop: 'comment', campo: 'netComment', etiqueta: 'comentario' },
];

/** Lo que se guarda de cada secret: sólo las propiedades que tienen campo en la ficha. */
export type FotoSecret = Record<string, string>;

const norm = (v?: string | null) => (v ?? '').trim();
/** `-`, vacío, «Seleccione...», `0`: lo que el legacy guardaba cuando no había perfil. */
export const esPerfilDeRelleno = (v: string) => !/[a-z0-9]{2,}/i.test(v) || /^selecci/i.test(v);
const esIp = (v: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v);

/** El usuario se compara como lo hace el resto del módulo: sin espacios ni mayúsculas. */
function iguales(prop: string, a: string, b: string): boolean {
  if (prop === 'name') return a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();
  return a === b;
}

export function fotoDe(secret: Record<string, string | undefined>): FotoSecret {
  const foto: FotoSecret = {};
  for (const { prop } of CAMPOS_DEL_SECRET) foto[prop] = norm(secret[prop]);
  return foto;
}

export interface Fusion {
  /** Campos que hay que escribir en la ficha (con el valor del router). */
  aFicha: Partial<Record<CampoFicha, string>>;
  /** Legible: «IP remota 80.0.9.206 → 10.30.1.3». */
  detalle: string[];
  /** Cambiados en la ficha y no en el router: pendientes de llevar allá. */
  pendientesAlRouter: CampoFicha[];
  /** Cambiaron los dos lados; ganó el router. */
  conflictos: CampoFicha[];
}

/**
 * @param base  la última foto del secret, o `null` si nunca se leyó.
 * @param sinFoto qué hacer cuando no hay foto (primera lectura): `'router'` trae lo
 *   del router (es lo que funciona); `'nada'` sólo deja la foto como base.
 */
export function fusionarSecret(
  ficha: SnapshotConexion,
  router: Record<string, string | undefined>,
  base: FotoSecret | null,
  sinFoto: 'router' | 'nada' = 'nada',
): Fusion {
  const out: Fusion = { aFicha: {}, detalle: [], pendientesAlRouter: [], conflictos: [] };
  for (const { prop, campo, etiqueta } of CAMPOS_DEL_SECRET) {
    const r = norm(router[prop]);
    const f = norm(ficha[campo]);
    if (iguales(prop, r, f)) continue;
    if (!r) {
      if (base && iguales(prop, r, norm(base[prop]))) out.pendientesAlRouter.push(campo);
      continue;
    }
    if ((prop === 'remote-address' || prop === 'local-address') && !esIp(r)) continue;

    let traer = false;
    if (!base) {
      // Primera lectura: no se sabe quién cambió. Se trae lo del router (es lo que
      // funciona), salvo un perfil REAL distinto: ahí la ficha puede tener el plan
      // bueno y el router uno viejo, y eso lo decide una persona. Un perfil de
      // relleno del legacy («-», «Seleccione...») sí se completa.
      traer = sinFoto === 'router'
        && (prop !== 'profile' || esPerfilDeRelleno(f) || f.toLowerCase() === r.toLowerCase());
    } else {
      const b = norm(base[prop]);
      const cambioRouter = !iguales(prop, r, b);
      const cambioFicha = !iguales(prop, f, b);
      if (!cambioRouter) out.pendientesAlRouter.push(campo);
      else {
        traer = true;
        if (cambioFicha) out.conflictos.push(campo);
      }
    }
    if (!traer) continue;
    out.aFicha[campo] = r;
    const mostrar = (v: string) => (prop === 'password' ? '••••' : v || '(vacío)');
    out.detalle.push(`${etiqueta} ${mostrar(f)} → ${mostrar(r)}`);
  }
  return out;
}
