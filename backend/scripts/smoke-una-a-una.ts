import 'reflect-metadata';
/**
 * Smoke de SÓLO LECTURA de «una a una» (2026-10-01): por cada técnico con trabajo
 * abierto hoy, qué orden le toca y cuántas se le esconden en cada puerta.
 *
 * Uso: npx ts-node --transpile-only scripts/smoke-una-a-una.ts
 */
import { prismaService, supportService, agendaService } from '../src/core/contenedor';
import { hoyEnColombia } from '../src/common/fecha-colombia';

async function main() {
  const hoy = hoyEnColombia();
  const conTrabajo = await prismaService.ticket.groupBy({
    by: ['assignedStaffId'],
    where: { assignedStaffId: { not: null }, status: { in: ['PENDIENTE', 'REALIZANDO'] }, scheduledFor: { lte: hoy } },
    _count: { _all: true },
  });
  let fallos = 0;
  for (const g of conTrabajo) {
    const staff = await prismaService.staff.findUnique({ where: { id: g.assignedStaffId! }, select: { name: true, email: true, agendaLibre: true, banned: true } });
    if (!staff || staff.banned) continue;
    const user: any = { id: 'smoke', name: staff.name, email: staff.email ?? '—', permissions: ['area.tecnicos'], areas: ['tecnicos'], sedes: [] };
    const lista: any = await (supportService as any).tickets({ page: 1, pageSize: 200 }, user).catch((e: Error) => ({ error: e.message }));
    const filas: any[] = lista?.data ?? lista?.items ?? [];
    const abiertasLista = filas.filter((t) => ['PENDIENTE', 'REALIZANDO'].includes(t.status));
    const ag: any = await agendaService.miAgenda(user);
    const abiertasAgenda = ag.ordenes.filter((o: any) => ['PENDIENTE', 'REALIZANDO'].includes(o.status));
    const prox: any = await agendaService.misProximas(user, 14);
    const ok = staff.agendaLibre || (abiertasLista.length <= 1 && abiertasAgenda.length <= 1 && prox.total === 0 && ag.proximas === 0);
    if (!ok) fallos++;
    console.log(
      `${ok ? '✅' : '❌'} ${staff.name.padEnd(38)} abiertas agendadas hasta hoy=${String(g._count._all).padStart(3)}`
      + ` → lista=${abiertasLista.length}${lista?.error ? ` (${lista.error})` : ''} agenda=${abiertasAgenda.length} próximas=${prox.total}`
      + ` · le toca ${abiertasLista[0]?.code ? '#' + abiertasLista[0].code : abiertasAgenda[0]?.code ? '#' + abiertasAgenda[0].code : '—'}`
      + (staff.agendaLibre ? ' (exento)' : ''),
    );
  }
  console.log(fallos ? `\n${fallos} con más de una abierta a la vista` : '\nTodos ven como mucho UNA orden abierta.');
  if (fallos) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prismaService.$disconnect());
