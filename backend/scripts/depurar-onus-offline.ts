/**
 * Depuración de ONUs offline en las OLT (2026-10-02).
 *
 * Dos pasos, cada uno con su archivo de salida (nunca pipear a `head`: SIGPIPE
 * deja la sesión VTY colgada en la OLT):
 *
 *   leer   → sincroniza TODOS los slots GPON de cada OLT alcanzable hacia
 *            `OltOnu`, corre el auto-vinculador y, de cada ONU offline, lee
 *            `display ont info` (última caída y causa). Solo lectura en la OLT.
 *            Deja el volcado en <archivo.json>.
 *   borrar → toma del volcado las offline de abonados RETIRADO/DEPURADO y las
 *            borra. Antes de cada borrado vuelve a preguntar a la OLT: si la
 *            ONU ya no está offline o el serial cambió, se salta.
 *
 * Uso (desde backend/):
 *   node --env-file=.env -r ts-node/register scripts/depurar-onus-offline.ts leer   <archivo.json> > salida.log 2>&1
 *   node --env-file=.env -r ts-node/register scripts/depurar-onus-offline.ts borrar <archivo.json> > salida.log 2>&1
 *   OLTS=YOPAL,CASIMENA limita las OLT. El borrado respeta el interruptor OLT_LIVE.
 */
import { readFileSync, writeFileSync } from 'fs';
import { PrismaService } from '../src/prisma/prisma.service';
import { OltService } from '../src/network/olt.service';

const ESTADOS_BORRABLES = ['RETIRADO', 'DEPURADO'];

const prisma = new PrismaService();
const svc = new OltService(prisma);
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

async function oltsElegidas() {
  const solo = (process.env.OLTS ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const todas = await prisma.olt.findMany({ orderBy: { name: 'asc' } });
  return todas.filter((o) => (solo.length ? solo.includes(o.name.toUpperCase()) : true));
}

async function offlineDe(oltIds: string[]) {
  return prisma.oltOnu.findMany({
    where: { oltId: { in: oltIds }, syncState: 'presente', runState: { contains: 'offline', mode: 'insensitive' } },
    include: { olt: { select: { name: true } }, subscriber: { select: { id: true, abonado: true, status: true, fullName: true } } },
    orderBy: [{ oltId: 'asc' }, { slot: 'asc' }, { port: 'asc' }, { ontId: 'asc' }],
  });
}

async function leer(archivo: string) {
  const olts = await oltsElegidas();
  const leidas: string[] = [];
  for (const olt of olts) {
    const b = await svc.boards(olt.id, 0, true);
    if (!b.ok) { log(`${olt.name}: NO CONECTA — ${b.error}`); continue; }
    const slots = (b.boards as any[]).filter((x) => x.gpon).map((x) => Number(x.slot));
    log(`${olt.name}: slots GPON ${slots.join(', ') || '(ninguno)'}`);
    let completa = slots.length > 0;
    for (const slot of slots) {
      const r = await svc.syncSlot(olt.id, 0, slot);
      log(`${olt.name} slot ${slot}: ${r.ok ? `${r.synced} ONUs` : `ERROR ${r.error}`}`);
      if (!r.ok) completa = false;
    }
    if (completa) leidas.push(olt.id);
  }

  const link = await svc.autoLinkOnus();
  log(`Auto-vínculo: ${JSON.stringify(link)}`);

  const offline = await offlineDe(leidas);
  log(`Offline en las OLT leídas: ${offline.length}. Leyendo última caída de cada una…`);
  const filas: any[] = [];
  let n = 0;
  for (const o of offline) {
    let det: any = {};
    let error = '';
    if (o.slot !== null && o.port !== null && o.ontId !== null) {
      const r = await svc.ontDetail(o.oltId, o.frame, o.slot, o.port, o.ontId);
      if (r.ok) det = r.detail; else error = r.error;
    }
    filas.push({
      onuId: o.id, oltId: o.oltId, olt: o.olt.name, frame: o.frame, slot: o.slot, port: o.port, ontId: o.ontId,
      sn: o.sn, descripcion: o.description, runState: o.runState,
      lastDown: det.last_down ?? null, lastUp: det.last_up ?? null, causa: det.last_down_cause ?? null, error,
      subscriberId: o.subscriber?.id ?? null, abonado: o.subscriber?.abonado ?? null,
      estado: o.subscriber?.status ?? null, cliente: o.subscriber?.fullName ?? null,
    });
    if (++n % 100 === 0) { log(`  ${n}/${offline.length}`); writeFileSync(archivo, JSON.stringify(filas, null, 1)); }
  }
  writeFileSync(archivo, JSON.stringify(filas, null, 1));
  log(`Volcado: ${archivo} (${filas.length} ONUs offline)`);
}

async function borrar(archivo: string) {
  const modo = await svc.mode();
  log(`Modo OLT: ${modo.mode}`);
  const solo = (process.env.OLTS ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const filas: any[] = JSON.parse(readFileSync(archivo, 'utf8'));
  const candidatas = filas.filter((f) => ESTADOS_BORRABLES.includes(f.estado) && (!solo.length || solo.includes(f.olt.toUpperCase())));
  log(`Candidatas (${ESTADOS_BORRABLES.join('/')}): ${candidatas.length}`);
  const resultado: any[] = [];
  const guardar = () => writeFileSync(archivo.replace(/\.json$/, '') + '-borrado.json', JSON.stringify(resultado, null, 1));
  let fallosSeguidos = 0;
  for (const f of candidatas) {
    const fsp = `${f.olt} ${f.frame}/${f.slot}/${f.port}:${f.ontId} ${f.sn}`;
    // El estado del abonado y la ONU se releen: entre el volcado y el borrado
    // pudo reactivarse el cliente o volver a encender el equipo.
    const sub = await prisma.subscriber.findUnique({ where: { id: f.subscriberId }, select: { status: true } });
    if (!sub || !ESTADOS_BORRABLES.includes(String(sub.status))) {
      log(`SALTA ${fsp}: el abonado ahora está ${sub?.status ?? '(sin abonado)'}`);
      resultado.push({ ...f, resultado: 'saltada', motivo: `abonado ${sub?.status}` }); continue;
    }
    const d = await svc.ontDetail(f.oltId, f.frame, f.slot, f.port, f.ontId);
    const det: any = d.detail;
    if (!d.ok) {
      log(`SALTA ${fsp}: ${d.error}`);
      resultado.push({ ...f, resultado: 'saltada', motivo: d.error });
      if (++fallosSeguidos >= 10) { log('10 fallos seguidos: se detiene.'); break; }
      continue;
    }
    if (String(det.sn ?? '').toUpperCase() !== String(f.sn).toUpperCase() || !/offline/i.test(String(det.run_state ?? ''))) {
      log(`SALTA ${fsp}: en vivo es ${det.sn} / ${det.run_state}`);
      resultado.push({ ...f, resultado: 'saltada', motivo: `en vivo ${det.sn} ${det.run_state}` }); continue;
    }
    const r: any = await svc.remove(f.oltId, { frame: f.frame, slot: f.slot, port: f.port, ont_id: f.ontId, sn: f.sn });
    if (r.ok && !r.dryRun) {
      fallosSeguidos = 0;
      log(`BORRADA ${fsp} · ${f.abonado} ${f.estado} · sp ${(r.servicePorts ?? []).join(',') || '-'}`);
      resultado.push({ ...f, resultado: 'borrada', servicePorts: r.servicePorts ?? [] });
    } else {
      log(`FALLO ${fsp}: ${r.error ?? r.message}`);
      resultado.push({ ...f, resultado: r.dryRun ? 'dry-run' : 'fallo', motivo: r.error ?? r.message });
      if (++fallosSeguidos >= 10) { log('10 fallos seguidos: se detiene.'); break; }
    }
    guardar();
  }
  guardar();
  const cuenta = (k: string) => resultado.filter((x) => x.resultado === k).length;
  log(`FIN: ${cuenta('borrada')} borradas, ${cuenta('saltada')} saltadas, ${cuenta('fallo')} fallos.`);
}

async function main() {
  const [paso, archivo] = process.argv.slice(2);
  if (!['leer', 'borrar'].includes(paso) || !archivo) {
    console.error('Uso: npx ts-node scripts/depurar-onus-offline.ts <leer|borrar> <archivo.json>');
    process.exit(1);
  }
  await prisma.$connect();
  try {
    if (paso === 'leer') await leer(archivo); else await borrar(archivo);
  } finally {
    svc.onModuleDestroy();
    await prisma.$disconnect();
  }
}

for (const sig of ['SIGPIPE', 'SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => { svc.onModuleDestroy(); process.exit(1); });
}
main().catch((e) => { console.error(e); svc.onModuleDestroy(); process.exit(1); });
