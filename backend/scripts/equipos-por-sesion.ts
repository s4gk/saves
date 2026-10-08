/**
 * Clientes que NAVEGAN y no tienen equipo asignado: qué aparato tienen de verdad.
 *
 * La sesión PPPoE de cada cliente trae en `caller-id` la MAC del aparato que está
 * en su casa. Se cruza con el inventario (`Equipment.mac`) y sale, por cliente, el
 * equipo que habría que ponerle a su nombre.
 *
 * A los routers sólo se les manda `/ppp/active/print`. Por defecto en la base no se
 * escribe nada: deja el detalle en un CSV, con la columna `accion` diciendo qué haría.
 *
 * Con `--aplicar` asigna los LIMPIOS, con la misma escritura que la asignación desde
 * la ficha (`SupportWriteService.asignarEquipos`): dueño, `assignedRaw` con el id
 * legacy —sin él el writeback deshace la asignación—, `editedAt`, estado "Asignado"
 * y la MAC en la ficha. Limpio = MAC exacta, equipo libre y sin reserva, que no lo
 * reclame otro cliente, cliente no retirado y equipo que no esté dado de baja
 * (bodega Depurados / estado Malo o Depurado). Lo demás queda en el CSV para revisar.
 * Antes de escribir guarda el estado anterior en `<salida>.respaldo.json`.
 *
 *   npx ts-node --transpile-only scripts/equipos-por-sesion.ts [salida.csv] [--aplicar]
 */
import { writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { RouterosClient } from '../src/network/routeros/routeros-client';
import { decryptSecret } from '../src/common/secret-box';

const prisma = new PrismaClient();
const soloHex = (v: string | null | undefined) => (v ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
const usuario = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, '').toLowerCase();
/** La MAC WAN de una ONU suele ser la de la etiqueta más unos pocos. */
const VECINDAD = 8;

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--aplicar');
  const salida = args.find((a) => !a.startsWith('--')) ?? 'equipos-por-sesion.csv';

  // 1. Sesiones activas, una vez por IP:puerto (EPON y EOC pueden ser el mismo router).
  const routers = await prisma.mikrotik.findMany({ orderBy: { name: 'asc' } });
  const sesiones = new Map<string, { mac: string; router: string }[]>();
  const vistos = new Set<string>();
  for (const r of routers) {
    const k = `${r.ip}:${r.port}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    const api = new RouterosClient();
    try {
      await api.connect(r.ip, Number(r.port), r.username, decryptSecret(r.password), { timeoutMs: 10000 });
      const act = await api.comm('/ppp/active/print', { '.proplist': 'name,caller-id' });
      let n = 0;
      for (const a of act) {
        const mac = soloHex(a['caller-id']);
        if (mac.length !== 12) continue;
        const u = usuario(a['name']);
        sesiones.set(u, [...(sesiones.get(u) ?? []), { mac, router: r.name }]);
        n++;
      }
      console.log(`${r.name.padEnd(28)} ${String(n).padStart(5)} sesiones`);
    } catch (e: any) {
      console.log(`${r.name.padEnd(28)} SIN RESPUESTA: ${e?.message ?? e}`);
    } finally {
      api.close();
    }
  }

  // 2. Inventario por MAC.
  const equipos = await prisma.equipment.findMany({
    select: {
      id: true, code: true, mac: true, serial: true, brand: true, status: true, subscriberId: true,
      assignedRaw: true, endDate: true, returnedAt: true, editedAt: true, reservedTicketId: true,
      warehouse: { select: { name: true } },
      subscriber: { select: { abonado: true } },
    },
  });
  const porMac = new Map<string, typeof equipos>();
  for (const e of equipos) {
    const m = soloHex(e.mac);
    if (m.length !== 12) continue;
    porMac.set(m, [...(porMac.get(m) ?? []), e]);
  }
  const conEquipo = new Set(equipos.map((e) => e.subscriberId).filter(Boolean) as string[]);

  // 3. Abonados con sesión y sin equipo.
  const subs = await prisma.subscriber.findMany({
    where: { pppUsername: { not: null } },
    select: { id: true, legacyId: true, abonado: true, fullName: true, pppUsername: true, status: true, macEquipo: true, branch: { select: { name: true } } },
  });
  const filas: string[][] = [];
  const candidatos: { fila: string[]; sub: (typeof subs)[number]; eq: (typeof equipos)[number] }[] = [];
  const cuenta: Record<string, number> = {};
  const porSede: Record<string, Record<string, number>> = {};
  let navegando = 0;
  for (const s of subs) {
    const ses = sesiones.get(usuario(s.pppUsername));
    if (!ses) continue;
    navegando++;
    if (conEquipo.has(s.id)) continue;
    const { mac, router } = ses[0];

    let caso: string;
    let eq: (typeof equipos)[number] | undefined;
    let salto = 0;
    const exactos = porMac.get(mac) ?? [];
    let cand = exactos;
    if (!cand.length) {
      const base = BigInt(`0x${mac}`);
      for (let d = 1; d <= VECINDAD && !cand.length; d++) {
        for (const sg of [-1, 1]) {
          const v = (base + BigInt(sg * d)).toString(16).toUpperCase().padStart(12, '0');
          if (porMac.has(v)) { cand = porMac.get(v)!; salto = sg * d; break; }
        }
      }
    }
    if (!cand.length) caso = 'NO_ESTA_EN_INVENTARIO';
    else if (cand.length > 1) { caso = 'MAC_REPETIDA_EN_INVENTARIO'; eq = cand[0]; }
    else {
      eq = cand[0];
      if (eq.subscriberId) caso = 'ASIGNADO_A_OTRO_CLIENTE';
      else caso = salto ? 'LIBRE_MAC_VECINA' : 'LIBRE_MAC_EXACTA';
    }
    if (ses.length > 1) caso += '+VARIAS_SESIONES';
    cuenta[caso] = (cuenta[caso] ?? 0) + 1;
    const sede = s.branch?.name ?? '(sin sede)';
    (porSede[sede] ??= {})[caso] = (porSede[sede][caso] ?? 0) + 1;

    const macFmt = mac.match(/../g)!.join(':');
    const fila = [
      String(s.abonado ?? ''), s.fullName ?? '', sede, String(s.status ?? ''), s.pppUsername ?? '', router, macFmt,
      s.macEquipo ?? '', caso, String(salto || ''), eq ? String(eq.code) : '', eq?.mac ?? '', eq?.serial ?? '',
      eq?.brand ?? '', eq?.status ?? '', eq?.warehouse?.name ?? '', eq?.subscriber?.abonado ? String(eq.subscriber.abonado) : '',
      'REVISAR',
    ];
    filas.push(fila);
    if (caso === 'LIBRE_MAC_EXACTA' && eq) candidatos.push({ fila, sub: s, eq });
  }

  // 4. De los de MAC exacta y equipo libre, cuáles son limpios.
  const reclamos = new Map<string, number>();
  for (const c of candidatos) reclamos.set(c.eq.id, (reclamos.get(c.eq.id) ?? 0) + 1);
  const limpios: typeof candidatos = [];
  const motivos: Record<string, number> = {};
  for (const c of candidatos) {
    const baja = /depurad/i.test(c.eq.warehouse?.name ?? '') || /^(malo|depurado)$/i.test(c.eq.status ?? '');
    const motivo =
      (reclamos.get(c.eq.id) ?? 0) > 1 ? 'REVISAR: dos fichas con el mismo usuario PPP'
      : String(c.sub.status) === 'RETIRADO' ? 'REVISAR: cliente RETIRADO navegando'
      : c.eq.reservedTicketId || /^reservado$/i.test(c.eq.status ?? '') ? 'REVISAR: equipo reservado para una orden'
      : /^asignado$/i.test(c.eq.status ?? '') ? 'REVISAR: equipo "Asignado" sin dueño'
      : baja ? 'REVISAR: equipo dado de baja (Depurados/Malo)'
      : c.sub.legacyId == null ? 'REVISAR: cliente sin id legacy'
      : '';
    if (motivo) { c.fila[c.fila.length - 1] = motivo; motivos[motivo] = (motivos[motivo] ?? 0) + 1; }
    else { c.fila[c.fila.length - 1] = 'ASIGNAR'; limpios.push(c); }
  }

  // 5. Asignar.
  let hechos = 0;
  if (aplicar && limpios.length) {
    writeFileSync(`${salida}.respaldo.json`, JSON.stringify(limpios.map((c) => ({
      equipo: { id: c.eq.id, code: c.eq.code, subscriberId: c.eq.subscriberId, assignedRaw: c.eq.assignedRaw, status: c.eq.status,
        endDate: c.eq.endDate, returnedAt: c.eq.returnedAt, editedAt: c.eq.editedAt },
      cliente: { id: c.sub.id, abonado: c.sub.abonado, macEquipo: c.sub.macEquipo },
    })), null, 2));
    // Hoy en Colombia, como fecha sin hora (ver `sql-crudo-fechas-date`).
    const hoy = new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })}T00:00:00Z`);
    for (const c of limpios) {
      const ok = await prisma.$transaction(async (tx) => {
        // Sólo si sigue libre y el cliente sigue sin equipo: entre el informe y la
        // escritura alguien pudo asignarlo a mano.
        if (await tx.equipment.count({ where: { subscriberId: c.sub.id } })) return false;
        const r = await tx.equipment.updateMany({
          where: { id: c.eq.id, subscriberId: null, reservedTicketId: null },
          data: {
            subscriberId: c.sub.id, assignedRaw: String(c.sub.legacyId), status: 'Asignado',
            endDate: hoy, returnedAt: null, editedAt: new Date(),
          },
        });
        if (!r.count) return false;
        await tx.subscriber.update({ where: { id: c.sub.id }, data: { macEquipo: c.eq.mac!.trim() } });
        return true;
      });
      if (ok) { hechos++; c.fila[c.fila.length - 1] = 'ASIGNADO'; }
      else c.fila[c.fila.length - 1] = 'REVISAR: cambió mientras corría';
    }
  }

  const cab = ['abonado', 'nombre', 'sede', 'estado', 'usuario_ppp', 'router', 'mac_sesion', 'mac_en_ficha', 'caso', 'salto_mac',
    'equipo_codigo', 'equipo_mac', 'equipo_serial', 'equipo_marca', 'equipo_estado', 'equipo_bodega', 'equipo_abonado_actual', 'accion'];
  const csv = [cab, ...filas].map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  writeFileSync(salida, csv);

  console.log(`\nAbonados con sesión activa: ${navegando}`);
  console.log(`  de ellos SIN equipo asignado: ${filas.length}`);
  console.table(cuenta);
  console.table(porSede);
  console.log(`Limpios (MAC exacta, equipo libre): ${limpios.length}${aplicar ? ` · asignados: ${hechos}` : ' · sin --aplicar no se escribe nada'}`);
  console.table(motivos);
  console.log(`Detalle: ${salida}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
