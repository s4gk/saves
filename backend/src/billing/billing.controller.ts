import type { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { PassThrough } from 'node:stream';
import { BillingService } from './billing.service';
import { invoicePdf } from './billing-pdf';
import { reciboRolloPdf } from '../common/pdf/recibo-rollo';
import { FacturasService } from './facturas.service';
import { CatalogoService } from './catalogo.service';
import { AsignarServicioDto, CancelPendingNoteDto, CreateInvoiceDto, CreateNoteDto, CreateNotesBulkDto, GenerateInvoicesDto, UpdateInvoiceDto, VoidInvoiceDto } from './dto/facturas.dto';
import { AuthUser } from '../auth/current-user.decorator';

/** Facturación y cartera (vertical migrado de saves-vestel). */
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly facturas: FacturasService,
    private readonly catalogo: CatalogoService,
  ) {}

  /** Catálogo facturable (planes + productos del legacy) para el selector de ítems. */
  catalog(search?: string, limit?: string) {
    return this.catalogo.buscar(search, limit ? Number(limit) : undefined);
  }

  /**
   * POR QUÉ se factura: los motivos que puede llevar una factura, con el concepto y
   * el precio de hoy de cada uno. Lo pide "Nueva factura" al abrirse.
   */
  motivos() {
    return this.catalogo.motivos();
  }

  /**
   * PDF de la factura. `?formato=rollo` la saca en papel de 80 mm — el recibo chico
   * que imprime la caja, que es lo que hacía el "Imprimir" del legacy.
   */
  async invoicePdf(
    id: string,
    res: Response,
    formato?: string,
    user?: AuthUser,
  ) {
    // El PDF va por el mismo `detail`, así que hereda el acotado por sede: sin pasar
    // el usuario, descargar el PDF sería la puerta trasera del filtro.
    if (formato === 'rollo') {
      const d = await this.billing.reciboRolloData(id, user);
      d.cashier = user?.name ?? null;
      d.cashierRole = user?.roles?.[0] ?? null;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="recibo-${d.number}.pdf"`);
      reciboRolloPdf(res, d);
      return;
    }
    const inv = await this.billing.detail(id, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="factura-${inv.tid}.pdf"`);
    invoicePdf(res, inv as any);
  }

  stats(from?: string, to?: string, all?: string, sede?: string, user?: AuthUser) {
    return this.billing.stats({ from, to, all, sede }, user);
  }

  aging() {
    return this.billing.aging();
  }

  list(
    search?: string,
    status?: string,
    ron?: string,
    branchId?: string,
    from?: string,
    to?: string,
    all?: string,
    overdue?: string,
    page?: string,
    pageSize?: string,
    sortBy?: string,
    sortDir?: string,
    user?: AuthUser,
  ) {
    return this.billing.list({ search, status, ron, branchId, from, to, all, overdue, page: Number(page), pageSize: Number(pageSize), sortBy, sortDir }, user);
  }

  /**
   * Excel del listado de facturas con los filtros de la pantalla. Reemplaza al CSV
   * que armaba el navegador: iba separado por comas y el Excel en español (que
   * separa con punto y coma) lo abría todo en una sola columna, con los montos
   * como texto. Aquí sale un .xlsx de verdad: encabezado con los filtros, columnas
   * con formato de fecha y pesos, totales al pie y una hoja de resumen.
   */
  async listXlsx(
    res: Response,
    search?: string,
    status?: string,
    ron?: string,
    branchId?: string,
    from?: string,
    to?: string,
    all?: string,
    overdue?: string,
    sortBy?: string,
    sortDir?: string,
    user?: AuthUser,
  ) {
    const data = await this.billing.exportRows({ search, status, ron, branchId, from, to, all, overdue, sortBy, sortDir }, user);
    const buffer = await libroFacturas(data, { search, status, ron, from, to, overdue });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="facturas-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buffer);
  }

  /** Envía la factura por WhatsApp (PDF adjunto) al cliente. */
  sendWhatsapp(id: string) {
    return this.billing.sendWhatsapp(id);
  }

  /** Envía la factura por correo (PDF adjunto) al cliente. */
  sendEmail(id: string) {
    return this.billing.sendEmail(id);
  }

  detail(id: string, user: AuthUser) {
    return this.billing.detail(id, user);
  }

  // --- Escritura (Cobranza) ---
  // Cada escritura lleva su propio @RequireArea('contabilidad'): el de la clase
  // incluye 'caja' para que la cajera CONSULTE facturas e imprima el recibo, y su
  // perfil sigue siendo de solo lectura sobre las facturas YA emitidas — no las
  // edita, no las anula y no emite notas. Sin el override, el botón oculto de la
  // UI era la única barrera y un POST a mano anulaba facturas.
  //
  // La ÚNICA escritura que sí se le abrió (2026-08-27) es `create`: cobrar en
  // ventanilla algo que todavía no está facturado —instalación, traslado, venta de
  // equipo, reconexión— exigía que contabilidad emitiera la factura primero, y eso
  // dejaba al cliente esperando en el mostrador. La factura que crea queda acotada
  // a los clientes de SU sede (`exigirSedeSuscriptor` en `createInvoice`).

  /** Última factura del cliente (para clonar en "Nueva factura"). */
  lastInvoice(id: string) {
    return this.facturas.lastInvoice(id);
  }

  /** Facturas del cliente para elegir en "Nueva nota" (pendientes; `scope=all` trae el histórico). */
  subscriberInvoices(id: string, scope: string | undefined, user: AuthUser) {
    return this.facturas.subscriberInvoices(id, scope, user);
  }

  /** Crear una factura. */
  create(dto: CreateInvoiceDto, user: AuthUser) {
    return this.facturas.createInvoice(dto, user);
  }

  /**
   * Editar una factura emitida: reemplaza sus conceptos y recalcula los totales
   * (paridad legacy `Invoices::editaction`). No toca sus notas crédito/débito.
   */
  update(id: string, dto: UpdateInvoiceDto, user: AuthUser) {
    return this.facturas.updateInvoice(id, dto, user);
  }

  /** Qué se le hizo a esta factura, quién y por qué (auditoría + notas + emisión). */
  historial(id: string, user: AuthUser) {
    return this.facturas.historial(id, user);
  }

  /**
   * Qué plan tiene asignado el abonado de esta factura para la próxima facturación,
   * y cuál es la factura de la que lo lee el legacy.
   */
  servicioAsignado(id: string, user: AuthUser) {
    return this.facturas.servicioAsignado(id, user);
  }

  /**
   * "Asignar servicio" (el `ASIGNAR SERVICIO` del legacy): fija el plan que se le
   * cobrará al abonado desde la próxima facturación. No reprecia esta factura.
   */
  asignarServicio(id: string, dto: AsignarServicioDto, user: AuthUser) {
    return this.facturas.asignarServicio(id, dto, user);
  }

  /** Generar facturas recurrentes en lote. */
  generate(dto: GenerateInvoicesDto, user: AuthUser) {
    return this.facturas.generate(dto, user);
  }

  /** Listado de notas crédito/débito (filtros: tipo, sede, fechas, autor, monto). */
  listNotes(
    page?: string,
    pageSize?: string,
    search?: string,
    type?: string,
    branchId?: string,
    from?: string,
    to?: string,
    authorId?: string,
    montoMin?: string,
    montoMax?: string,
    sortBy?: string,
    sortDir?: string,
    user?: AuthUser,
  ) {
    return this.facturas.listNotes(
      { page: Number(page), pageSize: Number(pageSize), search, type, branchId, from, to, authorId, montoMin, montoMax, sortBy, sortDir },
      user,
    );
  }

  /** Crear nota crédito/débito sobre una factura. */
  createNote(id: string, dto: CreateNoteDto, user: AuthUser) {
    return this.facturas.createNote(id, dto, user);
  }

  /**
   * Crear la MISMA nota sobre VARIAS facturas de un cliente (depuración de cartera).
   * El monto de cada factura viaja en `items`; todo el lote va en una transacción.
   */
  createNotes(dto: CreateNotesBulkDto, user: AuthUser) {
    return this.facturas.createNotes(dto, user);
  }

  /**
   * Nota crédito/débito PENDIENTE: el cliente aún no tiene la factura sobre la cual
   * aplicarla; se aplica sola a la próxima que nazca (corrida o factura manual).
   */
  createPendingNote(id: string, dto: CreateNoteDto, user: AuthUser) {
    return this.facturas.createPendingNote(id, dto, user);
  }

  /** Notas pendientes de un cliente (`subscriberId`) o todas las aún pendientes. */
  listPendingNotes(subscriberId: string | undefined, user: AuthUser) {
    return this.facturas.listPendingNotes(subscriberId, user);
  }

  /** Anular lo que quede sin aplicar de una nota pendiente. */
  cancelPendingNote(id: string, dto: CancelPendingNoteDto, user: AuthUser) {
    return this.facturas.cancelPendingNote(id, dto, user);
  }

  /** Anular una factura de venta (motivo obligatorio). */
  voidInvoice(id: string, dto: VoidInvoiceDto, user: AuthUser) {
    return this.facturas.voidInvoice(id, dto, user);
  }
}

const ESTADO_PAGO: Record<string, string> = { PAID: 'Pagada', DUE: 'Pendiente', PARTIAL: 'Parcial', CANCELED: 'Anulada' };
const RON: Record<string, string> = {
  ACTIVO: 'Activo', INSTALAR: 'Instalar', CORTADO: 'Cortado', SUSPENDIDO: 'Suspendido',
  EXONERADO: 'Exonerado', CARTERA: 'Cartera', COMPROMISO: 'Compromiso', DEPURADO: 'Depurado',
  RETIRADO: 'Retirado', ANULADO: 'Anulado', REPORTADO: 'Reportado', EVENTO: 'Evento',
  DADO_DE_BAJA: 'Dado de baja', POR_RETIRAR: 'Por retirar',
};
const PESOS = '"$"#,##0;[Red]-"$"#,##0';
const FECHA = 'dd/mm/yyyy';
const AZUL = 'FF1F3A5F';

type DatosExcel = Awaited<ReturnType<BillingService['exportRows']>>;

/**
 * El libro del Excel de facturación: hoja "Facturas" + hoja "Resumen".
 *
 * Va con el escritor en flujo de exceljs y los formatos puestos por columna, no
 * celda a celda: un año son ~48.000 facturas y con el libro en memoria tardaba
 * más de 25 s en salir.
 */
async function libroFacturas(
  data: DatosExcel,
  f: { search?: string; status?: string; ron?: string; from?: string; to?: string; overdue?: string },
) {
  const { rows } = data;
  const salida = new PassThrough();
  const trozos: Buffer[] = [];
  salida.on('data', (c: Buffer) => trozos.push(c));
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: salida, useStyles: true, useSharedStrings: false });
  wb.creator = 'Vestel';
  wb.created = new Date();

  // Qué se exportó, dicho en palabras: sin esto un archivo de "año en curso" y uno
  // de "todo el histórico" se ven iguales una vez guardados.
  const ventana = data.scope === 'historico' ? 'Todo el histórico'
    : data.scope === 'anio' ? `Año ${data.scopeYear}`
    : `Del ${f.from || '…'} al ${f.to || '…'}`;
  const filtros = [
    ventana,
    f.status && `Estado: ${ESTADO_PAGO[f.status] ?? f.status}`,
    f.ron && `Servicio: ${RON[f.ron] ?? f.ron}`,
    data.branchName && `Sede: ${data.branchName}`,
    (f.overdue === '1' || f.overdue === 'true') && 'Solo vencidas con saldo',
    f.search?.trim() && `Búsqueda: "${f.search.trim()}"`,
  ].filter(Boolean).join('  ·  ');
  const generado = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' });

  const cols: { header: string; key: string; width: number; fmt?: string; money?: boolean; center?: boolean }[] = [
    { header: 'N° factura', key: 'tid', width: 11, center: true },
    { header: 'Cliente', key: 'subscriber', width: 34 },
    { header: 'Abonado', key: 'abonado', width: 10, center: true },
    { header: 'Documento', key: 'doc', width: 17 },
    { header: 'Celular', key: 'phone', width: 14 },
    { header: 'Sede', key: 'branch', width: 15 },
    { header: 'Fecha', key: 'date', width: 12, fmt: FECHA, center: true },
    { header: 'Vence', key: 'dueDate', width: 12, fmt: FECHA, center: true },
    { header: 'Estado servicio', key: 'ron', width: 14 },
    { header: 'Motivo', key: 'purpose', width: 16 },
    // Cada servicio: plan, valor antes de IVA e IVA (si aplica). Con otros, descuento
    // y ajuste suman el total de la factura.
    { header: 'Plan internet', key: 'internet', width: 20 },
    { header: 'Valor internet (antes de IVA)', key: 'baseInternet', width: 15, fmt: PESOS, money: true },
    { header: 'IVA internet', key: 'ivaInternet', width: 12, fmt: PESOS, money: true },
    { header: 'Plan TV', key: 'tv', width: 16 },
    { header: 'Valor TV (antes de IVA)', key: 'baseTv', width: 15, fmt: PESOS, money: true },
    { header: 'IVA TV', key: 'ivaTv', width: 12, fmt: PESOS, money: true },
    { header: 'Otros conceptos (con IVA)', key: 'valorOtros', width: 15, fmt: PESOS, money: true },
    { header: 'Descuento (−)', key: 'discount', width: 13, fmt: PESOS, money: true },
    { header: 'Ajuste legacy', key: 'ajuste', width: 12, fmt: PESOS, money: true },
    { header: 'Total', key: 'total', width: 14, fmt: PESOS, money: true },
    { header: 'Pagado', key: 'paid', width: 14, fmt: PESOS, money: true },
    { header: 'Saldo', key: 'balance', width: 14, fmt: PESOS, money: true },
    { header: 'Estado pago', key: 'status', width: 12, center: true },
    { header: 'F. electrónica', key: 'eInvoice', width: 13, center: true },
  ];
  const HEAD = 5; // fila de títulos de columna
  const primera = HEAD + 1;
  const fin = HEAD + rows.length;
  const letra = (i: number) => String.fromCharCode(65 + i); // 25 columnas: A…Y
  const ultima = letra(cols.length - 1);

  const ws = wb.addWorksheet('Facturas', { views: [{ state: 'frozen', xSplit: 2, ySplit: HEAD }] });
  ws.columns = cols.map((c) => ({
    key: c.key, width: c.width,
    style: { ...(c.fmt ? { numFmt: c.fmt } : {}), ...(c.center ? { alignment: { horizontal: 'center' as const } } : {}) },
  }));
  ws.autoFilter = `A${HEAD}:${ultima}${Math.max(fin, HEAD)}`;

  // Encabezado del reporte (filas 1-3) y fila 4 en blanco.
  const titulo = (n: number, texto: string, font: Partial<ExcelJS.Font>) => {
    const row = ws.getRow(n);
    row.getCell(1).value = texto;
    row.getCell(1).font = font;
    row.getCell(1).alignment = { horizontal: 'left' };
    ws.mergeCells(`A${n}:${ultima}${n}`);
    row.commit();
  };
  titulo(1, 'Reporte de facturación', { bold: true, size: 14, color: { argb: AZUL } });
  titulo(2, filtros, { size: 10, color: { argb: 'FF555555' } });
  titulo(3, `${rows.length.toLocaleString('es-CO')} factura(s)  ·  Generado ${generado}`, { size: 10, color: { argb: 'FF555555' } });
  ws.getRow(4).commit();

  const head = ws.getRow(HEAD);
  head.height = 34; // dos renglones: "Valor internet (antes de IVA)"
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  head.commit();

  for (const r of rows) {
    const anulada = r.status === 'CANCELED';
    const row = ws.addRow({
      tid: r.tid,
      subscriber: r.subscriber,
      abonado: r.abonado ?? '',
      doc: r.docNumber ? `${r.docType ? `${r.docType} ` : ''}${r.docNumber}` : '',
      phone: r.phone ?? '',
      branch: r.branch ?? '',
      date: r.date, dueDate: r.dueDate,
      internet: r.internet ?? '', tv: r.tv ?? '',
      ron: r.ron ? RON[r.ron] ?? r.ron : '',
      purpose: r.purpose ?? '',
      baseInternet: r.baseInternet, ivaInternet: r.ivaInternet,
      baseTv: r.baseTv, ivaTv: r.ivaTv, valorOtros: r.valorOtros,
      discount: r.discount, ajuste: r.ajuste || null,
      // Una anulada no se debe: sin esto su "saldo" inflaba la cartera del pie.
      total: r.total, paid: r.paid, balance: anulada ? 0 : r.balance,
      status: ESTADO_PAGO[r.status] ?? r.status,
      eInvoice: r.eInvoice ? 'Sí' : '',
    });
    if (anulada) row.font = { color: { argb: 'FF999999' }, strike: true };
    else if (r.balance > 0) row.getCell('balance').font = { bold: true, color: { argb: 'FFC0392B' } };
    row.commit();
  }

  // Totales al pie con fórmula: si filtran con el autofiltro, SUBTOTAL(109) suma
  // sólo lo visible.
  if (rows.length) {
    const pie = ws.getRow(fin + 1);
    pie.getCell(2).value = 'TOTAL';
    cols.forEach((c, i) => {
      if (!c.money) return;
      const l = letra(i);
      pie.getCell(i + 1).value = { formula: `SUBTOTAL(109,${l}${primera}:${l}${fin})` };
    });
    pie.font = { bold: true };
    for (let i = 1; i <= cols.length; i++) pie.getCell(i).border = { top: { style: 'medium', color: { argb: AZUL } } };
    pie.commit();
  }
  ws.commit();

  // ── Hoja "Resumen": por estado de pago y por sede ─────────────────────────────
  const rs = wb.addWorksheet('Resumen');
  rs.columns = [
    { width: 24 },
    { width: 12, style: { numFmt: '#,##0' } },
    ...Array.from({ length: 8 }, () => ({ width: 17, style: { numFmt: PESOS } })),
  ];
  let n = 1;
  const linea = (valores: (string | number)[], estilo?: (row: ExcelJS.Row) => void) => {
    const row = rs.getRow(n++);
    row.values = valores;
    estilo?.(row);
    row.commit();
  };
  linea(['Resumen de facturación'], (r) => { r.getCell(1).font = { bold: true, size: 14, color: { argb: AZUL } }; });
  linea([filtros], (r) => { r.getCell(1).font = { size: 10, color: { argb: 'FF555555' } }; });
  n++;

  type Grupo = { n: number; internet: number; ivaInternet: number; tv: number; ivaTv: number; otros: number; total: number; paid: number; balance: number };
  const cero = (): Grupo => ({ n: 0, internet: 0, ivaInternet: 0, tv: 0, ivaTv: 0, otros: 0, total: 0, paid: 0, balance: 0 });
  const agrupar = (clave: (r: DatosExcel['rows'][number]) => string, filas = rows) => {
    const m = new Map<string, Grupo>();
    for (const r of filas) {
      const k = clave(r);
      const g = m.get(k) ?? cero();
      // "Otros" aquí es todo lo que no es internet ni TV: otros conceptos, descuento y ajuste.
      g.n++;
      g.internet += r.baseInternet; g.ivaInternet += r.ivaInternet;
      g.tv += r.baseTv; g.ivaTv += r.ivaTv;
      g.otros += r.total - r.baseInternet - r.ivaInternet - r.baseTv - r.ivaTv;
      g.total += r.total; g.paid += r.paid; g.balance += r.status === 'CANCELED' ? 0 : r.balance;
      m.set(k, g);
    }
    return m;
  };
  const redondo = (x: number) => Math.round(x);
  const tabla = (titulo: string, grupos: Map<string, Grupo>, nota?: string) => {
    linea([titulo, 'Facturas', 'Internet (antes de IVA)', 'IVA internet', 'TV (antes de IVA)', 'IVA TV', 'Otros', 'Total', 'Pagado', 'Saldo'], (r) => {
      for (let i = 1; i <= 10; i++) {
        r.getCell(i).alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
        r.getCell(i).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
      }
    });
    const suma = cero();
    const valores = (g: Grupo) => [g.n, ...[g.internet, g.ivaInternet, g.tv, g.ivaTv, g.otros, g.total, g.paid, g.balance].map(redondo)];
    for (const [k, g] of [...grupos.entries()].sort((a, b) => b[1].total - a[1].total)) {
      linea([k, ...valores(g)]);
      suma.n += g.n; suma.internet += g.internet; suma.ivaInternet += g.ivaInternet;
      suma.tv += g.tv; suma.ivaTv += g.ivaTv; suma.otros += g.otros;
      suma.total += g.total; suma.paid += g.paid; suma.balance += g.balance;
    }
    linea(['TOTAL', ...valores(suma)], (r) => {
      r.font = { bold: true };
      for (let i = 1; i <= 10; i++) r.getCell(i).border = { top: { style: 'medium', color: { argb: AZUL } } };
    });
    if (nota) linea([nota], (r) => { r.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF777777' } }; });
    n++;
  };
  tabla('Estado de pago', agrupar((r) => ESTADO_PAGO[r.status] ?? r.status), 'Internet y TV antes de IVA, con su IVA aparte. «Otros»: afiliaciones, traslados, equipos, notas, descuentos y ajustes. Las anuladas no suman saldo.');
  // Por sede sin las anuladas: no son plata que se deba ni que haya entrado.
  tabla('Sede', agrupar((r) => r.branch ?? 'Sin sede', rows.filter((r) => r.status !== 'CANCELED')), 'Sin facturas anuladas.');
  rs.commit();

  await wb.commit();
  return Buffer.concat(trozos);
}
