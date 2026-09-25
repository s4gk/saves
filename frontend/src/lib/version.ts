/**
 * Build que tiene cargada ESTA pestaña. `next.config.mjs` la fija al compilar y es
 * la misma que el servidor escribe en `.next/BUILD_ID`.
 */
export const BUILD_ACTUAL = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

/** ¿El servidor ya sirve otra build? `null` si no se pudo saber (red, sesión vencida…). */
export async function hayBuildNueva(): Promise<boolean | null> {
  if (!BUILD_ACTUAL) return null;
  try {
    const res = await fetch(`/version-app?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const { build } = (await res.json()) as { build?: string | null };
    return build ? build !== BUILD_ACTUAL : null;
  } catch {
    return null;
  }
}

const CLAVE_RECARGA = "error:recarga-por-despliegue";

/**
 * Recarga la página, pero como mucho una vez por minuto: si lo que falla no es la
 * build vieja sino la pantalla, recargar en bucle dejaría a la persona sin poder
 * leer el aviso. Devuelve si recargó.
 */
export function recargarUnaVez(): boolean {
  try {
    const ultima = Number(sessionStorage.getItem(CLAVE_RECARGA) ?? 0);
    if (Date.now() - ultima < 60_000) return false;
    sessionStorage.setItem(CLAVE_RECARGA, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
