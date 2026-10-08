import mysql from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '../core/http/errores';
import { Logger } from '../core/logger';
import { PrismaService } from '../prisma/prisma.service';
import { CobranzasService } from '../treasury/cobranzas.service';
import { AuthUser } from '../auth/current-user.decorator';
import { num, round2 } from '../common/money';
import { Prisma } from '@prisma/client';
import { avisoAprobado, AvisoWompi, diaBogota, marcaTardio, motivoParaNoAplicar, TransaccionWompi } from './aprobados-tardios';

/**
 * EL WEB SERVICE DEL PORTAL DE PAGOS EN LÍNEA (`vestel.com.co/crm`).
 *
 * Hasta ahora el portal no le preguntaba nada a este sistema: le preguntaba TODO al
 * legacy, por HTTP, contra `https://vestel.saves.com.co/Servicio/*`. El portal no
 * tiene lógica propia —arma el widget de Wompi con lo que le contesten— así que
 * quien responda esas cinco llamadas es, de hecho, el sistema de facturación del
 * portal. Este módulo las responde desde aquí.
 *
 *   crm/application/models/Communication_model.php::obtener()
 *     └─ $_SESSION['url_web_service'] . '/' . $accion
 *
 * Los cinco métodos, con su forma EXACTA (el portal es PHP viejo y no valida nada:
 * si falta una clave, revienta con un notice y el cliente ve una página en blanco):
 *
 *   get_due_customer  {cid}                 -> {due, data_customer, data_promos,
 *                                              data_estados_promos, datos_wompi}
 *   inv_list          {cid,start,length,…}  -> respuesta DataTables server-side
 *   view_service      {tid}                 -> HTML de la factura
 *   aplicar_discount  {cid,promo}           -> {cid, promo}
 *   pay_due_customer  {cid,monto,idorden}   -> {cid, monto, idorden}
 *
 * ─── LO QUE CAMBIA AL RESPONDER DESDE AQUÍ ──────────────────────────────────────
 *
 * **El descuento.** Lo que el portal le cobra a Wompi es literalmente
 * `due.total - due.pamnt` (crm/application/controllers/Invoices.php), firmado con la
 * llave de integridad. Devolviendo aquí la deuda YA REBAJADA por las promociones
 * vigentes hoy, el portal cobra rebajado sin enterarse. Con eso desaparecen de un
 * golpe los tres parches que vivían alrededor de esto:
 *   · el 5 % quemado en el `else` de `Servicio::aplicar_discount`;
 *   · el descuento de cabecera que se escribía en la factura y no caducaba;
 *   · `portalPreapply`, que iba concediendo notas crédito POR ADELANTADO en el
 *     legacy para que el portal las viera (y había que retirarlas si nadie pagaba).
 * La promoción se concede donde siempre se concedió: al COBRAR, dentro de
 * `CobranzasService.collect`, y sólo si el pago salda la factura entera.
 *
 * **El pago.** `pay_due_customer` entra por `collect`, el mismo camino que la
 * ventanilla: cascada, reconexión, prorrateo, anticipos y e-factura. Antes lo
 * aplicaba `Customers_model::pay_invoices()` del legacy, que además abría su propia
 * orden de reconexión y su propia factura prorrateada — y como este sistema hacía lo
 * mismo por su cuenta al ver el pago, el abonado acababa con el cargo DOS VECES
 * (11 casos entre el 28-ago y el 9-sep de 2026). Con un solo sistema cobrando, eso
 * no puede volver a pasar.
 *
 * Lo que este módulo NO hace: escribir en `crm_vestel`. Esa base sigue siendo del
 * portal y aquí se lee y nada más.
 */

/** Fila de `crm_vestel.wompi_data_orden` (la orden de pago del portal). */
type OrdenPortal = {
  id: number;
  reference: string;
  debe: number;
  estado: string;
  cid_user: number;
  metodo_pago: string | null;
  id_wompi: string | null;
};

/** Cuenta del legacy donde entra la plata de Wompi (`accounts.id` = 23, holder WOMPI). */
const CUENTA_WOMPI = Number(process.env.PORTAL_WS_CASH_ACCOUNT_ID || 23);

/**
 * Método de pago del recaudo.
 *
 * Es la cadena "WOMPI" y no "Bank" a propósito: el legacy escribe `pmethod='WOMPI'`
 * en la factura (`pay_invoices` usa el mismo literal para buscar la cuenta), y el
 * writeback copia `Transaction.method` a ese campo. Con "Bank" la factura del legacy
 * quedaría con un método que allá no existe. El informe de cierre no se entera: agrupa
 * por NOMBRE DE CUENTA (`porBanco`), no por método.
 */
const METODO = 'WOMPI';

/** Lo que el portal manda cuando la transacción salió bien. */
const APROBADA = 'Finalizada con Exito';

export class PortalPagosService {
  private readonly logger = new Logger('PortalPagosService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly cobranzas: CobranzasService,
  ) {}

  // ------------------------------------------------------------------
  // Puerta: el apretón de manos del portal
  // ------------------------------------------------------------------

  /**
   * El portal firma cada llamada con dos md5 de sendas frases fijas
   * (`Communication_model::$us_str` / `$pss_str`). Aquí se comparan contra los md5
   * que estén en el entorno, para que las frases no vivan en este repositorio.
   *
   * Se comprueba ADEMÁS que la llamada venga del servidor del portal: la frase está
   * en un CodeIgniter cuyo código ha circulado en copias y espejos, y `pay_due_customer`
   * salda facturas. Con la lista de IPs puesta, quien tenga la frase pero no esté en
   * la lista no puede dar una factura por pagada.
   */
  exigirFirma(body: any, ip: string | null) {
    const usEsperado = (process.env.PORTAL_WS_USER_MD5 || '').trim().toLowerCase();
    const psEsperado = (process.env.PORTAL_WS_PASS_MD5 || '').trim().toLowerCase();
    if (!usEsperado || !psEsperado) {
      // Sin secreto configurado NO se abre la puerta. Un despliegue al que se le
      // olvidó el `.env` no puede acabar siendo un endpoint público que salda facturas.
      throw new ForbiddenException('El web service del portal no está configurado.');
    }
    const us = String(body?.['24q5ewqas'] ?? '').trim().toLowerCase();
    const ps = String(body?.['112415qwturf'] ?? '').trim().toLowerCase();
    if (!iguales(us, usEsperado) || !iguales(ps, psEsperado)) {
      throw new ForbiddenException('Credenciales del web service inválidas.');
    }
    const permitidas = (process.env.PORTAL_WS_IPS || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (permitidas.length && !permitidas.includes(normalizarIp(ip))) {
      this.logger.warn(`[portal-pagos] llamada rechazada desde ${ip}`);
      throw new ForbiddenException('Origen no autorizado.');
    }
  }

  /** ¿Está encendido el web service? Con el gate cerrado responde 503 y el portal reintenta. */
  get habilitado() {
    return process.env.PORTAL_WS_ENABLED === 'true';
  }

  // ------------------------------------------------------------------
  // 0. resolver_usuario — lo que el cliente tecleó en "Código de Usuario"
  // ------------------------------------------------------------------

  /**
   * El portal entra SOLO por `cid` (= `Subscriber.legacyId`), un número que el cliente
   * no conoce: teclea su abonado, su cédula o su correo, le sale "Invalid details" y
   * se le cambia la clave una y otra vez sin que sirva de nada (abonado 63887,
   * 2026-10-03). El login del portal pregunta aquí cuando no encuentra el `cid` y
   * prueba la clave contra cada candidato: la clave sigue siendo la que decide.
   *
   * Devuelve sólo `cid`s, nada del cliente: quien tenga la llave del web service ya
   * podía pedir la ficha entera con `get_due_customer`.
   */
  async resolverUsuario(texto: unknown): Promise<{ cids: number[] }> {
    const t = String(texto ?? '').trim();
    if (!t || t.length > 120) return { cids: [] };

    const filas = t.includes('@')
      ? await this.prisma.$queryRaw<{ legacyId: number }[]>`
          SELECT "legacyId" FROM "Subscriber"
          WHERE "legacyId" IS NOT NULL AND lower(trim(email)) = lower(${t})
          LIMIT 10`
      : await (async () => {
          // Puntos, espacios y guiones fuera: "1.983.451" y "1983451" son la misma cédula.
          const d = t.replace(/[\s.\-]/g, '');
          if (!/^\d{1,15}$/.test(d)) return [];
          const n = Number(d);
          return this.prisma.$queryRaw<{ legacyId: number }[]>`
            SELECT "legacyId" FROM "Subscriber"
            WHERE "legacyId" IS NOT NULL
              AND ("legacyId" = ${n <= 2147483647 ? n : -1}
                OR abonado = ${n <= 2147483647 ? n : -1}
                OR regexp_replace(coalesce("docNumber", ''), '[^0-9]', '', 'g') = ${d})
            LIMIT 10`;
        })();

    return { cids: [...new Set(filas.map((f) => Number(f.legacyId)))] };
  }

  // ------------------------------------------------------------------
  // 1. get_due_customer — la deuda y con qué se cobra
  // ------------------------------------------------------------------

  /**
   * Lo que el portal necesita para pintar la página y firmar la orden de Wompi.
   *
   * `due` imita la fila que devolvía `Customers_model::due_details()`: un `SELECT *`
   * sobre `invoices` con `SUM(total)`/`SUM(pamnt)` encima. De todo eso el portal sólo
   * lee `total` y `pamnt`, y siempre restándolos (comprobado en las tres vistas que
   * los tocan), así que aquí se devuelve la deuda en `total` y `pamnt` en 0. Los demás
   * campos van igualmente rellenos: son los de la última factura, que es lo que el
   * legacy acababa devolviendo, y un `undefined` en PHP es un notice en pantalla.
   */
  async getDueCustomer(cid: number) {
    const sub = await this.abonadoDe(cid);

    // La deuda y el descuento salen de la MISMA función que usa la ventanilla
    // (`subscriberDebt`): que el portal y la cajera digan números distintos por el
    // mismo cliente el mismo día es exactamente lo que se vino a arreglar.
    const deuda = await this.cobranzas.subscriberDebt(sub.id);
    // En PESOS ENTEROS: el portal arma `amount-in-cents` pegándole "00" al texto de
    // `total - pamnt` (crm/application/views/invoices/invoices.php), así que 76601.11
    // sale "76601.1100" y Wompi lo rechaza ("Formato inválido para el valor de
    // amount-in-cents"). Hacia ARRIBA: hacia abajo dejaría la factura PARTIAL por
    // centavos; así sobran como mucho 99 centavos, que quedan de saldo a favor.
    const aPagar = Math.max(0, Math.ceil(round2(deuda.totalConDescuento)));

    const ultima = await this.prisma.subInvoice.findFirst({
      where: { subscriberId: sub.id },
      orderBy: [{ invoiceDate: 'desc' }, { tid: 'desc' }],
      select: {
        id: true, tid: true, legacyId: true, invoiceDate: true, dueDate: true,
        subtotal: true, shipping: true, discount: true, tax: true, total: true,
        paidAmount: true, status: true, paymentMethod: true, itemsCount: true,
        branchRef: true, serviceTv: true, serviceCombo: true, puntos: true,
        estadoTv: true, estadoCombo: true, term: true, rec: true, ron: true,
        streamingStandard: true, streamingPremium: true, streamingPremiumPlus: true,
        streamingDiamante: true, kind: true,
      },
    });

    return {
      due: {
        id: ultima?.legacyId ?? null,
        tid: ultima?.tid ?? null,
        invoicedate: fecha(ultima?.invoiceDate),
        invoiceduedate: fecha(ultima?.dueDate),
        subtotal: entero(ultima?.subtotal),
        shipping: entero(ultima?.shipping),
        discount: entero(ultima?.discount),
        tax: entero(ultima?.tax),
        // ── Los dos únicos campos que el portal usa de verdad ──
        // `total - pamnt` es lo que se le cobra a Wompi, y va YA con el descuento
        // de las promociones vigentes hoy (ver la cabecera del fichero).
        total: aPagar,
        pamnt: 0,
        pmethod: ultima?.paymentMethod ?? null,
        notes: '',
        status: ultima ? ESTADO_FACTURA[ultima.status] ?? 'due' : 'due',
        csd: String(cid),
        items: ultima?.itemsCount ?? 0,
        refer: ultima?.branchRef ?? '',
        television: ultima?.serviceTv ?? '',
        estado_tv: ultima?.estadoTv ?? null,
        combo: ultima?.serviceCombo ?? '',
        estado_combo: ultima?.estadoCombo ?? null,
        puntos: ultima?.puntos ?? 0,
        streaming_standard: ultima?.streamingStandard ?? 0,
        streaming_premium: ultima?.streamingPremium ?? 0,
        streaming_premium_plus: ultima?.streamingPremiumPlus ?? 0,
        streaming_diamante: ultima?.streamingDiamante ?? 0,
        term: ultima?.term ?? 0,
        rec: ultima?.rec ?? '',
        ron: estadoLegacy(ultima?.ron ?? sub.status),
        tipo_factura: ultima?.kind === 'FIJA' ? 'Fija' : 'Recurrente',
        // `MAX(ron)` del legacy: el estado del cliente, que la vista rotula arriba.
        estado: estadoLegacy(sub.status),
      },
      data_customer: this.fichaLegacy(sub),
      /**
       * Las dos llaves que gobiernan el botón "aplicar descuento" de la vista
       * (`crm/application/views/invoices/invoices.php`, línea 304):
       *
       *   if(!($promo1!=null || (isset($data_estados_promos) && count($data_estados_promos)==0)))
       *
       * Con `data_promos` no nulo el botón NO se pinta, que es lo que queremos: el
       * monto ya viene rebajado y un botón que "aplica" un descuento ya aplicado sólo
       * puede confundir (y en el legacy lo aplicaba de verdad, otra vez, encima).
       */
      data_promos: '1',
      data_estados_promos: [] as unknown[],
      /**
       * Llaves de Wompi. El portal hace `json_decode($dt->datos_wompi->valor)` y saca
       * de ahí `public_key` / `private_key` / `integridad_key`, así que la forma tiene
       * que ser la de la fila del legacy: `{valor: '<json>'}`. Se leen de allá y no se
       * copian aquí a propósito — son las que de verdad están cobrando, y duplicarlas
       * sería tener dos sitios donde rotar una llave de producción.
       */
      datos_wompi: await this.llavesWompi(),
    };
  }

  // ------------------------------------------------------------------
  // 2. inv_list — la tabla de facturas del portal (DataTables server-side)
  // ------------------------------------------------------------------

  /**
   * Mismas cuatro columnas que servía el legacy y en el mismo orden: fecha, total
   * formateado, estado con su `<span class="st-…">` (la hoja de estilos del portal
   * las colorea por esa clase) y el botón Ver.
   */
  async invList(p: { cid: number; start?: number; length?: number; search?: string; order?: any[]; draw?: number }) {
    const sub = await this.abonadoDe(p.cid);
    const start = Math.max(0, Number(p.start) || 0);
    const length = Math.min(200, Math.max(1, Number(p.length) || 10));
    const search = (p.search ?? '').toString().trim();

    // El buscador del portal es un solo cuadro sobre las columnas visibles.
    const where = {
      subscriberId: sub.id,
      ...(search
        ? {
            OR: [
              ...(Number.isFinite(Number(search)) ? [{ tid: Number(search) }] : []),
              ...(/^\d{4}-\d{2}(-\d{2})?$/.test(search)
                ? [{ invoiceDate: { gte: new Date(`${search.length === 7 ? `${search}-01` : search}T00:00:00Z`) } }]
                : []),
            ],
          }
        : {}),
    };
    const sinFiltro = { subscriberId: sub.id };

    const [total, filtradas, filas] = await Promise.all([
      this.prisma.subInvoice.count({ where: sinFiltro }),
      this.prisma.subInvoice.count({ where }),
      this.prisma.subInvoice.findMany({
        where,
        // El legacy ordena por fecha descendente: lo último arriba, que es lo que el
        // cliente viene a mirar. `tid` desempata — `invoiceDate` no tiene hora.
        orderBy: [{ invoiceDate: 'desc' }, { tid: 'desc' }],
        skip: start,
        take: length,
        select: { tid: true, invoiceDate: true, total: true, status: true },
      }),
    ]);

    return {
      draw: Number(p.draw) || 0,
      recordsTotal: total,
      recordsFiltered: filtradas,
      data: filas.map((f) => [
        fecha(f.invoiceDate),
        montoLegacy(num(f.total)),
        `<span class="st-${ESTADO_FACTURA[f.status] ?? 'due'}">${ETIQUETA_ESTADO[f.status] ?? 'Pendiente'}</span>`,
        // Mismo botón, mismas clases y hasta el mismo doble espacio que servía el
        // legacy: la hoja de estilos y el JS del portal cuentan con ellos.
        //
        // Lo que NO se reproduce es el desplegable de recibos que iba detrás: el legacy
        // lo montaba con enlaces a `https://www.saves-vestel.com/comprobantes?name=…`,
        // y ese dominio hace tiempo que no resuelve (comprobado el 2026-09-10: sin DNS).
        // Era un botón que sólo podía dar error; se deja fuera hasta que los recibos de
        // este sistema tengan una URL que un cliente sin sesión pueda abrir.
        `<a  href="${BASE_PORTAL}/invoices/view?id=${f.tid}" class="btn btn-success btn-xs">`
          + `<i class="icon-file-text"></i> Ver</a> &nbsp; &nbsp;&nbsp;`,
      ]),
    };
  }

  // ------------------------------------------------------------------
  // 3. view_service — el HTML de una factura
  // ------------------------------------------------------------------

  /**
   * El legacy devolvía aquí una vista de CodeIgniter renderizada, que el portal
   * inserta entre su cabecera y su pie (`Invoices::view`). Se reproduce en HTML plano:
   * el portal ya trae Bootstrap, así que basta con la tabla.
   *
   * Se comprueba que la factura sea de quien la pide cuando el portal manda el `cid`.
   * El legacy no lo comprobaba: con cambiar el `?id=` de la barra se veía la factura
   * de cualquier abonado.
   */
  async viewService(tid: number, cid?: number) {
    const inv = await this.prisma.subInvoice.findFirst({
      where: { tid },
      select: {
        tid: true, invoiceDate: true, dueDate: true, total: true, paidAmount: true,
        status: true, discount: true, tax: true, subtotal: true,
        subscriber: { select: { id: true, legacyId: true, abonado: true, firstName: true, secondName: true, lastName1: true, lastName2: true, companyName: true, fullName: true, docNumber: true } },
        items: { orderBy: { id: 'asc' as const }, select: { productName: true, description: true, qty: true, price: true, subtotal: true, taxTotal: true, discountTotal: true } },
      },
    });
    if (!inv) throw new NotFoundException('Factura no encontrada');
    if (cid && inv.subscriber?.legacyId && Number(inv.subscriber.legacyId) !== Number(cid)) {
      throw new ForbiddenException('Esa factura no es de esta cuenta.');
    }

    const saldo = round2(num(inv.total) - num(inv.paidAmount));
    const lineas = inv.items.map((i) => `
        <tr>
          <td>${escapar(i.description || i.productName || '')}</td>
          <td class="text-right">${i.qty}</td>
          <td class="text-right">${montoLegacy(num(i.price))}</td>
          <td class="text-right">${montoLegacy(num(i.subtotal) + num(i.taxTotal) - num(i.discountTotal))}</td>
        </tr>`).join('');

    return `
<div class="container" style="padding:20px">
  <h3>Factura #${inv.tid}</h3>
  <p>
    <strong>${escapar(nombreDe(inv.subscriber))}</strong>${inv.subscriber?.docNumber ? ` · ${escapar(inv.subscriber.docNumber)}` : ''}<br>
    Abonado ${inv.subscriber?.abonado ?? ''}<br>
    Fecha: ${fecha(inv.invoiceDate)} · Vence: ${fecha(inv.dueDate)}<br>
    Estado: <span class="st-${ESTADO_FACTURA[inv.status] ?? 'due'}">${ETIQUETA_ESTADO[inv.status] ?? 'Pendiente'}</span>
  </p>
  <table class="table table-bordered">
    <thead><tr><th>Concepto</th><th class="text-right">Cant.</th><th class="text-right">Valor</th><th class="text-right">Total</th></tr></thead>
    <tbody>${lineas}</tbody>
    <tfoot>
      <tr><th colspan="3" class="text-right">Subtotal</th><th class="text-right">${montoLegacy(num(inv.subtotal))}</th></tr>
      ${num(inv.discount) ? `<tr><th colspan="3" class="text-right">Descuento</th><th class="text-right">- ${montoLegacy(num(inv.discount))}</th></tr>` : ''}
      ${num(inv.tax) ? `<tr><th colspan="3" class="text-right">IVA</th><th class="text-right">${montoLegacy(num(inv.tax))}</th></tr>` : ''}
      <tr><th colspan="3" class="text-right">Total</th><th class="text-right">${montoLegacy(num(inv.total))}</th></tr>
      <tr><th colspan="3" class="text-right">Pagado</th><th class="text-right">${montoLegacy(num(inv.paidAmount))}</th></tr>
      <tr><th colspan="3" class="text-right">Saldo</th><th class="text-right">${montoLegacy(saldo)}</th></tr>
    </tfoot>
  </table>
</div>`;
  }

  // ------------------------------------------------------------------
  // 4. aplicar_discount — ya no escribe nada
  // ------------------------------------------------------------------

  /**
   * En el legacy este botón escribía `invoices.discount` sobre la ÚLTIMA factura del
   * cliente y bajaba su total. De ahí salieron dos fugas que ya están documentadas: el
   * `else { $promo = 5; }` que regalaba el descuento sin promoción vigente (20,7 M COP
   * históricos) y el hecho de que, una vez escrito, el descuento no caducaba nunca.
   *
   * Aquí no hay nada que aplicar: `get_due_customer` ya devuelve la deuda rebajada y la
   * promoción se concede al cobrar, dentro de la transacción del pago. Se responde con
   * la misma forma de siempre para no romper el `json_decode` del portal — que, además,
   * con `data_promos` no nulo ya ni siquiera pinta el botón.
   */
  aplicarDiscount(cid: number, promo: unknown) {
    return { cid, promo, aplicado: false, motivo: 'El descuento ya viene incluido en el valor a pagar.' };
  }

  // ------------------------------------------------------------------
  // 5. pay_due_customer — el pago
  // ------------------------------------------------------------------

  /**
   * Aplica el pago que Wompi ya cobró.
   *
   * Tres cosas que el legacy no hacía y que aquí no son opcionales:
   *
   * 1. **No se cree el monto que manda el portal.** Se contrasta contra la orden en
   *    `crm_vestel.wompi_data_orden`, que es la fila que escribe el webhook firmado de
   *    Wompi: la referencia tiene que existir, estar aprobada, ser de este abonado y
   *    traer ese mismo `debe`. Sin esto, quien conociera la frase del apretón de manos
   *    podría dar por pagada cualquier factura con un POST.
   * 2. **Es idempotente por referencia.** El webhook de Wompi reintenta, y el legacy
   *    volvía a repartir el dinero cada vez. La huella es `PaymentOrder.appliedAt`.
   * 3. **Sella la orden para el puente.** `online-payments` reconecta a quien pagó y
   *    sigue cortado; marcando `appliedAt` aquí, el puente no vuelve a pasar por encima
   *    de un abonado al que `collect` ya le devolvió el servicio.
   */
  async payDueCustomer(cid: number, monto: number, idorden: string) {
    const sub = await this.abonadoDe(cid);
    const referencia = (idorden ?? '').toString().trim();
    if (!referencia) throw new BadRequestException('Falta la referencia de la orden.');

    const importe = round2(Number(monto));
    if (!(importe > 0)) throw new BadRequestException('El monto debe ser mayor a cero.');

    // ── 1. El pago existe de verdad, es de este cliente y por este valor ──────
    // Se comprueba ANTES de tocar nada: la fuente es `crm_vestel.wompi_data_orden`, la
    // fila que escribe el webhook firmado de Wompi. Sin esto, quien conociera la frase
    // del apretón de manos podría dar por pagada cualquier factura con un POST.
    const orden = await this.ordenDelPortal(referencia);
    if (!orden) throw new BadRequestException('Esa referencia no existe en el portal.');
    if (orden.estado !== APROBADA) {
      throw new BadRequestException(`La orden ${referencia} no está aprobada (${orden.estado}).`);
    }
    if (Number(orden.cid_user) !== Number(cid)) {
      throw new ForbiddenException('La orden no pertenece a ese abonado.');
    }
    if (round2(Number(orden.debe)) !== importe) {
      throw new BadRequestException(
        `El monto no coincide con la orden del portal (portal ${orden.debe}, recibido ${importe}).`,
      );
    }

    return this.sellarYAplicar(sub, cid, importe, referencia, orden);
  }

  /**
   * Sella la orden y aplica el pago. Quien llama ya comprobó que el pago existe, es de
   * este abonado y es por este valor: `payDueCustomer` contra la orden del portal,
   * `recogerAprobadosTardios` contra la API de Wompi.
   */
  private async sellarYAplicar(
    sub: Awaited<ReturnType<PortalPagosService['abonadoDe']>>,
    cid: number, importe: number, referencia: string, orden: OrdenPortal,
  ) {
    // ── 2. El sello ──────────────────────────────────────────────────────────
    // Se PIDE, no se comprueba. Dos caminos pueden llamar a la vez —el aviso de Wompi y
    // la red de seguridad del cron— y leer-y-luego-escribir deja un hueco entre las dos
    // operaciones por el que caben ambas; perder esa carrera es cobrarle dos veces al
    // cliente. `updateMany` con `appliedAt: null` en el WHERE es UNA escritura
    // condicional: sólo una de las dos se lleva la orden.
    if (!(await this.sellar(referencia, sub.id, importe, orden))) {
      this.logger.log(`[portal-pagos] ${referencia} ya estaba aplicada; no se repite.`);
      return { cid, monto: importe, idorden: referencia, yaAplicado: true };
    }

    // ── 3. El recaudo ────────────────────────────────────────────────────────
    try {
      return await this.aplicar(sub, cid, importe, referencia, orden);
    } catch (e) {
      // Se suelta el sello. Si no, un fallo dejaría la orden marcada como aplicada y ni
      // el aviso de Wompi ni la red de seguridad volverían a intentarlo nunca: el
      // cliente habría pagado y su factura seguiría abierta para siempre. Es justo lo
      // que le pasó al primer pago que entró por aquí (la transacción se pasó del tope).
      await this.prisma.paymentOrder.updateMany({
        where: { reference: referencia }, data: { appliedAt: null },
      }).catch(() => undefined);
      throw e;
    }
  }

  /**
   * Marca la orden como "me la llevo yo" y dice si lo consiguió.
   *
   * La fila puede no existir todavía: el puente (`online-payments`) ingesta las órdenes
   * del portal cada 5 minutos y el aviso de Wompi llega en segundos. En ese caso se crea
   * aquí —con el sello ya puesto— en vez de rechazar un pago legítimo; el índice único
   * sobre `reference` es el que arbitra si dos llamadas intentan crearla a la vez.
   */
  private async sellar(referencia: string, subscriberId: string, importe: number, orden: OrdenPortal) {
    const tomada = await this.prisma.paymentOrder.updateMany({
      where: { reference: referencia, appliedAt: null },
      data: { appliedAt: new Date() },
    });
    if (tomada.count > 0) return true;

    const existe = await this.prisma.paymentOrder.findUnique({
      where: { reference: referencia }, select: { appliedAt: true },
    });
    if (existe) return false; // existe y ya estaba sellada

    try {
      await this.prisma.paymentOrder.create({
        data: {
          reference: referencia,
          subscriberId,
          gateway: 'wompi',
          amount: importe,
          currency: 'COP',
          status: 'APPROVED',
          method: orden.metodo_pago || null,
          gatewayTxId: orden.id_wompi || null,
          appliedAt: new Date(),
          appliedBy: 'NEXUS',
          rawInit: { portalId: Number(orden.id), estadoPortal: orden.estado, cidUser: Number(orden.cid_user) },
          updatedAt: new Date(),
        },
      });
      return true;
    } catch {
      // Otra llamada la creó entre medias: suya es.
      return false;
    }
  }

  /** El cuerpo del pago, ya con la orden sellada a nombre de esta llamada. */
  private async aplicar(
    sub: Awaited<ReturnType<PortalPagosService['abonadoDe']>>,
    cid: number, importe: number, referencia: string, orden: OrdenPortal,
  ) {
    // ── El recaudo, por el mismo camino que la ventanilla ─────────────────────
    const resultado = await this.cobranzas.collect(
      {
        subscriberId: sub.id,
        amount: importe,
        method: METODO,
        cashAccountId: CUENTA_WOMPI,
        accountName: 'WOMPI',
        reference: referencia,
      },
      this.usuarioSistema(),
    );

    // La referencia de la pasarela va en `payuOrderId`, que es por donde el puente de
    // `online-payments` y la pantalla de pagos en línea enlazan la orden con su plata.
    // El sync la traía sola desde `transactions.id_orden_payu`; naciendo el movimiento
    // aquí, hay que escribirla.
    const movimientos = await this.prisma.receiptTransaction.findMany({
      where: { receiptId: resultado.receiptId },
      select: { transactionId: true },
    });
    if (movimientos.length) {
      await this.prisma.transaction.updateMany({
        where: { id: { in: movimientos.map((m) => m.transactionId) } },
        data: { payuOrderId: referencia },
      });
    }

    // Sella la orden: aplicada y con su recaudo apuntado.
    await this.prisma.paymentOrder.updateMany({
      where: { reference: referencia },
      data: {
        status: 'APPROVED',
        // `appliedAt` ya lo puso el sello de arriba.
        // Quién imputó la plata. Se ESCRIBE, no se deduce: el writeback adopta el gemelo
        // del legacy y le estampa su `legacyId`, con lo que un recaudo nacido aquí acaba
        // pareciendo traído de allá.
        appliedBy: 'NEXUS',
        method: orden.metodo_pago || null,
        gatewayTxId: orden.id_wompi || null,
        transactionId: movimientos[0]?.transactionId ?? null,
      },
    });

    this.logger.log(
      `[portal-pagos] pago aplicado · abonado ${sub.abonado} · $${importe} · ref ${referencia}`
      + ` · ${resultado.applied.length} factura(s)`
      + (resultado.advance ? ` · $${resultado.advance} a favor` : '')
      + (resultado.promo?.total ? ` · −$${resultado.promo.total} de ${resultado.promo.facturas[0]?.promocion ?? 'promoción'}` : ''),
    );

    return {
      cid,
      monto: importe,
      idorden: referencia,
      recibo: resultado.fileName,
      facturas: resultado.applied.map((a) => a.tid),
      saldoAFavor: resultado.advance,
    };
  }

  // ------------------------------------------------------------------
  // Red de seguridad: el pago que se cayó
  // ------------------------------------------------------------------

  /**
   * Recoge los pagos APROBADOS por Wompi que este sistema no llegó a aplicar.
   *
   * Hace falta porque el aviso del portal es un DISPARO ÚNICO, no una cola con
   * reintentos: `Tickets::data_reception_wompi` marca la orden como aprobada y sólo
   * entonces llama al pago, dentro de un `if ($orden->estado == "Inicial")` que él mismo
   * acaba de dejar de cumplir. Si esa llamada falla —y el primer pago que pasó por aquí,
   * el 10-09-2026, falló: la transacción de Prisma se pasó de los 5 s por defecto—
   * nadie la repite: el cliente pagó, Wompi cobró y la factura se queda abierta.
   *
   * Entra sólo lo que cumple las tres condiciones a la vez:
   *   · la orden está APROBADA en el portal y sin sellar aquí (`appliedAt` null);
   *   · no hay ningún movimiento con esa referencia (ni de aquí ni traído del legacy),
   *     así que la plata NO está contabilizada por ninguna vía;
   *   · el abonado todavía debe algo.
   * El pago se aplica por el mismo `payDueCustomer`, que vuelve a comprobar la orden
   * contra `crm_vestel` y es idempotente.
   *
   * `PORTAL_WS_RESCATE_DIAS` acota la ventana hacia atrás (3 por defecto): un aprobado
   * de hace un mes que sigue sin aplicar no es un fallo de red, es un caso que alguien
   * tiene que mirar, y aplicarlo a ciegas podría cobrar dos veces si allá se resolvió
   * a mano.
   */
  async recogerPagosCaidos(opts: { dias?: number; dryRun?: boolean } = {}) {
    const dias = opts.dias ?? Number(process.env.PORTAL_WS_RESCATE_DIAS || 3);
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

    const candidatas = await this.prisma.paymentOrder.findMany({
      where: { gateway: 'wompi', status: 'APPROVED', appliedAt: null, createdAt: { gte: desde } },
      select: {
        reference: true, amount: true, rawWebhook: true,
        subscriber: { select: { legacyId: true, abonado: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }).then((filas) => filas.filter((f) => !marcaTardio(f.rawWebhook)));
    // ↑ Fuera los aprobados en un reintento: el portal los tiene como rechazados, así
    // que `payDueCustomer` los rechazaría en cada pasada. Son de `recogerAprobadosTardios`.
    if (!candidatas.length) return { revisadas: 0, aplicadas: 0, fallidas: 0, detalle: [] as string[] };

    // Las que YA tienen su plata contabilizada no son pagos caídos: son pagos que el
    // puente todavía no ha sellado.
    const referencias = candidatas.map((c) => c.reference);
    const conPlata = new Set(
      (await this.prisma.transaction.findMany({
        where: { payuOrderId: { in: referencias }, status: 'VIGENTE' },
        select: { payuOrderId: true },
      })).map((t) => t.payuOrderId!),
    );
    // Y se pregunta TAMBIÉN al legacy, no sólo aquí. La ida tarda hasta 15 minutos en
    // traer un movimiento de allá, así que mirar sólo esta base deja un hueco en el que
    // un pago ya aplicado en el legacy parece caído. Pasó de verdad el día del cambio
    // (ref 4c59424e…, 10-09): el legacy lo había aplicado justo antes del corte y el
    // rescate lo volvió a aplicar aquí; no acabó en doble cobro sólo porque el writeback
    // ADOPTA el gemelo en vez de insertar. No conviene depender de esa red.
    for (const r of await this.referenciasYaPagadasEnLegacy(referencias)) conPlata.add(r);

    const detalle: string[] = [];
    let aplicadas = 0, fallidas = 0, revisadas = 0;
    for (const c of candidatas) {
      if (conPlata.has(c.reference) || !c.subscriber?.legacyId) continue;
      revisadas++;
      if (opts.dryRun) {
        detalle.push(`(seco) abonado ${c.subscriber.abonado} · $${c.amount} · ${c.reference}`);
        continue;
      }
      try {
        await this.payDueCustomer(c.subscriber.legacyId, Number(c.amount), c.reference);
        aplicadas++;
        detalle.push(`abonado ${c.subscriber.abonado} · $${c.amount} · ${c.reference}`);
        this.logger.warn(
          `[portal-pagos] RESCATADO un pago que se había caído: abonado ${c.subscriber.abonado}`
          + ` · $${c.amount} · ref ${c.reference}`,
        );
      } catch (e: any) {
        fallidas++;
        detalle.push(`⚠️ ${c.reference}: ${e?.message ?? e}`);
        this.logger.error(`[portal-pagos] no se pudo rescatar ${c.reference}: ${e?.message ?? e}`);
      }
    }
    return { revisadas, aplicadas, fallidas, detalle };
  }

  /**
   * Recoge los pagos que Wompi aprobó en un REINTENTO y el portal dejó por rechazados.
   * El porqué está en `aprobados-tardios.ts`.
   *
   * La pista sale de los avisos crudos que el portal guarda (`data_reception`), pero la
   * decisión NO: cada candidato se le pregunta a la API de Wompi con la llave privada,
   * y sólo se aplica si Wompi dice APROBADA, de esa referencia y por el valor de la
   * orden. El endpoint del portal es público y no valida firmas, así que un aviso ahí
   * no prueba nada.
   *
   * Si el abonado tiene otro ingreso desde el día del pago, no se aplica: se deja la
   * orden APROBADA y sin sellar, que es exactamente lo que la pantalla de pagos en línea
   * pinta como «aprobado sin aplicar», con el motivo en el detalle. Una persona decide.
   *
   * Lo que se mira ya no vuelve a mirarse (la marca queda en `rawWebhook.aprobadoTardio`),
   * salvo cuando Wompi no contestó: ése se reintenta en la pasada siguiente.
   */
  async recogerAprobadosTardios(opts: { dias?: number; dryRun?: boolean } = {}) {
    const dias = opts.dias ?? Number(process.env.PORTAL_WS_RESCATE_DIAS || 3);
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    const vacio = { revisadas: 0, aplicadas: 0, porRevisar: 0, fallidas: 0, detalle: [] as string[] };

    // ── 1. Avisos aprobados de órdenes que el portal no dio por aprobadas ────────
    const cn = await mysql.createConnection(this.conexion(process.env.PORTAL_DB_NAME || 'crm_vestel'));
    let ordenes: OrdenPortal[] = [];
    const avisos = new Map<string, AvisoWompi>();
    try {
      const [filas] = await cn.query<any[]>(
        // `fecha` es hora de Colombia (el PHP fija America/Bogota antes de escribirla).
        "SELECT data FROM data_reception WHERE fecha >= ? AND data LIKE '%\"APPROVED\"%'",
        [fechaBogota(desde)],
      );
      for (const f of filas as any[]) {
        const a = avisoAprobado(String(f.data ?? ''));
        if (a) avisos.set(a.reference, a);
      }
      if (!avisos.size) return vacio;
      const [os] = await cn.query<any[]>(
        'SELECT id, reference, debe, estado, cid_user, metodo_pago, id_wompi '
        + 'FROM wompi_data_orden WHERE reference IN (?) AND estado <> ?',
        [[...avisos.keys()], APROBADA],
      );
      ordenes = os as OrdenPortal[];
    } finally {
      await cn.end();
    }
    if (!ordenes.length) return vacio;

    // ── 2. Fuera lo ya resuelto: sellado, con plata en algún lado o ya mirado ────
    const referencias = ordenes.map((o) => o.reference);
    const aqui = new Map(
      (await this.prisma.paymentOrder.findMany({
        where: { reference: { in: referencias } },
        select: { reference: true, appliedAt: true, rawWebhook: true },
      })).map((p) => [p.reference, p]),
    );
    const conPlata = new Set(
      (await this.prisma.transaction.findMany({
        where: { payuOrderId: { in: referencias }, status: 'VIGENTE' },
        select: { payuOrderId: true },
      })).map((t) => t.payuOrderId!),
    );
    for (const r of await this.referenciasYaPagadasEnLegacy(referencias)) conPlata.add(r);

    const r = { ...vacio, detalle: [] as string[] };
    for (const orden of ordenes) {
      const p = aqui.get(orden.reference);
      const ya = marcaTardio(p?.rawWebhook);
      if (p?.appliedAt || (ya && !ya.reintentar) || conPlata.has(orden.reference)) continue;
      const aviso = avisos.get(orden.reference)!;

      let sub: Awaited<ReturnType<PortalPagosService['abonadoDe']>>;
      try {
        sub = await this.abonadoDe(Number(orden.cid_user));
      } catch {
        continue; // ficha depurada del legacy: tampoco la ingesta la trae
      }
      r.revisadas++;
      const etiqueta = `abonado ${sub.abonado} · $${orden.debe} · ${orden.reference}`;

      // ── 3. Lo que diga Wompi ───────────────────────────────────────────────
      let tx: TransaccionWompi | null;
      try {
        tx = await this.transaccionWompi(aviso.transactionId);
      } catch (e: any) {
        r.fallidas++;
        r.detalle.push(`⚠️ ${etiqueta}: Wompi no contestó (${e?.message ?? e})`);
        continue; // sin marca: se reintenta en la pasada siguiente
      }
      const dia = diaBogota(tx?.finalized_at || tx?.created_at || new Date());
      const posteriores = await this.prisma.transaction.findMany({
        where: {
          subscriberId: sub.id, type: 'INCOME', status: 'VIGENTE',
          date: { gte: new Date(`${dia}T00:00:00Z`) },
        },
        select: { id: true, credit: true },
        orderBy: { date: 'asc' },
      });
      const motivo = motivoParaNoAplicar({
        reference: orden.reference, debe: Number(orden.debe), tx, pagosPosteriores: posteriores.length,
      });
      // El cargue a mano por el mismo valor, al peso: así se resolvieron casi todos antes
      // de esto. Se enlaza a ese movimiento para que la pantalla no lo pinte en rojo.
      // Sin tomar el que ya es de OTRA orden: 55714 volvió a pagar en línea el 27-09 por
      // el mismo valor y ese movimiento, el primero por fecha, no es el cargue a mano.
      const deOtraOrden = new Set((await this.prisma.paymentOrder.findMany({
        where: { transactionId: { in: posteriores.map((t) => t.id) } },
        select: { transactionId: true },
      })).map((o) => o.transactionId));
      const aMano = motivo && tx?.status === 'APPROVED' && tx.reference === orden.reference
        ? posteriores.find((t) => !deOtraOrden.has(t.id) && round2(num(t.credit)) === round2(Number(orden.debe)))
        : undefined;
      const marca = { transaccion: aviso.transactionId, dia, vistoEl: new Date().toISOString() };

      if (opts.dryRun) {
        r.detalle.push(`(seco) ${etiqueta}: ${aMano ? 'ya cargado a mano por el mismo valor' : motivo ?? 'se aplicaría'}`);
        continue;
      }

      // Wompi no la tiene por aprobada: el aviso no era bueno. Se anota y no se toca nada.
      if (!tx || tx.status !== 'APPROVED' || tx.reference !== orden.reference) {
        this.logger.warn(`[portal-pagos] aviso APPROVED que Wompi no confirma: ${etiqueta} · ${motivo}`);
        await this.anotarTardio(orden, sub.id, { ...marca, descartado: motivo }, null);
        r.detalle.push(`descartado ${etiqueta}: ${motivo}`);
        continue;
      }

      // Aprobado de verdad. A partir de aquí la orden es APROBADA pase lo que pase.
      const conDatosDeWompi: OrdenPortal = {
        ...orden,
        metodo_pago: tx.payment_method_type || orden.metodo_pago,
        id_wompi: aviso.transactionId.replace(/[\s-]/g, ''), // como lo guarda el portal
      };
      if (aMano) {
        await this.anotarTardio(conDatosDeWompi, sub.id, { ...marca, cargadoAMano: aMano.id }, 'APPROVED');
        await this.prisma.paymentOrder.updateMany({
          where: { reference: orden.reference, appliedAt: null },
          data: { appliedAt: new Date(), appliedBy: 'MANUAL', transactionId: aMano.id },
        });
        r.detalle.push(`ya cargado a mano ${etiqueta}`);
        continue;
      }
      if (motivo) {
        await this.anotarTardio(conDatosDeWompi, sub.id, { ...marca, revisar: motivo }, 'APPROVED');
        r.porRevisar++;
        r.detalle.push(`por revisar ${etiqueta}: ${motivo}`);
        this.logger.warn(`[portal-pagos] aprobado en un reintento, POR REVISAR: ${etiqueta} · ${motivo}`);
        continue;
      }
      try {
        await this.anotarTardio(conDatosDeWompi, sub.id, marca, 'APPROVED');
        await this.sellarYAplicar(sub, Number(orden.cid_user), round2(Number(orden.debe)), orden.reference, conDatosDeWompi);
        r.aplicadas++;
        r.detalle.push(etiqueta);
        this.logger.warn(`[portal-pagos] RESCATADO un pago aprobado en un reintento: ${etiqueta}`);
      } catch (e: any) {
        r.fallidas++;
        r.detalle.push(`⚠️ ${etiqueta}: ${e?.message ?? e}`);
        this.logger.error(`[portal-pagos] no se pudo aplicar el aprobado tardío ${orden.reference}: ${e?.message ?? e}`);
        // La marca se queda (el rescate de `recogerPagosCaidos` no debe tocarla), pero
        // con `reintentar` para que la pasada siguiente lo vuelva a intentar.
        await this.anotarTardio(conDatosDeWompi, sub.id, { ...marca, reintentar: true, error: String(e?.message ?? e) }, null)
          .catch(() => undefined);
      }
    }
    return r;
  }

  /**
   * Deja en `PaymentOrder` lo que se averiguó de un aprobado tardío. La fila puede no
   * existir aún (la ingesta pasa después en el mismo cron). `status` null = no se toca.
   */
  private async anotarTardio(orden: OrdenPortal, subscriberId: string, marca: Record<string, unknown>, status: 'APPROVED' | null) {
    const rawWebhook = { aprobadoTardio: marca } as Prisma.InputJsonValue;
    const datos = {
      rawWebhook,
      ...(status ? { status, method: orden.metodo_pago || null, gatewayTxId: orden.id_wompi || null } : {}),
    };
    const hecho = await this.prisma.paymentOrder.updateMany({ where: { reference: orden.reference }, data: datos });
    if (hecho.count) return;
    await this.prisma.paymentOrder.create({
      data: {
        reference: orden.reference,
        subscriberId,
        gateway: 'wompi',
        amount: Number(orden.debe),
        currency: 'COP',
        status: status ?? 'DECLINED',
        method: orden.metodo_pago || null,
        gatewayTxId: orden.id_wompi || null,
        rawInit: { portalId: Number(orden.id), estadoPortal: orden.estado, cidUser: Number(orden.cid_user) },
        rawWebhook,
        updatedAt: new Date(),
      },
    }).catch(() => undefined); // la creó la ingesta entre medias: la pasada siguiente la ve
  }

  /** `GET /v1/transactions/:id` con la llave privada. `null` si Wompi no la conoce. */
  private async transaccionWompi(id: string): Promise<TransaccionWompi | null> {
    let llave: string | undefined;
    try {
      llave = JSON.parse((await this.llavesWompi()).valor)?.private_key;
    } catch { /* abajo */ }
    if (!llave) throw new Error('no hay llave privada de Wompi en variables_de_entorno');
    const base = (process.env.WOMPI_API_URL || 'https://production.wompi.co/v1').replace(/\/+$/, '');
    const res = await fetch(`${base}/transactions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${llave}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cuerpo: any = await res.json();
    return (cuerpo?.data ?? null) as TransaccionWompi | null;
  }

  // ------------------------------------------------------------------
  // Piezas comunes
  // ------------------------------------------------------------------

  /** El abonado, por el `customers.id` del legacy que es lo único que el portal conoce. */
  private async abonadoDe(cid: number) {
    const legacyId = Number(cid);
    if (!Number.isInteger(legacyId) || legacyId <= 0) {
      throw new BadRequestException('cid inválido.');
    }
    const sub = await this.prisma.subscriber.findFirst({
      where: { legacyId },
      select: {
        id: true, legacyId: true, abonado: true, status: true, docNumber: true, docType: true,
        firstName: true, secondName: true, lastName1: true, lastName2: true, companyName: true,
        fullName: true, email: true, phone1: true, phone2: true, customerType: true,
        birthDate: true, contractDate: true, entryDate: true, estrato: true, suscripcion: true,
        departmentRef: true, cityRef: true, localityRef: true, neighborhood: true,
        nomenclature: true, branch: { select: { name: true } },
      },
    });
    if (!sub) throw new NotFoundException('Cliente no encontrado.');
    return sub;
  }

  /** La ficha con los nombres de columna del legacy: el portal los lee tal cual. */
  private fichaLegacy(sub: Awaited<ReturnType<PortalPagosService['abonadoDe']>>) {
    const nom = (sub.nomenclature ?? {}) as Record<string, unknown>;
    return {
      id: String(sub.legacyId ?? ''),
      abonado: sub.abonado != null ? String(sub.abonado) : '',
      name: sub.firstName ?? '',
      dosnombre: sub.secondName ?? '',
      unoapellido: sub.lastName1 ?? '',
      dosapellido: sub.lastName2 ?? '',
      company: sub.companyName ?? '',
      celular: sub.phone1 ?? '',
      celular2: sub.phone2 ?? '',
      email: sub.email && sub.email !== 'NULL' ? sub.email : '',
      nacimiento: fecha(sub.birthDate),
      tipo_cliente: sub.customerType ?? '',
      tipo_documento: sub.docType ?? '',
      documento: sub.docNumber ?? '',
      f_contrato: fecha(sub.contractDate),
      f_ingreso: fecha(sub.entryDate),
      estrato: sub.estrato ?? '',
      suscripcion: sub.suscripcion ?? '',
      departamento: sub.departmentRef ?? '',
      ciudad: sub.cityRef ?? '',
      localidad: sub.localityRef ?? '',
      barrio: sub.neighborhood ?? '',
      nomenclatura: (nom.nomenclatura as string) ?? '',
      numero1: (nom.numero1 as string) ?? '',
      numero2: (nom.numero2 as string) ?? '',
      numero3: (nom.numero3 as string | number) ?? '',
      usu_estado: estadoLegacy(sub.status) ?? '',
      sede: sub.branch?.name ?? '',
    };
  }

  /** Usuario con el que firma el web service. No es una persona y no debe parecerlo. */
  private usuarioSistema(): AuthUser {
    return {
      id: 'system',
      email: 'portal@vestel',
      name: 'Portal de pagos en línea',
      roles: [],
      permissions: ['system.admin'],
    };
  }

  /** Conexión de SOLO LECTURA al MySQL del portal y del legacy (viven en el mismo servidor). */
  private conexion(database: string) {
    return {
      host: process.env.PORTAL_DB_HOST || process.env.LEGACY_DB_HOST || '127.0.0.1',
      port: Number(process.env.PORTAL_DB_PORT || process.env.LEGACY_DB_PORT || 3306),
      user: process.env.PORTAL_DB_USER || process.env.LEGACY_DB_USER,
      password: process.env.PORTAL_DB_PASSWORD || process.env.LEGACY_DB_PASSWORD,
      database,
      dateStrings: true as const,
    };
  }

  /** La orden tal como la dejó el webhook firmado de Wompi. */
  private async ordenDelPortal(reference: string): Promise<OrdenPortal | null> {
    const cn = await mysql.createConnection(this.conexion(process.env.PORTAL_DB_NAME || 'crm_vestel'));
    try {
      const [filas] = await cn.query<any[]>(
        'SELECT id, reference, debe, estado, cid_user, metodo_pago, id_wompi '
        + 'FROM wompi_data_orden WHERE reference = ? LIMIT 1',
        [reference],
      );
      return (filas as OrdenPortal[])[0] ?? null;
    } finally {
      await cn.end();
    }
  }

  /** Referencias que el LEGACY ya tiene cobradas (`transactions.id_orden_payu`). */
  private async referenciasYaPagadasEnLegacy(referencias: string[]): Promise<string[]> {
    if (!referencias.length) return [];
    const cn = await mysql.createConnection(this.conexion(process.env.LEGACY_DB_NAME || 'admin_vestel'));
    try {
      const [filas] = await cn.query<any[]>(
        'SELECT DISTINCT id_orden_payu FROM transactions WHERE id_orden_payu IN (?)',
        [referencias],
      );
      return (filas as any[]).map((f) => String(f.id_orden_payu)).filter(Boolean);
    } catch (e: any) {
      // Si no se puede preguntar, NO se rescata nada: el riesgo de aplicar dos veces es
      // peor que el de tardar una pasada más.
      this.logger.error(`[portal-pagos] no pude consultar el legacy para el rescate: ${e?.message ?? e}`);
      return referencias;
    } finally {
      await cn.end();
    }
  }

  /**
   * Las llaves de Wompi, de la misma fila del legacy que las servía hasta hoy
   * (`variables_de_entorno` con `nombre_api='WOMPI'`). Se cachean un rato: el portal
   * pide esto en cada carga de la página de facturas.
   */
  private cacheWompi: { hasta: number; valor: { valor: string } } | null = null;

  private async llavesWompi(): Promise<{ valor: string }> {
    if (this.cacheWompi && this.cacheWompi.hasta > Date.now()) return this.cacheWompi.valor;
    const cn = await mysql.createConnection(this.conexion(process.env.LEGACY_DB_NAME || 'admin_vestel'));
    try {
      const [filas] = await cn.query<any[]>(
        "SELECT valor FROM variables_de_entorno WHERE nombre_api = 'WOMPI' LIMIT 1",
      );
      const valor = { valor: String(filas[0]?.valor ?? '{}') };
      this.cacheWompi = { hasta: Date.now() + 5 * 60 * 1000, valor };
      return valor;
    } finally {
      await cn.end();
    }
  }
}

// ---------------------------------------------------------------------------
// Utilidades de forma (lo que el PHP espera ver)
// ---------------------------------------------------------------------------

/** A dónde apunta el botón "Ver" de la tabla de facturas. */
const BASE_PORTAL = (process.env.PORTAL_CRM_BASE || 'https://vestel.com.co/crm').replace(/\/+$/, '');

const ESTADO_FACTURA: Record<string, string> = {
  DUE: 'due', PAID: 'paid', PARTIAL: 'partial', CANCELED: 'canceled',
};

/**
 * Las etiquetas SON las del fichero de idioma del portal
 * (`application/language/spanish/spanish_lang.php`), no las que nos parecerían mejores:
 * el legacy imprimía `$this->lang->line(ucwords($status))` y el cliente lleva años
 * viendo "Cancelado" en una factura pagada. Cambiarlas ahora sería un cambio de
 * producto colado dentro de un cambio de fontanería.
 */
const ETIQUETA_ESTADO: Record<string, string> = {
  DUE: 'Pendiente', PAID: 'Cancelado', PARTIAL: 'Abonado', CANCELED: 'Anulado',
};

/**
 * El estado del abonado con la grafía del legacy (`customers.usu_estado`): "Activo",
 * "Cortado", "Por retirar"… Es lo que viajaba en `due.ron` / `due.estado`, y aunque hoy
 * la vista del portal no lo pinte, devolver el enum en mayúsculas sería sembrar una
 * sorpresa para el primero que lo use.
 */
const ESTADO_ABONADO: Record<string, string> = {
  ACTIVO: 'Activo', CORTADO: 'Cortado', SUSPENDIDO: 'Suspendido', RETIRADO: 'Retirado',
  DEPURADO: 'Depurado', CARTERA: 'Cartera', INACTIVO: 'Inactivo', COMPROMISO: 'Compromiso',
  EXONERADO: 'Exonerado', REPORTADO: 'Reportado', INSTALAR: 'Instalar', ANULADO: 'Anulado',
  POR_RETIRAR: 'Por retirar', EVENTO: 'Evento', DADO_DE_BAJA: 'Dado de Baja',
};

/** El estado tal como lo escribe el legacy; si es uno que no conocemos, se pasa tal cual. */
function estadoLegacy(s: string | null | undefined): string | null {
  if (!s) return null;
  return ESTADO_ABONADO[s] ?? s;
}

/** 'YYYY-MM-DD' o cadena vacía: el portal imprime esto tal cual. */
function fecha(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString().slice(0, 10) : '';
}

/** Los enteros del legacy viajan como número, no como Decimal. */
function entero(d: unknown): number {
  return Math.trunc(num(d as never));
}

/**
 * El formato de `amountFormat()` del legacy, que es lo que la tabla enseñaba:
 * `$ ` + miles con punto y sin decimales (`app_system.currency` = '$',
 * `univarsal_api` id 4 → 0 decimales, separador de miles '.').
 */
function montoLegacy(n: number): string {
  return `$ ${Math.round(n).toLocaleString('es-CO', { useGrouping: true }).replace(/,/g, '.')}`;
}

function nombreDe(s: { firstName?: string | null; secondName?: string | null; lastName1?: string | null; lastName2?: string | null; companyName?: string | null; fullName?: string | null } | null): string {
  if (!s) return '';
  if (s.fullName?.trim()) return s.fullName.trim();
  const person = [s.firstName, s.secondName, s.lastName1, s.lastName2]
    .map((p) => (p || '').trim()).filter(Boolean).join(' ');
  return person || (s.companyName || '').trim() || '';
}

function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** Comparación en tiempo constante: el secreto no se adivina a golpe de cronómetro. */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/** `::ffff:1.2.3.4` (IPv4 mapeada) y `::1` son la misma dirección de siempre. */
function normalizarIp(ip: string | null): string {
  const s = (ip ?? '').trim();
  if (s.startsWith('::ffff:')) return s.slice(7);
  if (s === '::1') return '127.0.0.1';
  return s;
}

/** 'YYYY-MM-DD HH:mm:ss' en hora de Colombia, que es como escribe fechas el portal. */
function fechaBogota(d: Date): string {
  return new Date(d.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/** md5 de una frase, que es como el portal firma. Se usa desde el script de rotación. */
export function md5(s: string): string {
  return createHash('md5').update(s, 'utf8').digest('hex');
}
