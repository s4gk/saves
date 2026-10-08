import { Prisma } from '@prisma/client';
import { Workbook } from 'exceljs';
import { BadRequestException, ConflictException, NotFoundException } from '../core/http/errores';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService, PostLine } from '../accounting/journal.service';
import { num, round2 } from '../common/money';
import type { AuthUser } from '../auth/current-user.decorator';
import { AssetLocationDto, CreateFixedAssetDto, DisposeFixedAssetDto, UpdateFixedAssetDto } from './dto/fixed-assets.dto';
import { SEDE_ACTIVA } from '../common/sedes-activas';

/**
 * Activos fijos (propiedad, planta y equipo): el registro de lo que la empresa TIENE
 * —las OLT y las Mikrotik de los nodos, los computadores, los vehículos— con su foto,
 * su serial, dónde está y cuánto vale hoy.
 *
 * La depreciación es en línea recta y mensual: `(costo − residual) / vida útil`, desde
 * el mes en que el equipo entra en uso (ese mes cuenta completo). El valor en libros
 * que se muestra es el TEÓRICO al mes actual; lo contabilizado es aparte y sólo lo
 * mueve `runDepreciation`, que genera UN asiento por corrida (Dr 5160 por centro de
 * costo / Cr 1592) y se pone al día si hubo meses sin correr.
 */

/** Forma mínima del archivo que entrega multer. */
export type FotoSubida = { originalname: string; filename: string; mimetype: string; size: number };

type AssetConCategoria = Prisma.FixedAssetGetPayload<{ include: { category: true; branch: true } }>;

/** `YYYY-MM-DD` → mediodía en Bogotá. Al mediodía ningún corrimiento de zona cambia el día. */
export function fechaDia(s: string, campo = 'fecha'): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? '').trim());
  if (!m) throw new BadRequestException(`La ${campo} debe ir como AAAA-MM-DD`);
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00-05:00`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`La ${campo} no es válida`);
  return d;
}

/** Año y mes (1-12) de una fecha, en Bogotá. */
function anioMes(d: Date): { y: number; m: number } {
  const b = new Date(d.getTime() - 5 * 3600 * 1000);
  return { y: b.getUTCFullYear(), m: b.getUTCMonth() + 1 };
}

/** Último día del mes, al mediodía en Bogotá. */
function finDeMes(y: number, m: number): Date {
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return fechaDia(`${y}-${String(m).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`);
}

/** Datos de un activo que entran al cálculo de la depreciación. */
type BaseDepreciacion = {
  acquisitionCost: Prisma.Decimal | number;
  residualValue: Prisma.Decimal | number;
  usefulLifeMonths: number;
  inServiceDate: Date;
  disposalDate?: Date | null;
};

/** Cuota mensual en línea recta. */
export function cuotaMensual(a: BaseDepreciacion): number {
  const base = Math.max(0, num(a.acquisitionCost) - num(a.residualValue));
  return a.usefulLifeMonths > 0 ? base / a.usefulLifeMonths : 0;
}

/**
 * Depreciación acumulada TEÓRICA al cierre de `y`-`m`. El mes de entrada en uso cuenta
 * entero; nunca pasa de `costo − residual`; un activo dado de baja se congela en el mes
 * de la baja.
 */
export function acumuladaAl(a: BaseDepreciacion, y: number, m: number): number {
  const base = Math.max(0, num(a.acquisitionCost) - num(a.residualValue));
  let hasta = y * 12 + m;
  if (a.disposalDate) {
    const b = anioMes(a.disposalDate);
    hasta = Math.min(hasta, b.y * 12 + b.m);
  }
  const ini = anioMes(a.inServiceDate);
  const meses = Math.max(0, Math.min(a.usefulLifeMonths, hasta - (ini.y * 12 + ini.m) + 1));
  if (meses >= a.usefulLifeMonths) return round2(base);
  return round2(Math.min(base, cuotaMensual(a) * meses));
}

/** Texto opcional: vacío o sólo espacios = null. */
const txt = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return s ? s : null;
};

export class FixedAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
  ) {}

  // ------------------------------------------------------------------ //
  //  Catálogos del formulario                                          //
  // ------------------------------------------------------------------ //

  async meta() {
    const [categories, branches, costCenters, accounts] = await Promise.all([
      this.prisma.fixedAssetCategory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.branch.findMany({ where: SEDE_ACTIVA, select: { id: true, name: true, legacyId: true, costCenterId: true }, orderBy: { legacyId: 'asc' } }),
      this.prisma.costCenter.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.account.findMany({ select: { id: true, code: true, name: true } }),
    ]);
    const cuenta = new Map(accounts.map((a) => [a.id, a]));
    return {
      categories: categories.map((c) => ({
        id: c.id, code: c.code, name: c.name, usefulLifeMonths: c.usefulLifeMonths, method: c.method,
        assetAccount: cuenta.get(c.assetAccountId) ?? null,
        expenseAccount: cuenta.get(c.depreciationExpenseAccountId) ?? null,
        accumulatedAccount: cuenta.get(c.accumulatedDepreciationAccountId) ?? null,
      })),
      branches,
      costCenters,
    };
  }

  // ------------------------------------------------------------------ //
  //  Listado                                                           //
  // ------------------------------------------------------------------ //

  private filtro(q: { search?: string; categoryId?: string; branchId?: string; status?: string }): Prisma.FixedAssetWhereInput {
    const where: Prisma.FixedAssetWhereInput = {};
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.branchId === 'none') where.branchId = null;
    else if (q.branchId) where.branchId = q.branchId;
    if (q.status) where.status = q.status as Prisma.EnumAssetStatusFilter['equals'];
    const s = q.search?.trim();
    if (s) {
      where.OR = (['code', 'name', 'brand', 'model', 'serialNumber', 'location', 'responsible', 'supplier', 'invoiceNumber'] as const)
        .map((f) => ({ [f]: { contains: s, mode: 'insensitive' } }));
    }
    return where;
  }

  /** Valores calculados que acompañan a cada activo en la respuesta. */
  private valores(a: AssetConCategoria & { depreciations?: { year: number; month: number }[] }, hoy = anioMes(new Date())) {
    const costo = num(a.acquisitionCost);
    const residual = num(a.residualValue);
    const acumuladaTeorica = acumuladaAl(a, hoy.y, hoy.m);
    const ultima = a.depreciations?.[0];
    return {
      acquisitionCost: costo,
      residualValue: residual,
      accumulatedDepreciation: num(a.accumulatedDepreciation),
      disposalProceeds: a.disposalProceeds == null ? null : num(a.disposalProceeds),
      monthlyDepreciation: round2(cuotaMensual(a)),
      depreciationToDate: acumuladaTeorica,
      bookValue: round2(costo - acumuladaTeorica),
      postedThrough: ultima ? `${ultima.year}-${String(ultima.month).padStart(2, '0')}` : null,
    };
  }

  async list(q: { search?: string; categoryId?: string; branchId?: string; status?: string; page?: number; pageSize?: number }) {
    const where = this.filtro(q);
    const pageSize = Math.min(Math.max(Number(q.pageSize) || 50, 1), 200);
    const page = Math.max(Number(q.page) || 1, 1);
    const [rows, total, todos] = await Promise.all([
      this.prisma.fixedAsset.findMany({
        where,
        include: {
          category: true, branch: true,
          photos: { select: { id: true, mimeType: true }, orderBy: { createdAt: 'desc' } },
          depreciations: { select: { year: true, month: true }, orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 1 },
        },
        orderBy: { code: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.fixedAsset.count({ where }),
      // Totales sobre TODO lo filtrado, no sólo la página.
      this.prisma.fixedAsset.findMany({
        where,
        select: { acquisitionCost: true, residualValue: true, usefulLifeMonths: true, inServiceDate: true, disposalDate: true, status: true },
      }),
    ]);
    const hoy = anioMes(new Date());
    let costo = 0, depreciacion = 0, activos = 0;
    for (const a of todos) {
      if (a.status === 'DISPOSED') continue;
      activos++;
      costo += num(a.acquisitionCost);
      depreciacion += acumuladaAl(a, hoy.y, hoy.m);
    }
    return {
      total, page, pageSize,
      summary: { count: activos, cost: round2(costo), depreciation: round2(depreciacion), bookValue: round2(costo - depreciacion) },
      rows: rows.map((a) => ({
        id: a.id, code: a.code, name: a.name, status: a.status,
        brand: a.brand, model: a.model, serialNumber: a.serialNumber,
        location: a.location, responsible: a.responsible,
        latitude: a.latitude, longitude: a.longitude,
        category: { id: a.category.id, code: a.category.code, name: a.category.name },
        branch: a.branch ? { id: a.branch.id, name: a.branch.name } : null,
        acquisitionDate: a.acquisitionDate, inServiceDate: a.inServiceDate, usefulLifeMonths: a.usefulLifeMonths,
        photoCount: a.photos.length,
        coverPhoto: a.photos[0] ?? null,
        ...this.valores(a, hoy),
      })),
    };
  }

  // ------------------------------------------------------------------ //
  //  Detalle y edición                                                 //
  // ------------------------------------------------------------------ //

  async detail(id: string) {
    const a = await this.prisma.fixedAsset.findUnique({
      where: { id },
      include: {
        category: true, branch: true,
        photos: { orderBy: { createdAt: 'desc' } },
        depreciations: { orderBy: [{ year: 'desc' }, { month: 'desc' }] },
      },
    });
    if (!a) throw new NotFoundException('Activo no encontrado');
    const cc = a.costCenterId
      ? await this.prisma.costCenter.findUnique({ where: { id: a.costCenterId }, select: { id: true, code: true, name: true } })
      : null;
    return {
      ...a,
      ...this.valores(a),
      costCenter: cc,
      category: { id: a.category.id, code: a.category.code, name: a.category.name, usefulLifeMonths: a.category.usefulLifeMonths },
      branch: a.branch ? { id: a.branch.id, name: a.branch.name } : null,
      photos: a.photos.map((p) => ({ id: p.id, name: p.originalName, mimeType: p.mimeType, size: p.size, uploadedBy: p.uploadedBy, createdAt: p.createdAt })),
      depreciations: a.depreciations.map((d) => ({
        id: d.id, year: d.year, month: d.month, date: d.date,
        amount: num(d.amount), accumulatedAfter: num(d.accumulatedAfter), bookValueAfter: num(d.bookValueAfter),
        journalEntryId: d.journalEntryId,
      })),
    };
  }

  /** Siguiente código libre `AF-00001`. */
  private async siguienteCodigo(): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ n: number | null }[]>`
      SELECT MAX(CAST(SUBSTRING("code" FROM 4) AS INTEGER)) AS n
      FROM "FixedAsset" WHERE "code" ~ '^AF-[0-9]+$'`;
    return `AF-${String((Number(rows[0]?.n) || 0) + 1).padStart(5, '0')}`;
  }

  private async categoria(id: string) {
    const c = await this.prisma.fixedAssetCategory.findUnique({ where: { id } });
    if (!c) throw new BadRequestException('La categoría no existe');
    return c;
  }

  /** Centro de costo por defecto: el de la sede del activo. */
  private async centroDeSede(branchId: string | null): Promise<string | null> {
    if (!branchId) return null;
    const b = await this.prisma.branch.findUnique({ where: { id: branchId }, select: { costCenterId: true } });
    if (!b) throw new BadRequestException('La sede no existe');
    return b.costCenterId ?? null;
  }

  async create(dto: CreateFixedAssetDto, user: AuthUser | { name?: string; email?: string } | null) {
    const cat = await this.categoria(dto.categoryId);
    const branchId = txt(dto.branchId);
    const acquisitionDate = fechaDia(dto.acquisitionDate, 'fecha de compra');
    const inServiceDate = dto.inServiceDate ? fechaDia(dto.inServiceDate, 'fecha de entrada en uso') : acquisitionDate;
    const residual = dto.residualValue ?? 0;
    if (residual > dto.acquisitionCost) throw new BadRequestException('El valor residual no puede superar el costo');
    const costCenterId = txt(dto.costCenterId) ?? (await this.centroDeSede(branchId));
    const conGps = dto.latitude != null && dto.longitude != null;
    if ((dto.latitude != null) !== (dto.longitude != null)) throw new BadRequestException('La ubicación necesita latitud y longitud');
    const quien = user?.name || user?.email || null;
    const data = {
      name: dto.name.trim(), categoryId: cat.id,
      brand: txt(dto.brand), model: txt(dto.model), serialNumber: txt(dto.serialNumber),
      branchId, location: txt(dto.location), responsible: txt(dto.responsible),
      supplier: txt(dto.supplier), invoiceNumber: txt(dto.invoiceNumber),
      acquisitionDate, inServiceDate,
      acquisitionCost: round2(dto.acquisitionCost), residualValue: round2(residual),
      usefulLifeMonths: dto.usefulLifeMonths ?? cat.usefulLifeMonths,
      method: cat.method, costCenterId, notes: txt(dto.notes),
      createdBy: quien,
      ...(conGps ? {
        latitude: Number(dto.latitude!.toFixed(6)), longitude: Number(dto.longitude!.toFixed(6)),
        gpsAccuracy: dto.gpsAccuracy == null ? null : Math.round(dto.gpsAccuracy),
        gpsCapturedAt: new Date(), gpsCapturedBy: quien,
      } : {}),
    };
    const pedido = txt(dto.code);
    // Dos altas a la vez pueden sacar el mismo número: se reintenta con el siguiente.
    for (let intento = 0; intento < 3; intento++) {
      const code = pedido ?? (await this.siguienteCodigo());
      try {
        const a = await this.prisma.fixedAsset.create({ data: { ...data, code } });
        return this.detail(a.id);
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
        if (pedido) throw new ConflictException(`Ya existe un activo con el código ${pedido}`);
      }
    }
    throw new ConflictException('No se pudo asignar un código al activo; intenta de nuevo');
  }

  async update(id: string, dto: UpdateFixedAssetDto) {
    const actual = await this.prisma.fixedAsset.findUnique({ where: { id }, include: { _count: { select: { depreciations: true } } } });
    if (!actual) throw new NotFoundException('Activo no encontrado');
    const data: Prisma.FixedAssetUncheckedUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code.trim();
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.categoryId !== undefined) data.categoryId = (await this.categoria(dto.categoryId)).id;
    for (const f of ['brand', 'model', 'serialNumber', 'location', 'responsible', 'supplier', 'invoiceNumber', 'notes'] as const) {
      if (dto[f] !== undefined) data[f] = txt(dto[f]);
    }
    if (dto.branchId !== undefined) {
      data.branchId = txt(dto.branchId);
      // Cambiar de sede arrastra el centro de costo, salvo que se elija uno a mano.
      if (dto.costCenterId === undefined) data.costCenterId = await this.centroDeSede(data.branchId as string | null);
    }
    if (dto.costCenterId !== undefined) data.costCenterId = txt(dto.costCenterId);

    // Lo que mueve la depreciación no se toca si ya hay meses contabilizados: el
    // asiento quedaría calculado con otro costo. Para corregirlo, se reversa aparte.
    const tocaCalculo = dto.acquisitionDate !== undefined || dto.inServiceDate !== undefined
      || dto.acquisitionCost !== undefined || dto.residualValue !== undefined || dto.usefulLifeMonths !== undefined;
    if (tocaCalculo) {
      const cambia = (dto.acquisitionCost !== undefined && round2(dto.acquisitionCost) !== num(actual.acquisitionCost))
        || (dto.residualValue !== undefined && round2(dto.residualValue) !== num(actual.residualValue))
        || (dto.usefulLifeMonths !== undefined && dto.usefulLifeMonths !== actual.usefulLifeMonths)
        || (dto.inServiceDate !== undefined && fechaDia(dto.inServiceDate).getTime() !== actual.inServiceDate.getTime());
      if (cambia && actual._count.depreciations > 0) {
        throw new BadRequestException('Este activo ya tiene depreciación contabilizada: el costo, el residual, la vida útil y la fecha de uso ya no se pueden cambiar');
      }
      if (dto.acquisitionDate !== undefined) data.acquisitionDate = fechaDia(dto.acquisitionDate, 'fecha de compra');
      if (dto.inServiceDate !== undefined) data.inServiceDate = fechaDia(dto.inServiceDate, 'fecha de entrada en uso');
      if (dto.acquisitionCost !== undefined) data.acquisitionCost = round2(dto.acquisitionCost);
      if (dto.residualValue !== undefined) data.residualValue = round2(dto.residualValue);
      if (dto.usefulLifeMonths !== undefined) data.usefulLifeMonths = dto.usefulLifeMonths;
      const costo = dto.acquisitionCost ?? num(actual.acquisitionCost);
      const residual = dto.residualValue ?? num(actual.residualValue);
      if (residual > costo) throw new BadRequestException('El valor residual no puede superar el costo');
    }
    try {
      await this.prisma.fixedAsset.update({ where: { id }, data });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('Ya existe un activo con ese código');
      throw e;
    }
    return this.detail(id);
  }

  /** Borrar sólo sirve para lo cargado por error. Con depreciación contabilizada, se da de baja. */
  async remove(id: string) {
    const a = await this.prisma.fixedAsset.findUnique({
      where: { id },
      include: { photos: { select: { storedName: true } }, _count: { select: { depreciations: true } } },
    });
    if (!a) throw new NotFoundException('Activo no encontrado');
    if (a._count.depreciations > 0) {
      throw new BadRequestException('Este activo ya tiene depreciación contabilizada; no se borra, se da de baja');
    }
    await this.prisma.fixedAsset.delete({ where: { id } });
    return { id, deleted: true, photos: a.photos.map((p) => p.storedName) };
  }

  /**
   * Baja o venta. Congela la depreciación en el mes de la baja. No genera asiento: la
   * contrapartida de una venta (a qué caja o banco entró la plata) la registra
   * contabilidad, y la cuenta de utilidad/pérdida depende de ese dato.
   */
  async dispose(id: string, dto: DisposeFixedAssetDto, user: AuthUser) {
    const a = await this.prisma.fixedAsset.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Activo no encontrado');
    if (a.status === 'DISPOSED') throw new BadRequestException('El activo ya estaba dado de baja');
    const fecha = fechaDia(dto.date, 'fecha de la baja');
    if (fecha < a.acquisitionDate) throw new BadRequestException('La baja no puede ser anterior a la compra');
    const quien = user?.name || user?.email || 'sistema';
    const nota = `[Baja ${dto.date} · ${quien}] ${dto.reason.trim()}`;
    await this.prisma.fixedAsset.update({
      where: { id },
      data: {
        status: 'DISPOSED', disposalDate: fecha,
        disposalProceeds: dto.proceeds == null ? null : round2(dto.proceeds),
        notes: a.notes ? `${a.notes}\n${nota}` : nota,
      },
    });
    return this.detail(id);
  }

  /**
   * Fija la ubicación GPS del activo con el punto que tomó el celular en el sitio.
   * Queda quién y cuándo la tomó: una OLT que "aparece" en otro nodo se rastrea así.
   */
  async setLocation(id: string, dto: AssetLocationDto, user: AuthUser) {
    await this.assertExists(id);
    await this.prisma.fixedAsset.update({
      where: { id },
      data: {
        latitude: Number(dto.latitude.toFixed(6)), longitude: Number(dto.longitude.toFixed(6)),
        gpsAccuracy: dto.accuracy == null ? null : Math.round(dto.accuracy),
        gpsCapturedAt: new Date(), gpsCapturedBy: user?.name || user?.email || null,
      },
    });
    return this.detail(id);
  }

  async clearLocation(id: string) {
    await this.assertExists(id);
    await this.prisma.fixedAsset.update({
      where: { id },
      data: { latitude: null, longitude: null, gpsAccuracy: null, gpsCapturedAt: null, gpsCapturedBy: null },
    });
    return this.detail(id);
  }

  // ------------------------------------------------------------------ //
  //  Fotos                                                             //
  // ------------------------------------------------------------------ //

  async assertExists(id: string) {
    const a = await this.prisma.fixedAsset.findUnique({ where: { id }, select: { id: true } });
    if (!a) throw new NotFoundException('Activo no encontrado');
  }

  async addPhoto(id: string, file: FotoSubida, user: AuthUser) {
    await this.assertExists(id);
    const p = await this.prisma.fixedAssetPhoto.create({
      data: {
        assetId: id,
        // multer entrega el nombre en latin1.
        originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
        storedName: file.filename, mimeType: file.mimetype, size: file.size,
        uploadedBy: user?.name || user?.email || null,
      },
    });
    return { id: p.id, name: p.originalName, mimeType: p.mimeType, size: p.size, uploadedBy: p.uploadedBy, createdAt: p.createdAt };
  }

  async photo(id: string, photoId: string) {
    const p = await this.prisma.fixedAssetPhoto.findFirst({ where: { id: photoId, assetId: id } });
    if (!p) throw new NotFoundException('Foto no encontrada');
    return p;
  }

  async deletePhoto(id: string, photoId: string) {
    const p = await this.photo(id, photoId);
    await this.prisma.fixedAssetPhoto.delete({ where: { id: p.id } });
    return p;
  }

  // ------------------------------------------------------------------ //
  //  Depreciación                                                      //
  // ------------------------------------------------------------------ //

  /** Qué contabilizaría la corrida de `y`-`m`, activo por activo. */
  private async calcularCorrida(y: number, m: number) {
    const corte = finDeMes(y, m);
    const assets = await this.prisma.fixedAsset.findMany({
      where: { status: { not: 'DISPOSED' }, inServiceDate: { lte: corte }, depreciations: { none: { year: y, month: m } } },
      include: { category: true, branch: true },
      orderBy: { code: 'asc' },
    });
    const lineas = [];
    for (const a of assets) {
      const objetivo = acumuladaAl(a, y, m);
      const importe = round2(objetivo - num(a.accumulatedDepreciation));
      if (importe <= 0) continue;
      const costCenterId = a.costCenterId ?? a.branch?.costCenterId ?? null;
      lineas.push({
        asset: a, importe, acumuladaDespues: objetivo, costCenterId,
        valorLibrosDespues: round2(num(a.acquisitionCost) - objetivo),
        agotado: objetivo >= round2(num(a.acquisitionCost) - num(a.residualValue)),
      });
    }
    return { corte, lineas };
  }

  async depreciationPreview(year: number, month: number) {
    const y = Number(year), m = Number(month);
    if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12)) throw new BadRequestException('Mes inválido');
    const { lineas } = await this.calcularCorrida(y, m);
    return {
      year: y, month: m,
      total: round2(lineas.reduce((s, l) => s + l.importe, 0)),
      rows: lineas.map((l) => ({
        id: l.asset.id, code: l.asset.code, name: l.asset.name, category: l.asset.category.name,
        branch: l.asset.branch?.name ?? null, amount: l.importe,
        accumulatedAfter: l.acumuladaDespues, bookValueAfter: l.valorLibrosDespues,
      })),
    };
  }

  /**
   * Contabiliza la depreciación hasta el cierre de `y`-`m`: un solo asiento con una
   * línea al gasto por centro de costo y la contrapartida a la depreciación acumulada.
   * Cada activo lleva su renglón en `DepreciationEntry` (único por activo y mes), así
   * que correr dos veces el mismo mes sólo recoge lo que faltaba.
   */
  async runDepreciation(year: number, month: number, user: AuthUser) {
    const { corte, lineas } = await this.calcularCorrida(year, month);
    if (!lineas.length) return { year, month, total: 0, assets: 0, journalEntryId: null };
    const mm = String(month).padStart(2, '0');

    const grupos = new Map<string, PostLine>();
    const sumar = (accountId: string, costCenterId: string | null, debit: number, credit: number, description: string) => {
      const k = `${accountId}|${costCenterId ?? ''}|${debit > 0 ? 'D' : 'C'}`;
      const g = grupos.get(k);
      if (g) { g.debit = round2(g.debit + debit); g.credit = round2(g.credit + credit); return; }
      grupos.set(k, { accountId, costCenterId, debit, credit, description });
    };
    for (const l of lineas) {
      sumar(l.asset.category.depreciationExpenseAccountId, l.costCenterId, l.importe, 0, `Depreciación ${year}-${mm}`);
      sumar(l.asset.category.accumulatedDepreciationAccountId, l.costCenterId, 0, l.importe, `Depreciación acumulada ${year}-${mm}`);
    }
    const total = round2(lineas.reduce((s, l) => s + l.importe, 0));
    const entry = await this.journal.post({
      date: corte,
      description: `Depreciación de activos fijos ${year}-${mm} (${lineas.length} activo${lineas.length === 1 ? '' : 's'})`,
      reference: `DEP-${year}${mm}`,
      type: 'AUTOMATIC',
      sourceType: 'FIXED_ASSET_DEPRECIATION',
      // Único por corrida: un mes se puede volver a correr para recoger activos nuevos.
      sourceId: `${year}-${mm}#${Date.now()}`,
      createdBy: user?.name || user?.email || null,
      lines: [...grupos.values()],
    });

    try {
      await this.prisma.$transaction(lineas.flatMap((l) => [
        this.prisma.depreciationEntry.create({
          data: {
            assetId: l.asset.id, year, month, date: corte, amount: l.importe,
            accumulatedAfter: l.acumuladaDespues, bookValueAfter: l.valorLibrosDespues, journalEntryId: entry.id,
          },
        }),
        this.prisma.fixedAsset.update({
          where: { id: l.asset.id },
          data: { accumulatedDepreciation: l.acumuladaDespues, ...(l.agotado ? { status: 'FULLY_DEPRECIATED' as const } : {}) },
        }),
      ]));
    } catch (e) {
      // El asiento ya quedó; sin los renglones, la próxima corrida lo duplicaría.
      await this.journal.reverse(entry.id, 'sistema (corrida de depreciación fallida)').catch(() => undefined);
      throw e;
    }
    return { year, month, total, assets: lineas.length, journalEntryId: entry.id, journalNumber: entry.number };
  }

  // ------------------------------------------------------------------ //
  //  Excel                                                             //
  // ------------------------------------------------------------------ //

  /** La fila de ejemplo de la plantilla empieza así; el cargue la salta aunque nadie la borre. */
  static readonly EJEMPLO = 'EJEMPLO:';

  static readonly COLUMNAS = [
    { header: 'codigo', key: 'codigo', width: 12, nota: 'Opcional. Vacío = se asigna AF-00001, AF-00002…' },
    { header: 'nombre', key: 'nombre', width: 32, nota: 'Obligatorio. Ej.: OLT Huawei MA5608T nodo Yopal' },
    { header: 'categoria', key: 'categoria', width: 16, nota: 'Obligatorio. Código o nombre (ver hoja Categorías): RED, COMP, MUEB, VEHIC' },
    { header: 'marca', key: 'marca', width: 14, nota: '' },
    { header: 'modelo', key: 'modelo', width: 16, nota: '' },
    { header: 'serial', key: 'serial', width: 20, nota: '' },
    { header: 'sede', key: 'sede', width: 14, nota: 'Nombre de la sede (ver hoja Sedes)' },
    { header: 'ubicacion', key: 'ubicacion', width: 22, nota: 'Nodo, rack, oficina…' },
    { header: 'responsable', key: 'responsable', width: 18, nota: '' },
    { header: 'latitud', key: 'latitud', width: 12, nota: 'Opcional. Ej.: 5.337812 (lo más fácil es tomarla después desde la ficha con el celular)' },
    { header: 'longitud', key: 'longitud', width: 12, nota: 'Opcional. Ej.: -72.395361' },
    { header: 'fecha_compra', key: 'fecha_compra', width: 14, nota: 'Obligatorio. AAAA-MM-DD o DD/MM/AAAA' },
    { header: 'fecha_uso', key: 'fecha_uso', width: 14, nota: 'Opcional. Vacío = la fecha de compra' },
    { header: 'costo', key: 'costo', width: 14, nota: 'Obligatorio. En pesos, sin puntos ni signo' },
    { header: 'valor_residual', key: 'valor_residual', width: 14, nota: 'Opcional. Vacío = 0' },
    { header: 'vida_util_meses', key: 'vida_util_meses', width: 14, nota: 'Opcional. Vacío = la de la categoría' },
    { header: 'proveedor', key: 'proveedor', width: 18, nota: '' },
    { header: 'factura', key: 'factura', width: 14, nota: 'Número de la factura de compra' },
    { header: 'notas', key: 'notas', width: 30, nota: '' },
  ];

  async template(): Promise<Buffer> {
    const { categories, branches } = await this.meta();
    const wb = new Workbook();
    const ws = wb.addWorksheet('Activos');
    ws.columns = FixedAssetsService.COLUMNAS.map(({ header, key, width }) => ({ header, key, width }));
    ws.getRow(1).font = { bold: true };
    FixedAssetsService.COLUMNAS.forEach((c, i) => { if (c.nota) ws.getRow(1).getCell(i + 1).note = c.nota; });
    ws.addRow({
      nombre: `${FixedAssetsService.EJEMPLO} OLT Huawei MA5608T (el cargue salta esta fila)`, categoria: 'RED', marca: 'Huawei', modelo: 'MA5608T', serial: '2102310RYU10J1000123',
      sede: branches[0]?.name ?? 'Yopal', ubicacion: 'Nodo principal, rack 1', responsable: 'Jefe de red',
      fecha_compra: '2025-03-15', costo: 8500000, proveedor: 'Proveedor S.A.S.', factura: 'FE-1234',
    });
    ws.getRow(2).font = { italic: true, color: { argb: 'FF888888' } };
    const wc = wb.addWorksheet('Categorías');
    wc.columns = [{ header: 'codigo', width: 10 }, { header: 'nombre', width: 38 }, { header: 'vida_util_meses', width: 16 }];
    wc.getRow(1).font = { bold: true };
    for (const c of categories) wc.addRow([c.code, c.name, c.usefulLifeMonths]);
    const wsd = wb.addWorksheet('Sedes');
    wsd.columns = [{ header: 'sede', width: 20 }];
    wsd.getRow(1).font = { bold: true };
    for (const b of branches) wsd.addRow([b.name]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Convierte la celda de fecha de Excel (Date, número de serie o texto) en `YYYY-MM-DD`. */
  private static fechaDeCelda(v: unknown): string | null {
    if (v == null || v === '') return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') {
      // Número de serie de Excel (días desde 1899-12-30).
      return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
    }
    const s = String((v as { text?: string })?.text ?? v).trim();
    let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(s);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  }

  private static numeroDeCelda(v: unknown): number | null {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    const r = (v as { result?: unknown })?.result;
    if (typeof r === 'number') return r;
    // Pesos colombianos: el punto es separador de miles y la coma decimal.
    const s = String(v).replace(/[$\s]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  async importExcel(buffer: Buffer, user: AuthUser) {
    const wb = new Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('El archivo no es un Excel (.xlsx) válido');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('El archivo no tiene hojas');

    const col: Record<string, number> = {};
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[\s.]+/g, '_');
    ws.getRow(1).eachCell((c, i) => { col[norm(String(c.value ?? ''))] = i; });
    const alias: Record<string, string[]> = {
      codigo: ['codigo', 'code', 'placa'], nombre: ['nombre', 'descripcion', 'activo', 'name'],
      categoria: ['categoria', 'tipo', 'clase'], marca: ['marca'], modelo: ['modelo'], serial: ['serial', 'serie', 'numero_de_serie', 's/n', 'sn'],
      sede: ['sede', 'sucursal'], ubicacion: ['ubicacion', 'lugar', 'nodo'], responsable: ['responsable', 'custodio', 'encargado'],
      fecha_compra: ['fecha_compra', 'fecha_de_compra', 'fecha_adquisicion', 'fecha'], fecha_uso: ['fecha_uso', 'fecha_en_uso', 'fecha_de_uso'],
      costo: ['costo', 'valor', 'valor_compra', 'costo_de_adquisicion'], valor_residual: ['valor_residual', 'residual'],
      vida_util_meses: ['vida_util_meses', 'vida_util', 'meses'], proveedor: ['proveedor'], factura: ['factura', 'numero_factura', 'factura_compra'],
      notas: ['notas', 'observaciones', 'nota'],
      latitud: ['latitud', 'lat', 'latitude'], longitud: ['longitud', 'lng', 'lon', 'longitude'],
    };
    const donde = (k: string) => alias[k].map(norm).map((a) => col[a]).find((i) => i != null) ?? null;
    const idx = Object.fromEntries(Object.keys(alias).map((k) => [k, donde(k)])) as Record<string, number | null>;
    for (const k of ['nombre', 'categoria', 'fecha_compra', 'costo']) {
      if (!idx[k]) throw new BadRequestException(`Falta la columna "${k}" en la primera fila (baja la plantilla para ver el formato)`);
    }

    const { categories, branches } = await this.meta();
    const catPor = new Map<string, string>();
    for (const c of categories) { catPor.set(norm(c.code), c.id); catPor.set(norm(c.name), c.id); }
    const sedePor = new Map(branches.map((b) => [norm(b.name), b.id]));

    let created = 0, skipped = 0;
    const errors: { row: number; message: string }[] = [];
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const val = (k: string) => (idx[k] ? row.getCell(idx[k]!).value : null);
      const texto = (k: string) => {
        const v = val(k);
        if (v == null) return '';
        if (typeof v === 'object' && v !== null && 'text' in v) return String((v as { text: unknown }).text ?? '').trim();
        if (typeof v === 'object' && v !== null && 'result' in v) return String((v as { result: unknown }).result ?? '').trim();
        return String(v).trim();
      };
      const nombre = texto('nombre');
      if (!nombre || nombre.toUpperCase().startsWith(FixedAssetsService.EJEMPLO)) { skipped++; continue; }
      try {
        const catId = catPor.get(norm(texto('categoria')));
        if (!catId) throw new BadRequestException(`categoría "${texto('categoria')}" no existe (usa RED, COMP, MUEB o VEHIC)`);
        const sede = texto('sede');
        const branchId = sede ? sedePor.get(norm(sede)) : undefined;
        if (sede && !branchId) throw new BadRequestException(`sede "${sede}" no existe`);
        const fechaCompra = FixedAssetsService.fechaDeCelda(val('fecha_compra'));
        if (!fechaCompra) throw new BadRequestException('fecha de compra vacía o ilegible');
        const costo = FixedAssetsService.numeroDeCelda(val('costo'));
        if (costo == null || costo < 0) throw new BadRequestException('costo vacío o inválido');
        const vida = FixedAssetsService.numeroDeCelda(val('vida_util_meses'));
        // Las coordenadas llevan punto decimal: no pasan por el lector de pesos.
        const coord = (k: string) => { const n = parseFloat(texto(k).replace(',', '.')); return Number.isFinite(n) ? n : undefined; };
        const lat = coord('latitud'), lng = coord('longitud');
        if ((lat == null) !== (lng == null)) throw new BadRequestException('la ubicación necesita latitud y longitud');
        if (lat != null && (Math.abs(lat) > 90 || Math.abs(lng!) > 180)) throw new BadRequestException('coordenadas fuera de rango');
        await this.create({
          code: texto('codigo') || undefined, name: nombre, categoryId: catId,
          brand: texto('marca'), model: texto('modelo'), serialNumber: texto('serial'),
          branchId, location: texto('ubicacion'), responsible: texto('responsable'),
          supplier: texto('proveedor'), invoiceNumber: texto('factura'), notes: texto('notas'),
          acquisitionDate: fechaCompra,
          inServiceDate: FixedAssetsService.fechaDeCelda(val('fecha_uso')) ?? undefined,
          acquisitionCost: costo,
          residualValue: FixedAssetsService.numeroDeCelda(val('valor_residual')) ?? 0,
          usefulLifeMonths: vida ? Math.round(vida) : undefined,
          latitude: lat, longitude: lng,
        }, user);
        created++;
      } catch (e) {
        errors.push({ row: i, message: (e as Error).message });
      }
    }
    return { created, skipped, errors };
  }

  async exportExcel(q: { search?: string; categoryId?: string; branchId?: string; status?: string }): Promise<Buffer> {
    const rows = await this.prisma.fixedAsset.findMany({
      where: this.filtro(q),
      include: { category: true, branch: true, _count: { select: { photos: true } } },
      orderBy: { code: 'asc' },
    });
    const ESTADO: Record<string, string> = { ACTIVE: 'En uso', FULLY_DEPRECIATED: 'Depreciado', DISPOSED: 'De baja' };
    const wb = new Workbook();
    const ws = wb.addWorksheet('Activos fijos');
    ws.columns = [
      { header: 'Código', key: 'code', width: 11 }, { header: 'Nombre', key: 'name', width: 32 },
      { header: 'Categoría', key: 'cat', width: 26 }, { header: 'Marca', key: 'brand', width: 14 },
      { header: 'Modelo', key: 'model', width: 16 }, { header: 'Serial', key: 'serial', width: 20 },
      { header: 'Sede', key: 'sede', width: 14 }, { header: 'Ubicación', key: 'loc', width: 22 },
      { header: 'Responsable', key: 'resp', width: 18 }, { header: 'Fecha compra', key: 'fc', width: 13 },
      { header: 'Costo', key: 'cost', width: 14 }, { header: 'Vida útil (meses)', key: 'life', width: 10 },
      { header: 'Depreciación a hoy', key: 'dep', width: 16 }, { header: 'Valor en libros', key: 'bv', width: 16 },
      { header: 'Estado', key: 'st', width: 12 }, { header: 'Fotos', key: 'ph', width: 7 },
      { header: 'Proveedor', key: 'sup', width: 18 }, { header: 'Factura', key: 'inv', width: 12 },
      { header: 'Latitud', key: 'lat', width: 12 }, { header: 'Longitud', key: 'lng', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    const hoy = anioMes(new Date());
    for (const a of rows) {
      const dep = acumuladaAl(a, hoy.y, hoy.m);
      ws.addRow({
        code: a.code, name: a.name, cat: a.category.name, brand: a.brand, model: a.model, serial: a.serialNumber,
        sede: a.branch?.name, loc: a.location, resp: a.responsible,
        fc: new Date(a.acquisitionDate.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10),
        cost: num(a.acquisitionCost), life: a.usefulLifeMonths, dep, bv: round2(num(a.acquisitionCost) - dep),
        st: ESTADO[a.status] ?? a.status, ph: a._count.photos, sup: a.supplier, inv: a.invoiceNumber,
        lat: a.latitude, lng: a.longitude,
      });
    }
    for (const k of ['cost', 'dep', 'bv']) ws.getColumn(k).numFmt = '#,##0';
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
