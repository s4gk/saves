/**
 * Borra de las OLT las ONUs OFFLINE de abonados RETIRADOS/DEPURADOS y las que no
 * tienen abonado vinculado (pedido de soporte 2026-10-06).
 *
 *   npx ts-node scripts/limpiar-onus-offline.ts            → sincroniza y LISTA (no borra)
 *   npx ts-node scripts/limpiar-onus-offline.ts --ejecutar → además borra
 *   OLTS=YOPAL,CASIMENA limita las OLT.
 *   --reemplazadas → en vez de lo anterior, toma las OFFLINE de abonados que
 *                    tienen OTRA ONU online a su nombre (equipo cambiado: el
 *                    viejo quedó en la OLT aunque el cliente siga activo).
 *                    Pedido 2026-10-06, caso 57087 YOPAL 0/1/8:43 vs :45.
 *
 * Por OLT: sincroniza todos sus slots GPON (estado fresco), elige candidatas, y
 * antes de cada borrado relee `display ont info` en vivo: si el SN no coincide
 * o ya no está offline, la salta. Cada ONU borrada queda respaldada (detalle +
 * service-ports) en scripts/_respaldo-onus-offline-<fecha>.json.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import { oltService, prismaService } from '../src/core/contenedor';

const EJECUTAR = process.argv.includes('--ejecutar');
const REEMPLAZADAS = process.argv.includes('--reemplazadas');
const ESTADOS_BORRABLES = ['RETIRADO', 'DEPURADO'];
const RESPALDO = `${__dirname}/_respaldo-onus-${REEMPLAZADAS ? 'reemplazadas' : 'offline'}-${new Date().toISOString().slice(0, 10)}.json`;

async function main() {
  const prisma = prismaService;
  const solo = (process.env.OLTS ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  const olts = (await prisma.olt.findMany({ select: { id: true, name: true } }))
    .filter((o) => !solo.length || solo.includes(o.name.toUpperCase()));
  const respaldo: any[] = fs.existsSync(RESPALDO) ? JSON.parse(fs.readFileSync(RESPALDO, 'utf8')) : [];
  const guardar = () => fs.writeFileSync(RESPALDO, JSON.stringify(respaldo, null, 2));
  const resumen: any[] = [];

  for (const olt of olts) {
    const inicio = new Date();
    const b = await oltService.boards(olt.id, 0, true);
    if (!b.ok) { console.log(`✗ ${olt.name}: sin conexión (${b.error})`); resumen.push({ olt: olt.name, error: b.error }); continue; }
    const slots = (b.boards as any[]).filter((x) => x.gpon).map((x) => Number(x.slot));
    let syncOk = true;
    for (const s of slots) {
      const r = await oltService.syncSlot(olt.id, 0, s);
      console.log(`  ${olt.name} sync slot ${s}: ${r.ok ? r.synced + ' ONUs' : 'ERROR ' + r.error}`);
      if (!r.ok) syncOk = false;
    }
    if (!syncOk) { console.log(`✗ ${olt.name}: sync incompleto, no se borra nada en esta OLT`); resumen.push({ olt: olt.name, error: 'sync incompleto' }); continue; }

    // Con --reemplazadas: el abonado tiene otra ONU (de cualquier OLT) presente
    // y online con otro serial — esa es la que usa; la offline sobra.
    const ids = REEMPLAZADAS
      ? (await prisma.$queryRaw<{ id: string }[]>`
          SELECT u.id FROM "OltOnu" u
          WHERE u."oltId" = ${olt.id} AND u."syncState" = 'presente' AND u."runState" = 'offline'
            AND u."lastSync" >= ${inicio.toISOString().slice(0, 23).replace('T', ' ')}::timestamp AND u."subscriberId" IS NOT NULL
            AND EXISTS (SELECT 1 FROM "OltOnu" v WHERE v."subscriberId" = u."subscriberId" AND v.id <> u.id
                        AND v."syncState" = 'presente' AND v."runState" = 'online' AND upper(v.sn) <> upper(u.sn))`).map((x) => x.id)
      : null;
    const todas = await prisma.oltOnu.findMany({
      where: ids
        ? { id: { in: ids } }
        : {
            oltId: olt.id, syncState: 'presente', runState: 'offline', lastSync: { gte: inicio },
            OR: [{ subscriberId: null }, { subscriber: { status: { in: ESTADOS_BORRABLES as any } } }],
          },
      select: { id: true, sn: true, slot: true, port: true, ontId: true, frame: true, description: true, clientName: true, rxPower: true,
        subscriber: { select: { abonado: true, fullName: true, status: true } } },
      orderBy: [{ slot: 'asc' }, { port: 'asc' }, { ontId: 'asc' }],
    });
    // En --reemplazadas el abonado sigue con servicio: solo se borra si la
    // descripción de la ONU vieja nombra a ESE abonado (empieza por su número).
    // Un vínculo dudoso (p. ej. 63806 ↔ «3575Odilio», 52084 ↔ «xxx») se deja.
    const dudosas = REEMPLAZADAS
      ? todas.filter((c) => !new RegExp(`^\\s*${c.subscriber?.abonado}(?!\\d)`).test(c.description ?? c.clientName ?? ''))
      : [];
    for (const c of dudosas) console.log(`  ? dudosa (no se toca) ${c.frame}/${c.slot}/${c.port}:${c.ontId} ${c.sn} · abonado ${c.subscriber?.abonado} · «${c.description ?? ''}»`);
    const cands = todas.filter((c) => !dudosas.includes(c));
    const sinVinc = cands.filter((c) => !c.subscriber).length;
    console.log(REEMPLAZADAS
      ? `● ${olt.name}: ${cands.length} candidatas (abonado con otra ONU online)`
      : `● ${olt.name}: ${cands.length} candidatas (${cands.length - sinVinc} retirado/depurado, ${sinVinc} sin vincular)`);
    if (REEMPLAZADAS) for (const c of cands) console.log(`    ${c.frame}/${c.slot}/${c.port}:${c.ontId} ${c.sn} · ${c.subscriber?.abonado} ${c.subscriber?.status} · ${c.description ?? ''}`);
    const r = { olt: olt.name, candidatas: cands.length, borradas: 0, saltadas: 0, errores: 0 };
    resumen.push(r);
    if (!EJECUTAR) continue;

    for (const c of cands) {
      const fsp = `${c.frame}/${c.slot}/${c.port}:${c.ontId}`;
      const det = await oltService.ontDetail(olt.id, c.frame, c.slot!, c.port!, c.ontId!);
      const d: any = det.detail ?? {};
      const snVivo = String(d.sn ?? d.ont_sn ?? '').toUpperCase();
      const runVivo = String(d.run_state ?? '').toLowerCase();
      if (!det.ok || !snVivo.startsWith(String(c.sn).toUpperCase()) || runVivo !== 'offline') {
        r.saltadas++;
        console.log(`  – salto ${fsp} ${c.sn}: ${!det.ok ? det.error : `en vivo sn=${snVivo} estado=${runVivo}`}`);
        continue;
      }
      const res: any = await oltService.remove(olt.id, { frame: c.frame, slot: c.slot, port: c.port, ont_id: c.ontId, sn: c.sn });
      respaldo.push({ olt: olt.name, oltId: olt.id, fsp, sn: c.sn, abonado: c.subscriber?.abonado ?? null, cliente: c.subscriber?.fullName ?? c.clientName,
        estadoCliente: c.subscriber?.status ?? 'SIN_VINCULAR', descripcion: c.description, rx: c.rxPower,
        detalle: d, servicePorts: res.servicePorts ?? [], ok: !!res.ok, error: res.error ?? null, cuando: new Date().toISOString() });
      guardar();
      if (res.ok) r.borradas++; else { r.errores++; console.log(`  ✗ ${fsp} ${c.sn}: ${res.error}`); }
      if ((r.borradas + r.errores) % 25 === 0) console.log(`  … ${olt.name}: ${r.borradas} borradas`);
    }
  }
  console.table(resumen);
  console.log(EJECUTAR ? `Respaldo: ${RESPALDO}` : 'Modo lista: no se borró nada. Repetir con --ejecutar.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
