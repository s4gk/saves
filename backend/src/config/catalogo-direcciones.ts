import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { BadRequestException, NotFoundException } from '../core/http/errores';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Catálogo de sedes y de direcciones (departamento → ciudad → localidad → barrio)
 * que se crea desde la app (6 oct 2026).
 *
 * Todo esto vino del sistema anterior una sola vez y nadie podía añadir nada: el
 * abonado guarda el `legacyId` de cada nivel (`Subscriber.departmentRef`…
 * `neighborhood`), y la sede se casa con `customers.gid` por `Branch.legacyId` en el
 * sync. Por eso lo que se crea aquí NO se escribe en el sistema anterior (decisión
 * del usuario) y toma su número de un rango reservado, de `PRIMER_ID_PROPIO` en
 * adelante: así nunca choca con un id que el sistema anterior dé mañana. Si un
 * traslado lleva a un barrio creado aquí, el sistema anterior recibe un número que no
 * conoce y lo enseña en blanco; es el precio aceptado.
 */
export const PRIMER_ID_PROPIO = 100_000;

export const NIVELES = ['departments', 'cities', 'localities', 'neighborhoods'] as const;
export type Nivel = (typeof NIVELES)[number];

const NOMBRE_NIVEL: Record<Nivel, string> = {
  departments: 'el departamento', cities: 'la ciudad', localities: 'la localidad', neighborhoods: 'el barrio',
};

export class CreateBranchDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsString() dir?: string;
}

export class CreateDireccionDto {
  @IsString() @MinLength(2) name!: string;
  /** `legacyId` del nivel de arriba. Obligatorio salvo en departamentos. */
  @IsOptional() @Type(() => Number) @IsInt() parent?: number;
}

export class RenameDireccionDto {
  @IsString() @MinLength(2) name!: string;
}

export function nivelValido(nivel: string): Nivel {
  if (!(NIVELES as readonly string[]).includes(nivel)) throw new NotFoundException('Nivel de dirección desconocido');
  return nivel as Nivel;
}

const limpio = (t: string) => t.trim().replace(/\s+/g, ' ');
const clave = (t: string) => limpio(t).toLocaleLowerCase('es');

/** Siguiente id del rango propio: nunca por debajo de `PRIMER_ID_PROPIO`. */
const siguiente = (max: number | null | undefined) => Math.max(max ?? 0, PRIMER_ID_PROPIO - 1) + 1;

/** Un choque de `legacyId` (dos altas a la vez) se reintenta una vez con el número nuevo. */
async function conReintento<T>(crear: () => Promise<T>): Promise<T> {
  try {
    return await crear();
  } catch (e: any) {
    if (e?.code !== 'P2002') throw e;
    return crear();
  }
}

type Fila = { id: string; legacyId: number | null; name: string; parent: number | null; propio: boolean; hijos: number; abonados: number };

export class CatalogoDirecciones {
  constructor(private readonly prisma: PrismaService) {}

  // ── Sedes ──────────────────────────────────────────────────────────────────

  async crearSede(dto: CreateBranchDto) {
    const name = limpio(dto.name);
    const todas = await this.prisma.branch.findMany({ select: { name: true, legacyId: true } });
    const igual = todas.find((b) => clave(b.name) === clave(name));
    if (igual) throw new BadRequestException(`Ya existe la sede «${igual.name}».`);
    return conReintento(async () => {
      const max = await this.prisma.branch.aggregate({ _max: { legacyId: true } });
      const b = await this.prisma.branch.create({
        data: { name, summary: dto.summary?.trim() || null, dir: dto.dir?.trim() || null, legacyId: siguiente(max._max.legacyId) },
      });
      return { id: b.id, name: b.name, summary: b.summary, dir: b.dir, isActive: b.isActive, subscribers: 0 };
    });
  }

  /**
   * Una sede sólo se borra si nada la usa. Además de las relaciones de Prisma, la sede
   * se nombra por su `legacyId` en sitios sin llave foránea (alcance de los usuarios,
   * cajas, bodegas): si se borrara con eso puesto, esas filas apuntarían a nada.
   */
  async borrarSede(id: string) {
    const b = await this.prisma.branch.findUnique({
      where: { id },
      include: { _count: { select: { subscribers: true, mikrotiks: true, olts: true, naps: true, vlans: true, genieacs: true, promotions: true, fixedAssets: true } } },
    });
    if (!b) throw new NotFoundException('Sede no encontrada');
    const [usuarios, cajas, bodegasEquipo, bodegasMaterial] = await Promise.all([
      this.prisma.user.count({ where: { sedesAccede: { has: b.legacyId } } }),
      this.prisma.cashAccount.count({ where: { branchLegacy: b.legacyId } }),
      this.prisma.equipmentWarehouse.count({ where: { branchLegacy: b.legacyId } }),
      this.prisma.materialWarehouse.count({ where: { branchLegacy: b.legacyId } }),
    ]);
    const c = b._count;
    const usos = [
      [c.subscribers, 'abonado(s)'], [c.mikrotiks, 'equipo(s) de red'], [c.olts, 'OLT'], [c.naps, 'caja(s) NAP'],
      [c.vlans, 'VLAN(s)'], [c.genieacs, 'conexión(es) GenieACS'], [c.promotions, 'promoción(es)'],
      [c.fixedAssets, 'activo(s) fijo(s)'], [b.costCenterId ? 1 : 0, 'centro de costo'],
      [usuarios, 'usuario(s) con acceso'], [cajas, 'caja(s)'], [bodegasEquipo + bodegasMaterial, 'bodega(s)'],
    ].filter(([n]) => (n as number) > 0).map(([n, t]) => `${n} ${t}`);
    if (usos.length) throw new BadRequestException(`No se puede eliminar «${b.name}»: la usan ${usos.join(', ')}. Si ya no opera, desmárcala como activa para ocultarla.`);
    await this.prisma.branch.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ── Direcciones ────────────────────────────────────────────────────────────

  /**
   * Los cuatro niveles enteros, con cuántos hijos y abonados tiene cada fila. Son unas
   * pocas centenas, así que la pantalla filtra en el cliente y no hace un viaje por clic.
   */
  async listar(): Promise<Record<Nivel, Fila[]>> {
    const [deps, ciudades, locs, barrios, abonados] = await Promise.all([
      this.prisma.department.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.city.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.locality.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.neighborhood.findMany({ orderBy: { name: 'asc' }, select: { id: true, legacyId: true, name: true, localityLegacy: true } }),
      this.prisma.subscriber.findMany({ select: { departmentRef: true, cityRef: true, localityRef: true, neighborhood: true } }),
    ]);
    const cuenta = (campo: 'departmentRef' | 'cityRef' | 'localityRef' | 'neighborhood') => {
      const m = new Map<string, number>();
      for (const s of abonados) { const v = s[campo]; if (v) m.set(v, (m.get(v) ?? 0) + 1); }
      return m;
    };
    const hijosDe = (padres: (number | null)[]) => {
      const m = new Map<number, number>();
      for (const p of padres) if (p != null) m.set(p, (m.get(p) ?? 0) + 1);
      return m;
    };
    const fila = (r: { id: string; legacyId: number | null; name: string }, parent: number | null, hijos: Map<number, number> | null, ab: Map<string, number>): Fila => ({
      id: r.id, legacyId: r.legacyId, name: r.name, parent,
      propio: (r.legacyId ?? 0) >= PRIMER_ID_PROPIO,
      hijos: r.legacyId != null && hijos ? hijos.get(r.legacyId) ?? 0 : 0,
      abonados: r.legacyId != null ? ab.get(String(r.legacyId)) ?? 0 : 0,
    });
    const hCiudades = hijosDe(ciudades.map((c) => c.departmentLegacy));
    const hLocs = hijosDe(locs.map((l) => l.cityLegacy));
    const hBarrios = hijosDe(barrios.map((n) => n.localityLegacy));
    return {
      departments: deps.map((d) => fila(d, null, hCiudades, cuenta('departmentRef'))),
      cities: ciudades.map((c) => fila(c, c.departmentLegacy, hLocs, cuenta('cityRef'))),
      localities: locs.map((l) => fila(l, l.cityLegacy, hBarrios, cuenta('localityRef'))),
      neighborhoods: barrios.map((n) => fila(n, n.localityLegacy, null, cuenta('neighborhood'))),
    };
  }

  async crear(nivel: Nivel, dto: CreateDireccionDto) {
    const name = limpio(dto.name);
    if (nivel !== 'departments' && dto.parent == null) throw new BadRequestException('Falta el nivel de arriba (a qué pertenece).');

    // Los ancestros se copian del padre: el barrio guarda también su ciudad y su
    // departamento, como los que vinieron del sistema anterior.
    let ancestros: Record<string, number | null> = {};
    let hermanos: { name: string }[] = [];
    if (nivel === 'departments') {
      hermanos = await this.prisma.department.findMany({ select: { name: true } });
    } else if (nivel === 'cities') {
      if (!(await this.prisma.department.findUnique({ where: { legacyId: dto.parent } }))) throw new NotFoundException('Departamento no encontrado');
      ancestros = { departmentLegacy: dto.parent! };
      hermanos = await this.prisma.city.findMany({ where: { departmentLegacy: dto.parent }, select: { name: true } });
    } else if (nivel === 'localities') {
      const c = await this.prisma.city.findUnique({ where: { legacyId: dto.parent } });
      if (!c) throw new NotFoundException('Ciudad no encontrada');
      ancestros = { departmentLegacy: c.departmentLegacy, cityLegacy: dto.parent! };
      hermanos = await this.prisma.locality.findMany({ where: { cityLegacy: dto.parent }, select: { name: true } });
    } else {
      const l = await this.prisma.locality.findUnique({ where: { legacyId: dto.parent } });
      if (!l) throw new NotFoundException('Localidad no encontrada');
      ancestros = { departmentLegacy: l.departmentLegacy, cityLegacy: l.cityLegacy, localityLegacy: dto.parent! };
      hermanos = await this.prisma.neighborhood.findMany({ where: { localityLegacy: dto.parent }, select: { name: true } });
    }
    const igual = hermanos.find((h) => clave(h.name) === clave(name));
    if (igual) throw new BadRequestException(`Ya existe ${NOMBRE_NIVEL[nivel]} «${igual.name}» ahí.`);

    const creada = await conReintento(async () => {
      const legacyId = siguiente(await this.maximo(nivel));
      const data = { name, legacyId, ...ancestros } as any;
      return (this.modelo(nivel) as any).create({ data });
    });

    // El alta del abonado va departamento → ciudad → localidad → barrio sin saltarse
    // ninguno, y las ciudades sin localidades de verdad tienen una «Ninguna» (así
    // vinieron del sistema anterior). Una ciudad nueva nace con la suya para que se le
    // puedan colgar barrios enseguida.
    if (nivel === 'cities') {
      await conReintento(async () => this.prisma.locality.create({
        data: { name: 'Ninguna', legacyId: siguiente(await this.maximo('localities')), departmentLegacy: dto.parent!, cityLegacy: creada.legacyId },
      }));
    }
    return { id: creada.id, legacyId: creada.legacyId, name: creada.name };
  }

  async renombrar(nivel: Nivel, id: string, dto: RenameDireccionDto) {
    const name = limpio(dto.name);
    const fila = await (this.modelo(nivel) as any).findUnique({ where: { id } });
    if (!fila) throw new NotFoundException('No encontrado');
    const campoPadre = { departments: null, cities: 'departmentLegacy', localities: 'cityLegacy', neighborhoods: 'localityLegacy' }[nivel];
    const hermanos: { id: string; name: string }[] = await (this.modelo(nivel) as any).findMany({
      where: campoPadre ? { [campoPadre]: fila[campoPadre] } : {}, select: { id: true, name: true },
    });
    const igual = hermanos.find((h) => h.id !== id && clave(h.name) === clave(name));
    if (igual) throw new BadRequestException(`Ya existe ${NOMBRE_NIVEL[nivel]} «${igual.name}» ahí.`);
    const r = await (this.modelo(nivel) as any).update({ where: { id }, data: { name } });
    return { id: r.id, legacyId: r.legacyId, name: r.name };
  }

  /** Sólo se borra lo que no tiene nada debajo ni ningún abonado (ni promoción, en barrios). */
  async borrar(nivel: Nivel, id: string) {
    const fila = await (this.modelo(nivel) as any).findUnique({ where: { id } });
    if (!fila) throw new NotFoundException('No encontrado');
    const lid: number | null = fila.legacyId;
    if (lid != null) {
      const ref = String(lid);
      const campoAbonado = { departments: 'departmentRef', cities: 'cityRef', localities: 'localityRef', neighborhoods: 'neighborhood' }[nivel];
      const [hijos, abonados, promos] = await Promise.all([
        nivel === 'departments' ? this.prisma.city.count({ where: { departmentLegacy: lid } })
          : nivel === 'cities' ? this.prisma.locality.count({ where: { cityLegacy: lid, NOT: { name: { equals: 'Ninguna', mode: 'insensitive' } } } })
          : nivel === 'localities' ? this.prisma.neighborhood.count({ where: { localityLegacy: lid } })
          : Promise.resolve(0),
        this.prisma.subscriber.count({ where: { [campoAbonado]: ref } }),
        nivel === 'neighborhoods' ? this.prisma.promotion.count({ where: { neighborhoodRefs: { has: ref } } }) : Promise.resolve(0),
      ]);
      // Una ciudad sin más que su «Ninguna» vacía se puede borrar: se lleva la «Ninguna» con ella.
      const ningunasConBarrios = nivel === 'cities'
        ? await this.prisma.neighborhood.count({ where: { cityLegacy: lid } })
        : 0;
      const usos = [
        [hijos + ningunasConBarrios, nivel === 'departments' ? 'ciudad(es)' : nivel === 'cities' ? 'localidad(es) o barrio(s)' : 'barrio(s)'],
        [abonados, 'abonado(s)'], [promos, 'promoción(es)'],
      ].filter(([n]) => (n as number) > 0).map(([n, t]) => `${n} ${t}`);
      if (usos.length) throw new BadRequestException(`No se puede eliminar «${fila.name}»: tiene ${usos.join(', ')}.`);
      if (nivel === 'cities') await this.prisma.locality.deleteMany({ where: { cityLegacy: lid } });
    }
    await (this.modelo(nivel) as any).delete({ where: { id } });
    return { id, deleted: true };
  }

  private modelo(nivel: Nivel) {
    return { departments: this.prisma.department, cities: this.prisma.city, localities: this.prisma.locality, neighborhoods: this.prisma.neighborhood }[nivel];
  }

  private async maximo(nivel: Nivel): Promise<number | null> {
    const r = await (this.modelo(nivel) as any).aggregate({ _max: { legacyId: true } });
    return r._max.legacyId;
  }
}
