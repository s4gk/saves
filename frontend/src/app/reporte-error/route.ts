import { NextResponse, type NextRequest } from "next/server";
import { TOKEN_COOKIE } from "@/lib/auth";

/**
 * Recibe los errores que tumban una pantalla en el NAVEGADOR ("Algo se rompió en
 * esta pantalla") y los deja en el log de `saves-frontend` con la etiqueta
 * `[ErrorPantalla]`. Antes esos errores sólo existían en la consola del navegador
 * de quien los sufría: no había forma de saber qué pantalla fallaba ni a quién.
 *
 *   pm2 logs saves-frontend --err --nostream --lines 500 | grep ErrorPantalla
 */
export async function POST(req: NextRequest) {
  let cuerpo: Record<string, unknown> = {};
  try {
    cuerpo = await req.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const corto = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

  console.error(
    "[ErrorPantalla]",
    JSON.stringify({
      usuario: quien(req.cookies.get(TOKEN_COOKIE)?.value),
      ruta: corto(cuerpo.ruta, 300),
      mensaje: corto(cuerpo.mensaje, 500),
      digest: corto(cuerpo.digest, 50),
      build: corto(cuerpo.build, 50),
      recargado: cuerpo.recargado === true,
      pila: corto(cuerpo.pila, 1500),
      navegador: req.headers.get("user-agent")?.slice(0, 200),
    }),
  );
  return new NextResponse(null, { status: 204 });
}

/** Correo del token sin verificar la firma: sólo sirve para el log. */
function quien(token: string | undefined): string | undefined {
  try {
    const payload = token?.split(".")[1];
    if (!payload) return undefined;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return json.email ?? json.name ?? json.id;
  } catch {
    return undefined;
  }
}
