import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Sedes activas — el interruptor con el que una sede deja de ofrecerse sin borrarla.
 *
 * Nace de la petición del usuario (2026-10-01): "desactiva Mocoa y Villavicencio, no
 * los borres, solo no volver a mostrarlos". Ya no se opera en esas dos ciudades, pero
 * entre las dos quedan 145 abonados con su historia (49 activos en Mocoa), así que
 * borrarlas no era opción: lo que molestaba era verlas en los desplegables.
 *
 * REGLA, y es toda la regla: esto se aplica a los CATÁLOGOS —lo que se ofrece para
 * elegir o para filtrar— y a nada más.
 *
 *   SÍ se filtra: el selector de sede del alta de cliente, de la agenda, de las
 *   órdenes de compra, del inventario, de la red, del mapa, de las promociones, de las
 *   campañas de WhatsApp, del tablero, de los reportes y del acceso por sede.
 *
 *   NO se filtra: nada que ya exista. El nombre de la sede se sigue resolviendo
 *   siempre (`Branch.findUnique`, los mapas `legacyId → nombre`), porque una factura
 *   de Mocoa no puede quedarse sin sede en pantalla; y los procesos —corrida de
 *   facturación, cortes, writeback y sync con el legacy, métricas históricas— siguen
 *   corriendo sobre esas sedes exactamente como antes. Apagar eso es otra decisión,
 *   y el usuario pidió expresamente ésta.
 *
 * Tampoco se valida al ESCRIBIR (`exigirSedeDestino` sigue aceptando una sede
 * desactivada): si no, editar la ficha de cualquiera de esos 145 clientes —que
 * reenvía su propia sede— empezaría a dar 403.
 *
 * Se usa con spread, que es lo que encaja con los `where` condicionales por alcance
 * de usuario que hay repartidos:
 *
 *     where: { ...SEDE_ACTIVA, ...(sedes ? { legacyId: { in: sedes } } : {}) }
 */
export const SEDE_ACTIVA = { isActive: true } satisfies Prisma.BranchWhereInput;

/**
 * Los NOMBRES de las sedes apagadas, en minúsculas, para los filtros que no salen de
 * `Branch` sino de los datos: las órdenes de compra guardan la sede como texto libre
 * (`SupplyOrder.branchRef`) y su desplegable se arma agrupando lo que haya, así que una
 * sede desactivada seguiría apareciendo por sus órdenes viejas.
 */
export async function nombresDeSedesApagadas(prisma: PrismaService): Promise<Set<string>> {
  const filas = await prisma.branch.findMany({ where: { isActive: false }, select: { name: true } });
  return new Set(filas.map((b) => b.name.trim().toLowerCase()));
}

// En SQL crudo no llega este `where`: ahí va a mano como `b."isActive"` (hoy sólo el
// conteo por sede de e-factura, `einvoice.service.ts`).
