"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { hayBuildNueva } from "@/lib/version";

const CADA = 5 * 60_000;

/**
 * Evita que una pestaña abierta desde ANTES de un despliegue siga usando la build
 * vieja. Esa pestaña pide trozos de JS que ya no existen y cae en "Algo se rompió
 * en esta pantalla" aunque la pantalla esté sana: por eso le salía a unos y a otros
 * no (sólo a quien no había recargado).
 *
 * Pregunta al servidor qué build sirve (cada 5 min y al volver a la pestaña). Si
 * cambió, NO recarga en el acto —perdería lo que la persona esté escribiendo—, sino
 * en la siguiente navegación: ya se está yendo de la pantalla, así que el cambio de
 * página se hace completo y trae la build nueva.
 */
export function VersionGuard() {
  const pathname = usePathname();
  const nueva = useRef(false);
  const primera = useRef(true);

  useEffect(() => {
    const revisar = () => {
      if (document.visibilityState !== "visible" || nueva.current) return;
      hayBuildNueva().then((s) => {
        if (s) nueva.current = true;
      });
    };
    const id = window.setInterval(revisar, CADA);
    document.addEventListener("visibilitychange", revisar);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", revisar);
    };
  }, []);

  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    if (nueva.current) window.location.reload();
  }, [pathname]);

  return null;
}
