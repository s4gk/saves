"use client";

import { useEffect } from "react";
import { BUILD_ACTUAL, recargarUnaVez } from "@/lib/version";

/**
 * Última red: atrapa lo que revienta en el layout raíz (menú, sesión, avisos), que
 * `error.tsx` no alcanza. Sin ella esa falla dejaba la pantalla en blanco. Reemplaza
 * al layout entero, así que no puede usar ni los estilos ni los componentes de la app.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("Error no controlado en el marco de la app:", error);
    fetch("/reporte-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        ruta: window.location.pathname + window.location.search,
        mensaje: `[marco] ${error?.message ?? ""}`,
        digest: error?.digest,
        pila: error?.stack,
        build: BUILD_ACTUAL,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h2 style={{ fontSize: 16 }}>Algo se rompió al cargar el sistema</h2>
          <p style={{ fontSize: 13, color: "#586576" }}>Recarga la página. Si vuelve a pasar, avisa a sistemas.</p>
          <button
            type="button"
            onClick={() => {
              if (!recargarUnaVez()) window.location.reload();
            }}
            style={{ marginTop: 12, padding: "8px 16px", fontSize: 13, borderRadius: 8, border: "1px solid #ccc", cursor: "pointer" }}
          >
            Recargar
          </button>
        </div>
      </body>
    </html>
  );
}
