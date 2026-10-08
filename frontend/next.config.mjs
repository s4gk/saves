/** @type {import('next').NextConfig} */
// Identidad de la build: la misma cadena va a `.next/BUILD_ID` y a la variable que
// lleva el navegador. `VersionGuard` las compara (vía `/version-app`, que lee el
// BUILD_ID del disco) para saber si la pestaña quedó vieja tras un despliegue.
// `next build` evalúa este archivo varias veces y en procesos hijos: se guarda en el
// entorno la primera vez para que todas las evaluaciones den la MISMA cadena.
process.env.NEXT_PUBLIC_BUILD_ID ??= `b${Date.now().toString(36)}`;
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID;

const nextConfig = {
  // `NEXT_DIST_DIR=.next-build` compila en una carpeta aparte mientras el servidor
  // sigue sirviendo `.next`; después se cambian las carpetas con el proceso parado
  // unos segundos. Compilar encima de `.next` en caliente lo corrompe, y pararlo
  // durante todo el build deja el sistema caído varios minutos.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  generateBuildId: async () => BUILD_ID,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  reactStrictMode: true,
  // El build VALIDA TIPOS. Antes llevaba `typescript.ignoreBuildErrors: true` por
  // picos de memoria que mataban el build en esta máquina; medido el 2026-07-20, ya
  // no ocurre: 52 s y 1 GB de pico con el chequeo activado. Con `cpus: 1` y
  // `workerThreads: false` el consumo se mantiene acotado.
  // Máquina compartida de 16 núcleos: limitar los workers de generación de páginas
  // evita el pico de memoria que el OOM-killer usaba para matar el build.
  // optimizePackageImports: adelgaza el registro central de iconos (lucide-react).
  experimental: { cpus: 1, workerThreads: false, optimizePackageImports: ["lucide-react"] },
  // Mikrotik dejó de ser parte de /red y tiene módulo propio (2026-07-15). Estos
  // redirects sostienen los enlaces guardados/compartidos de la ruta anterior.
  async redirects() {
    return [
      { source: "/red/mikrotik", destination: "/mikrotik", permanent: true },
      { source: "/red/mikrotik/:id", destination: "/mikrotik/:id", permanent: true },
      { source: "/red/masivo", destination: "/mikrotik/masivo", permanent: true },
      { source: "/red/ips", destination: "/mikrotik/ips", permanent: true },
      // Empleados pasó a CONFIGURACIÓN y Documentos a PERSONAS / PROYECTOS
      // (2026-08-05). `:path*` cubre la ficha (/empleados/7) y Móviles.
      { source: "/empleados", destination: "/configuracion/empleados", permanent: true },
      // "Móviles / cuadrillas" se retiró del sistema (2026-08-05): su enlace guardado
      // cae en el listado de empleados, no en un 404. Va ANTES del `:path*`.
      { source: "/empleados/moviles", destination: "/configuracion/empleados", permanent: true },
      { source: "/configuracion/empleados/moviles", destination: "/configuracion/empleados", permanent: true },
      { source: "/empleados/:path*", destination: "/configuracion/empleados/:path*", permanent: true },
      { source: "/configuracion/documentos", destination: "/documentos", permanent: true },
    ];
  },
  // Metabase (análisis de datos, pm2 `saves-metabase`, solo escucha en 127.0.0.1:3125)
  // se sirve por aquí para que herede el HTTPS del dominio sin tocar Apache. Pasa
  // primero por el middleware: solo entra quien tenga sesión con área de gerencia, y
  // después Metabase pide su propio login. MB_SITE_URL = https://app.saves.com.co/analitica.
  async rewrites() {
    return [
      { source: "/analitica", destination: "http://127.0.0.1:3125/" },
      { source: "/analitica/:path*", destination: "http://127.0.0.1:3125/:path*" },
    ];
  },
};

export default nextConfig;
