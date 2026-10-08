/**
 * Alta de la pantalla de activos fijos (2026-09-29). Idempotente.
 *
 *   /contabilidad/activos-fijos  — registro de activos con fotos y depreciación
 *
 * Siembra SÓLO su llave `screen.*` y la concede a los roles de las áreas que
 * declara SCREENS (contabilidad, administración y gerencia). Sin esto la entrada del
 * menú sólo la ve el superusuario (ver la nota «pantallas sin llave»). No toca ninguna
 * otra llave ni ningún otro rol.
 *
 * Correr:  npx ts-node --transpile-only prisma/migrate-pantalla-activos-fijos-2026-09.ts
 */
import { PrismaClient } from '@prisma/client';
import { SCREENS, screenKey } from '../src/auth/permissions.catalog';

const prisma = new PrismaClient();
const HREFS = ['/contabilidad/activos-fijos'];
const ROL_DE_AREA: Record<string, string> = {
  gerencia: 'area-gerencia',
  administracion: 'area-administracion',
  contabilidad: 'area-contabilidad',
  tecnicos: 'area-tecnicos',
  sistemas: 'area-sistemas',
  caja: 'area-caja',
};

async function main() {
  for (const href of HREFS) {
    const def = SCREENS.find((s) => s.href === href);
    if (!def) throw new Error(`${href} no está en SCREENS`);
    const key = screenKey(href);
    const permiso = await prisma.permission.upsert({
      where: { key },
      update: { label: def.label },
      create: { key, label: def.label },
      select: { id: true },
    });
    for (const area of def.areas) {
      const rol = await prisma.role.findUnique({ where: { key: ROL_DE_AREA[area] }, select: { id: true, name: true } });
      if (!rol) { console.log(`· sin rol para ${area}`); continue; }
      const ya = await prisma.rolePermission.findFirst({ where: { roleId: rol.id, permissionId: permiso.id } });
      if (!ya) await prisma.rolePermission.create({ data: { roleId: rol.id, permissionId: permiso.id } });
      console.log(`${ya ? '·' : '✓'} ${key} → ${rol.name}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
