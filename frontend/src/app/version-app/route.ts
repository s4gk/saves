import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

// Dice qué build está sirviendo el servidor. `VersionGuard` lo compara con la build
// que tiene cargada la pestaña: si difieren, la pestaña es de antes de un despliegue.
// Se lee `.next/BUILD_ID` del disco (la verdad de lo desplegado) y no una variable,
// porque `next start` vuelve a evaluar next.config.mjs y la regeneraría.
export const dynamic = "force-dynamic";

let build: string | null = null;

export function GET() {
  try {
    build ??= readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    /* sin archivo: el cliente no compara */
  }
  return NextResponse.json({ build }, { headers: { "Cache-Control": "no-store" } });
}
