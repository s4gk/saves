/**
 * Pasada a mano de `PortalPagosService.recogerAprobadosTardios`: los pagos que Wompi
 * aprobó en un REINTENTO y el portal dejó por rechazados.
 *
 * El cron la corre cada 5 minutos sobre los últimos `PORTAL_WS_RESCATE_DIAS` días; esto
 * es para mirar (o recoger) una ventana más larga. En SECO por defecto.
 *
 *   npx ts-node --transpile-only scripts/rescatar-aprobados-tardios.ts [--dias=10]
 *   npx ts-node --transpile-only scripts/rescatar-aprobados-tardios.ts --dias=10 --aplicar
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';

for (const linea of (() => { try { return fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n'); } catch { return []; } })()) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

import { portalPagosService } from '../src/core/contenedor';

const arg = (n: string, d: string) =>
  (process.argv.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split('=')[1];
const DIAS = Number(arg('dias', '10'));
const APLICAR = process.argv.includes('--aplicar');

async function main() {
  console.log(`\n=== Aprobados en un reintento · últimos ${DIAS} días · ${APLICAR ? 'APLICAR' : 'SIMULACIÓN'} ===\n`);
  const r = await portalPagosService.recogerAprobadosTardios({ dias: DIAS, dryRun: !APLICAR });
  for (const d of r.detalle) console.log(`  ${d}`);
  console.log(
    `\nRevisados ${r.revisadas} · aplicados ${r.aplicadas} · por revisar ${r.porRevisar} · con error ${r.fallidas}\n`,
  );
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
