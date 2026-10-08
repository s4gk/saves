import { BadRequestException, ForbiddenException, NotFoundException } from '../core/http/errores';
import { IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { CobranzasService } from './cobranzas.service';
import { OrdersService } from '../orders/orders.service';
import { alcanceDe, esCajera } from './caja-scope';
import { hoyEnColombia } from '../common/fecha-colombia';
import { num } from '../common/money';

export class PagoFijoDto {
  @IsString() @MinLength(3) name!: string;
  @IsString() @MinLength(2) category!: string;
  @Type(() => Number) @IsNumber() @Min(1) amount!: number;
  @Type(() => Number) @IsInt() cashAccountId!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(31) dayOfMonth!: number;
  @IsOptional() @IsString() beneficiary?: string;
  @IsOptional() @IsString() note?: string;
  /** Orden de compra que salda (el beneficiario sale de su proveedor). */
  @IsOptional() @IsString() supplyOrderId?: string;
}

export class UpdatePagoFijoDto {
  @IsOptional() @IsString() @MinLength(3) name?: string;
  @IsOptional() @IsString() @MinLength(2) category?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) amount?: number;
  @IsOptional() @Type(() => Number) @IsInt() cashAccountId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31) dayOfMonth?: number;
  @IsOptional() @IsString() beneficiary?: string;
  @IsOptional() @IsString() note?: string;
  /** '' quita la orden. */
  @IsOptional() @IsString() supplyOrderId?: string;
  @IsOptional() active?: boolean;
}

export class EjecutarPagoFijoDto {
  /** Periodo que cubre ('YYYY-MM'). Sin él, el mes en curso. */
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) period?: string;
  /** Monto realmente pagado, si difiere del programado (un recibo de luz varía). */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) amount?: number;
  /**
   * Orden de compra que salda este pago (2026-10-05). Con ella el egreso es un
   * ABONO a la orden —baja su saldo y su comprobante se ve en la ficha— en vez
   * de un gasto suelto.
   */
  @IsOptional() @IsString() supplyOrderId?: string;
}

/**
 * Pagos fijos programados (2026-07-31).
 *
 * El flujo es de dos manos: CONTABILIDAD define el pago (qué, cuánto, de qué caja
 * y qué día del mes) y la CAJERA de esa caja registra la ejecución cuando paga.
 * Registrar la ejecución NO es un asiento aparte: crea un egreso en EFECTIVO por
 * `CobranzasService.createExpense`, así que cae solo al cierre de caja del día,
 * con las mismas reglas de alcance de siempre, y el comprobante se adjunta a esa
 * transacción (`/treasury/transactions/:id/attach`, el mismo camino que ya usa
 * el modal de egresos).
 */
export class PagosFijosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cobranzas: CobranzasService,
    private readonly orders: OrdersService,
  ) {}

  /** 'YYYY-MM' del mes en curso, en hora de Colombia. */
  private periodoActual(): string {
    return hoyEnColombia().toISOString().slice(0, 7);
  }

  /** Valida que la caja exista y sea una caja de sede (no un banco). */
  private async exigirCaja(cashAccountId: number) {
    const caja = await this.prisma.cashAccount.findUnique({
      where: { legacyId: cashAccountId },
      select: { holder: true, branchLegacy: true },
    });
    if (!caja) throw new BadRequestException('Esa caja no existe.');
    // Un pago fijo es plata que sale del CAJÓN de una ventanilla; atarlo a un
    // banco lo dejaría sin cajera que lo ejecute.
    if (caja.branchLegacy === 0) throw new BadRequestException('El pago fijo va atado a una caja de sede, no a un banco.');
    return caja;
  }

  /**
   * Órdenes de compra a las que todavía se les puede abonar: con saldo, no
   * cerradas y ya aprobadas. Son las «facturas disponibles» del selector de
   * beneficiario.
   */
  private async ordenesDisponibles() {
    const rows = await this.prisma.supplyOrder.findMany({
      // Sin «pendiente»: aunque el writeback le dé legacyId a una orden de la app
      // (y `paySupplyOrder` la dejaría pasar), sin aprobar no se ofrece para pagar.
      where: { status: { notIn: ['cancelado', 'anulado', 'finalizado', 'pendiente'] } },
      orderBy: { orderDate: 'desc' },
      select: { id: true, tid: true, total: true, paidAmount: true, status: true, notes: true, orderDate: true, supplier: { select: { name: true } } },
    });
    return rows
      .map((o) => ({
        id: o.id, tid: o.tid, supplier: o.supplier?.name ?? '—', status: o.status,
        notes: o.notes, date: o.orderDate,
        total: num(o.total), paid: num(o.paidAmount),
        saldo: Math.round((num(o.total) - num(o.paidAmount)) * 100) / 100,
      }))
      .filter((o) => o.saldo > 0.01);
  }

  /** Valida la orden que se ata al pago fijo y devuelve su proveedor. */
  private async exigirOrden(supplyOrderId: string) {
    const o = await this.prisma.supplyOrder.findUnique({
      where: { id: supplyOrderId },
      select: { id: true, tid: true, status: true, supplier: { select: { name: true } } },
    });
    if (!o) throw new BadRequestException('Esa orden de compra no existe.');
    if (['cancelado', 'anulado', 'finalizado'].includes(o.status)) {
      throw new BadRequestException(`La orden #${o.tid} está «${o.status}»; ya no admite pagos.`);
    }
    return o;
  }

  /**
   * Listado con el estado del periodo en curso. La cajera ve SOLO los de su caja;
   * contabilidad y administración los ven todos.
   */
  async list(user: AuthUser) {
    const periodo = this.periodoActual();
    let where = {};
    const cajera = esCajera(user);
    if (cajera) {
      const a = await alcanceDe(this.prisma, user);
      // Cajera sin caja asignada: no le corresponde ejecutar ninguno.
      where = { cashAccountId: a.caja ?? -1 };
    }
    const [pagos, cuentas, disponibles] = await Promise.all([
      this.prisma.scheduledPayment.findMany({
        where,
        orderBy: [{ active: 'desc' }, { dayOfMonth: 'asc' }, { name: 'asc' }],
        include: { runs: { where: { period: periodo } } },
      }),
      this.prisma.cashAccount.findMany({ select: { legacyId: true, holder: true } }),
      this.ordenesDisponibles(),
    ]);
    const nombreCaja = new Map(cuentas.map((c) => [c.legacyId, c.holder]));
    // La orden de compra que saldó la ejecución del mes, si se pagó contra una.
    const txIds = pagos.map((p) => p.runs[0]?.transactionId).filter((x): x is string => !!x);
    // Órdenes atadas a los pagos fijos (pueden estar ya saldadas y fuera de `disponibles`).
    const atadas = [...new Set(pagos.map((p) => p.supplyOrderId).filter((x): x is string => !!x))];
    const txs = txIds.length
      ? await this.prisma.transaction.findMany({
        where: { id: { in: txIds }, supplyOrderId: { not: null } },
        select: { id: true, supplyOrderId: true },
      })
      : [];
    const ordenes = txs.length
      ? await this.prisma.supplyOrder.findMany({
        where: { id: { in: txs.map((t) => t.supplyOrderId!) } },
        select: { id: true, tid: true },
      })
      : [];
    const ordenPorId = new Map(ordenes.map((o) => [o.id, o]));
    const ordenDeTx = new Map(txs.map((t) => [t.id, ordenPorId.get(t.supplyOrderId!) ?? null]));
    const filasAtadas = atadas.length
      ? await this.prisma.supplyOrder.findMany({
        where: { id: { in: atadas } },
        select: { id: true, tid: true, total: true, paidAmount: true, status: true, supplier: { select: { name: true } } },
      })
      : [];
    const ordenAtada = new Map(filasAtadas.map((o) => [o.id, {
      id: o.id, tid: o.tid, supplier: o.supplier?.name ?? '—', status: o.status,
      total: num(o.total), paid: num(o.paidAmount),
      saldo: Math.round((num(o.total) - num(o.paidAmount)) * 100) / 100,
    }]));
    return {
      periodo,
      items: pagos.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        amount: num(p.amount),
        cashAccountId: p.cashAccountId,
        caja: nombreCaja.get(p.cashAccountId) ?? `Caja ${p.cashAccountId}`,
        dayOfMonth: p.dayOfMonth,
        beneficiary: p.beneficiary,
        note: p.note,
        supplyOrder: (p.supplyOrderId && ordenAtada.get(p.supplyOrderId)) || null,
        active: p.active,
        createdByName: p.createdByName,
        // La ejecución del periodo en curso (o null = pendiente de pagar este mes).
        ejecucion: p.runs[0]
          ? {
              id: p.runs[0].id,
              amount: num(p.runs[0].amount),
              transactionId: p.runs[0].transactionId,
              executedByName: p.runs[0].executedByName,
              executedAt: p.runs[0].executedAt,
              order: (p.runs[0].transactionId && ordenDeTx.get(p.runs[0].transactionId)) || null,
            }
          : null,
      })),
      // La cajera solo ve las facturas (órdenes de compra) que contabilidad le
      // ató a los pagos fijos de SU caja; el catálogo completo es de contabilidad.
      ordenes: cajera ? disponibles.filter((o) => atadas.includes(o.id)) : disponibles,
    };
  }

  /** Historial de ejecuciones de un pago (consulta). */
  async runs(id: string) {
    const p = await this.prisma.scheduledPayment.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!p) throw new NotFoundException('Pago fijo no encontrado');
    const runs = await this.prisma.scheduledPaymentRun.findMany({
      where: { paymentId: id },
      orderBy: { period: 'desc' },
      take: 36,
    });
    return runs.map((r) => ({
      id: r.id, period: r.period, amount: num(r.amount),
      transactionId: r.transactionId, executedByName: r.executedByName, executedAt: r.executedAt,
    }));
  }

  async create(dto: PagoFijoDto, user: AuthUser) {
    await this.exigirCaja(dto.cashAccountId);
    const orden = dto.supplyOrderId ? await this.exigirOrden(dto.supplyOrderId) : null;
    const p = await this.prisma.scheduledPayment.create({
      data: {
        name: dto.name.trim(),
        category: dto.category.trim(),
        amount: dto.amount,
        cashAccountId: dto.cashAccountId,
        dayOfMonth: dto.dayOfMonth,
        beneficiary: dto.beneficiary?.trim() || orden?.supplier?.name || null,
        note: dto.note?.trim() || null,
        supplyOrderId: orden?.id ?? null,
        createdById: user.id ?? null,
        createdByName: user.name ?? null,
      },
    });
    return { id: p.id };
  }

  async update(id: string, dto: UpdatePagoFijoDto) {
    const p = await this.prisma.scheduledPayment.findUnique({ where: { id }, select: { id: true } });
    if (!p) throw new NotFoundException('Pago fijo no encontrado');
    if (dto.cashAccountId !== undefined) await this.exigirCaja(dto.cashAccountId);
    if (dto.supplyOrderId) await this.exigirOrden(dto.supplyOrderId);
    await this.prisma.scheduledPayment.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.category !== undefined ? { category: dto.category.trim() } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.cashAccountId !== undefined ? { cashAccountId: dto.cashAccountId } : {}),
        ...(dto.dayOfMonth !== undefined ? { dayOfMonth: dto.dayOfMonth } : {}),
        ...(dto.beneficiary !== undefined ? { beneficiary: dto.beneficiary.trim() || null } : {}),
        ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
        ...(dto.supplyOrderId !== undefined ? { supplyOrderId: dto.supplyOrderId || null } : {}),
        ...(dto.active !== undefined ? { active: !!dto.active } : {}),
      },
    });
    return { ok: true };
  }

  /** Borrar solo lo que nunca se ejecutó; con historial se DESACTIVA, no se borra. */
  async remove(id: string) {
    const p = await this.prisma.scheduledPayment.findUnique({
      where: { id },
      select: { id: true, _count: { select: { runs: true } } },
    });
    if (!p) throw new NotFoundException('Pago fijo no encontrado');
    if (p._count.runs > 0) {
      throw new BadRequestException('Este pago ya tiene ejecuciones registradas: desactívalo en vez de borrarlo, o su rastro en los cierres quedaría huérfano.');
    }
    await this.prisma.scheduledPayment.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Registrar la ejecución del pago para un periodo. Crea el egreso en efectivo
   * (cae al cierre del día de HOY) y deja el enlace pago↔egreso. Devuelve el
   * `transactionId` para que la UI le adjunte el comprobante acto seguido.
   */
  async ejecutar(id: string, dto: EjecutarPagoFijoDto, user: AuthUser) {
    const p = await this.prisma.scheduledPayment.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Pago fijo no encontrado');
    if (!p.active) throw new BadRequestException('Este pago fijo está desactivado.');

    // La cajera solo ejecuta los pagos de SU caja. (Para contabilidad y
    // administración, `createExpense` aplica su alcance normal.)
    if (esCajera(user)) {
      const a = await alcanceDe(this.prisma, user);
      if (a.caja !== p.cashAccountId) {
        throw new ForbiddenException('Este pago fijo pertenece a otra caja.');
      }
    }

    const period = dto.period ?? this.periodoActual();
    const ya = await this.prisma.scheduledPaymentRun.findUnique({
      where: { paymentId_period: { paymentId: p.id, period } },
    });
    if (ya) throw new BadRequestException(`El periodo ${period} ya está registrado como pagado.`);

    const amount = dto.amount ?? num(p.amount);
    const nota = `Pago fijo: ${p.name} (${period})`;

    // Contra una orden de compra: el abono va por el camino de la orden (valida
    // que esté aprobada y que el monto quepa en su saldo, la deja en "abonado" y
    // lo anota en su bitácora). Sigue siendo efectivo de la caja del pago fijo,
    // así que cae igual al cierre del día.
    // La orden escogida al pagar manda; si no, la que contabilidad le ató al pago.
    // La cajera no escoge: paga contra la orden que contabilidad le asignó (o
    // ninguna). Mandar otra es saltarse lo que contabilidad dejó para su sede.
    if (esCajera(user) && dto.supplyOrderId && dto.supplyOrderId !== p.supplyOrderId) {
      throw new ForbiddenException('Solo puedes pagar la orden de compra que contabilidad asignó a este pago fijo.');
    }
    const supplyOrderId = dto.supplyOrderId || p.supplyOrderId;
    if (supplyOrderId) {
      const r = await this.orders.paySupplyOrder(
        supplyOrderId,
        { amount, method: 'Cash', cashAccountId: p.cashAccountId, note: nota } as any,
        user,
      );
      const run = await this.prisma.scheduledPaymentRun.create({
        data: {
          paymentId: p.id, period, amount, transactionId: r.transactionId,
          executedById: user.id ?? null, executedByName: user.name ?? null,
        },
      });
      return { id: run.id, transactionId: r.transactionId, period, amount, supplyOrderId };
    }

    // El egreso va por el camino normal: método EFECTIVO (es plata del cajón),
    // categoría del pago, y nota que deja claro de qué pago fijo y periodo viene.
    const tx = await this.cobranzas.createExpense(
      {
        amount,
        category: p.category,
        method: 'Cash',
        cashAccountId: p.cashAccountId,
        payerName: p.beneficiary ?? undefined,
        note: nota,
      } as any,
      user,
    );

    const run = await this.prisma.scheduledPaymentRun.create({
      data: {
        paymentId: p.id,
        period,
        amount,
        transactionId: (tx as any)?.id ?? null,
        executedById: user.id ?? null,
        executedByName: user.name ?? null,
      },
    });
    return { id: run.id, transactionId: (tx as any)?.id ?? null, period, amount };
  }
}
