# Libros internos por sede — plan de trabajo

Pedido del 2026-09-24. Continúa y corrige `docs/centros-de-costo/` (obra del 23-sep). Se ejecuta por
fases con `claude -p` dentro de la sesión tmux `saves-libros-sede`, lanzada por
`docs/libros-por-sede/correr.sh`. Cada fase arranca con contexto limpio, lee este plan y la
`BITACORA.md`, trabaja y **deja constancia en la bitácora**. El lanzador sólo pasa a la siguiente fase
si la bitácora tiene la línea `FASE <n>: OK`.

Punto de retorno del código: etiqueta git `punto-2026-09-24` (commit `a0140ab`, en el remoto `vestel`).

## Objetivo (palabras del usuario, 24-sep)

«La idea es que cada sede maneje su propia contabilidad, sus propios números y no todo centrado»,
**sólo como gestión interna**: la factura electrónica, la DIAN y Siigo siguen exactamente igual (una
sola empresa, NIT 844004979). Lo que el usuario eligió para cada sede:

- **Balance propio**: su caja, sus bancos, lo que le deben sus clientes y lo que ella debe (incluida
  su deuda con la central). No sólo ingresos y gastos.
- **Cierre de mes propio**: cada sede cierra su mes; una atrasada no frena a las demás.
- **Consecutivos propios** de comprobantes contables (`YOP-000123`). NO de facturas: la numeración de
  facturas y recibos no se toca (ver [[consecutivos-tid-particionados]], el tid es compartido con el legacy).
- **Contador que ve sólo su sede**: entra y sólo ve y registra lo de ella.
- **Gastos compartidos como cuenta interna**: la Oficina central le «cobra» a cada sede su parte, que
  queda como deuda de la sede con la central.

## Diseño

- **Libro = centro de costo.** Se reutilizan los 9 `CostCenter` de anoche: los 7 `CC-<SEDE>` son los
  libros de las sedes y `CC-ADMIN` pasa a llamarse **«Oficina central»** y es el libro de la central.
  La raíz `VESTEL` es el **consolidado** (suma de todos los libros), no recibe asientos.
- **Cada asiento pertenece a UN libro y cuadra dentro de él.** Columna nueva `JournalEntry.bookId`
  (→ `CostCenter`). Las líneas conservan `costCenterId` = el libro (queda libre para sub-análisis más
  adelante, pero hoy siempre igual al libro).
- **Consecutivo por libro**: `JournalEntry.bookNumber` con `@@unique([bookId, bookNumber])`, secuencia
  `Sequence` con clave `libro.<code>`. El `number` global se conserva tal cual (compatibilidad).
  Se muestra como `<PREFIJO>-<bookNumber 6 dígitos>` (prefijo configurable por centro: `YOP`, `VIL`,
  `MON`, `MOC`, `AGU`, `TAU`, `VIC`, `OFC`).
- **Cuenta interna (cuentas recíprocas).** Cuando un hecho toca dos libros, se asienta en los dos:
  - Cuentas nuevas marcadas `Account.isInternal = true` (los códigos son provisionales, contabilidad
    puede cambiarlos sin tocar código porque van por `AccountMapping`):
    - `INTERNAL_ACCOUNT` → **1315 «Cuenta interna entre sedes»** (una sola cuenta; en cada libro su saldo
      es lo que ese libro tiene por cobrar (+) o por pagar (−) al otro). Para saber con quién es cada
      saldo, la línea lleva `JournalLine.counterpartBookId` (columna nueva, nullable).
    - `INTERNAL_CHARGE_EXPENSE` → **519597 «Gastos de oficina central asignados»** (en el libro de la sede).
    - `INTERNAL_CHARGE_INCOME` → **429597 «Recobro de gastos a sedes»** (en el libro de la central).
  - Ejemplo — cliente de Yopal paga por Bancolombia (banco de la central), $50.000:
    - Libro Yopal: Dr 1315 (contraparte Oficina central) 50.000 / Cr 130505 Clientes 50.000.
    - Libro Oficina central: Dr 111005 Bancos 50.000 / Cr 1315 (contraparte Yopal) 50.000.
    - Los dos asientos quedan ligados (mismo `sourceType/sourceId` con sufijo, ver fase 3).
  - Ejemplo — egreso pagado desde el banco con centro elegido Yopal: libro Yopal Dr gasto / Cr 1315
    (contraparte central); libro central Dr 1315 (contraparte Yopal) / Cr Bancos.
  - Entre dos sedes no hay cuenta directa: todo pasa por la central (no se ha visto ningún caso hoy).
- **¿De qué libro es cada cosa?** (un solo resolver, `backend/src/common/libro-contable.ts`, que se
  apoya en `centro-costo.ts`; nada de reglas repartidas por los servicios):
  - Factura, ajuste de factura, cartera del cliente (130505): libro de la sede del abonado.
  - Caja física (`CashAccount.branchLegacy` ≠ 0): libro de esa sede. Banco / Wompi / Efecty / caja
    virtual (`branchLegacy` = 0): libro de la **Oficina central**.
  - Recaudo: la cartera va al libro del abonado y la plata al libro de la caja/banco que la recibió; si
    son distintos → par de asientos con cuenta interna.
  - Egreso / ingreso de tesorería: el gasto va al centro elegido (o a la sede de la caja, o a la central
    si es banco) y la plata sale del libro de la caja/banco; si son distintos → par con cuenta interna.
  - Asiento manual: el usuario elige el libro (obligatorio); un contador de sede sólo puede elegir el suyo.
- **Gastos compartidos (cuenta interna mensual).** Acción «Asignar gastos de la central» por mes
  (con vista previa): toma el gasto neto del libro de la Oficina central en el mes (sin cuentas
  internas) y lo reparte entre las sedes según el **criterio configurable** (por defecto: abonados
  ACTIVO + COMPROMISO de cada sede el último día del mes; alternativa: porcentaje fijo por sede). Por
  sede: Dr 519597 / Cr 1315 (contraparte central); en la central: Dr 1315 (contraparte sede) / Cr
  429597. Idempotente por (mes): repetirla reemplaza la anterior (reverso + nuevo), nunca duplica.
- **Consolidado = la empresa.** Suma de todos los libros **eliminando las cuentas internas**
  (`isInternal`). Por construcción el consolidado debe dar EXACTAMENTE lo mismo que la contabilidad de
  hoy: ese es el invariante que verifica cada fase.
- **Cierre por libro.** `FiscalPeriod` pasa a ser por (libro, año, mes). El cierre de un libro barre sus
  cuentas de resultado a 360505 dentro de ese libro. El consolidado de un mes «está cerrado» cuando lo
  están todos los libros. `assertOpenForDate(date, bookId)` mira el periodo de ese libro.

## Lo que hay hoy (investigado el 2026-09-24)

- 59 cuentas (28 imputables), 1 `BankAccount`, **1 `FiscalPeriod`, ninguno cerrado**, 14.386 asientos
  numerados 1…14.386 con secuencia global `TID_SEQ.journalEntry` (`nextTid`).
- Casi todo asiento es automático (`PostingService`, `accounting/posting.service.ts`): `SALES_INVOICE`,
  `SALES_INVOICE_ADJ`, `CUSTOMER_PAYMENT`, `TREASURY_EXPENSE`, `TREASURY_INCOME`; idempotentes por
  `@@unique([sourceType, sourceId])`. Llamadores en `billing/facturas.service.ts`, `omni/omni.service.ts`,
  `treasury/cobranzas.service.ts:314,825,1012` (ver `docs/centros-de-costo/PLAN.md` para las líneas).
- `postCustomerPayment` / `postTreasury*` usan `CASH_DEFAULT` (110505) o `BANK_DEFAULT` (111005) según
  `toBank/fromBank`: hoy **no distinguen qué caja/banco**, sólo caja vs banco.
- Cifras por centro (anoche): CUSTOMER_PAYMENT ya etiquetados con la sede del cliente aunque la plata
  entrara al banco (111005 con CC-VILLANUEVA 110 líneas, CC-YOPAL 73, …) → son los que se parten en par.
  111005 con CC-ADMIN −119,5 M (egresos de la central desde el banco).
- «Sin asignar»: 2.856 asientos `SALES_INVOICE` de **facturas borradas** (2.177 de la corrida de prueba
  «PRUEBA · Superusuario» de agosto) + ~24 sueltos (recibos/transacciones borrados).
- Cajas raras: 21 «Villavicencio» `branchLegacy` 0 (se trata como banco), 4 «Mocoa» null.
- Cierre: `accounting/periods.service.ts` (`close`, `reopen`, `calcularCierre`, `assertOpenForDate`),
  llamado desde `journal.service.ts:116,175`. Informes en `accounting/reports.service.ts`
  (`trialBalance`, `incomeStatement`, `incomeStatementByCenter`, `balanceSheet`, `ledger`, `cashFlow`,
  `monthlySummary`).
- Alcance por sede de usuarios: `common/sede-scope.ts` (`sedesDe`, `resolverSedes`). Permisos
  `accounting.view` / `accounting.manage`.
- Pantallas: `frontend/src/app/contabilidad/{libros,cierres,informes,plan-de-cuentas,mapeo-cuentas,
  resultados-por-sede,centros-de-costo}`.

## Decisiones (estado)

- **L1. Criterio del reparto de gastos compartidos**: provisional «abonados ACTIVO+COMPROMISO a fin de
  mes». Configurable (tabla o `Setting`), no en el código. PENDIENTE DE CONFIRMAR.
- **L2. Asientos de facturas borradas** (2.856 + sueltos sin dueño): ver el valor de `L2_APROBADO` al
  final de este documento. Si es `no`, NO se tocan: van a un libro técnico «Sin asignar» (centro
  `SIN-ASIGNAR`, kind OTRO) que aparece en el consolidado y se señala en rojo en los informes.
  Si es `sí`, se **reversan** (asiento de reverso con `reversedById`, fechado igual que el original,
  nada se borra) y se anota en `AuditLog`.
- **L3. Cajas 21 «Villavicencio» y 4 «Mocoa»: SUSPENDER** (usuario, 24-sep: «allá ya no hay nada»).
  Último movimiento: caja 4 el 2022-09-06 (20 movimientos), caja 21 el 2023-12-05 (10). Saldos
  `lastbal` que quedaron: 4 → $539.000, 21 → $547.650 (vienen del legacy; NO se ajustan, sólo se
  informan en RESULTADO.md para que el usuario decida). Ver fase 1 y fase 3.
- **L4. Códigos de las cuentas internas** (1315 / 519597 / 429597): provisionales, cambiables por mapeo.

## Fases

### Fase 0 — Preparación y respaldo
- `pg_dump -Fc` a `backend/backups/nexus_<fecha>_libros.dump` + sha256 en la bitácora.
- Foto de control (a ficheros de esta carpeta): balance de prueba consolidado por cuenta (débito,
  crédito, saldo) de TODO el histórico, de septiembre y de agosto; conteo de asientos por
  `sourceType`; md5 de (sourceType, sourceId, cuenta, débito, crédito) ordenado. Es el invariante.
- Copia de los ficheros de código que se van a tocar en `respaldo-inicial/`.
- Confirmar que el backend y el frontend están arriba (pm2) y que los tests pasan (anotar los que ya
  fallaban: `cortes-deshechos` falta en el contrato, es ajeno).

### Fase 1 — Datos: libros, consecutivos, cuenta interna
- Migración a mano (carpeta `prisma/migrations/2026092xxxxxxx_libros_por_sede/`, aplicada con
  `prisma:deploy`, ver [[migraciones-y-backup-saves]]; `migrate dev` no sirve por las tablas `Pqr*`):
  - `JournalEntry.bookId String?` (FK CostCenter) + índice, `JournalEntry.bookNumber Int?`,
    `@@unique([bookId, bookNumber])`.
  - `JournalLine.counterpartBookId String?` (FK CostCenter).
  - `CostCenter.prefix String? @unique` (prefijo del consecutivo) y `CostCenter.isBook Boolean @default(false)`.
  - `Account.isInternal Boolean @default(false)`.
  - `CashAccount.isActive Boolean @default(true)`; la siembra pone `false` en las cajas legacyId 4 y 21.
  - `FiscalPeriod.bookId String?` (FK CostCenter); el `@@unique([year, month])` pasa a
    `@@unique([bookId, year, month])` — **es el único cambio no aditivo permitido**; el periodo existente
    queda con `bookId` null = consolidado (se ajusta en la fase 5).
- Siembra idempotente `backend/scripts/sembrar-libros.ts`: renombra `CC-ADMIN` a «Oficina central»
  (el código `CC-ADMIN` no cambia), marca `isBook` y prefijo en los 8 libros, crea el centro
  `SIN-ASIGNAR` (isBook, prefijo `SNA`) sólo si L2 = no, crea las 3 cuentas internas con sus mapeos.
- Actualizar `schema.prisma`, `prisma generate`, typecheck.

### Fase 2 — Resolver del libro y partidor de asientos
- `backend/src/common/libro-contable.ts` (+ spec): `libroDeAbonado`, `libroDeCaja` (por legacyId de
  `CashAccount`), `libroCentral`, `libroDeCentro`, y **`partirPorLibro(lineas)`**: recibe las líneas de
  un hecho, cada una con su libro, y devuelve un asiento por libro, cada uno cuadrado, añadiendo las
  líneas de cuenta interna con `counterpartBookId` (contra la central). Función pura y probada:
  1 libro → 1 asiento sin líneas internas; 2 libros → 2 asientos espejo; redondeo a 2 decimales;
  la suma de todo, quitando internas, es igual a la entrada.
- Nada de esto se llama todavía desde el flujo real.

### Fase 3 — Contabilizar ya por libro
- `JournalService.post` exige `bookId` (si falta, usa el del resolver o la central, con `warn`), toma el
  `bookNumber` de la secuencia `libro.<code>` en la misma transacción y valida que cuadre.
- `PostingService`: cada método arma las líneas con su libro y pasa por `partirPorLibro`. Para el par
  de asientos, idempotencia: el del libro principal conserva `sourceType/sourceId`; el espejo usa
  `sourceType` + `':INT'` (p. ej. `CUSTOMER_PAYMENT:INT`). Reverso de un hecho reversa los dos.
  - `postCustomerPayment` y `postTreasury*` reciben la caja (`cashAccountLegacyId`) para saber el libro
    de la plata; ajustar sus llamadores en `cobranzas.service.ts` (ya pasan la caja para el centro).
- `JournalEntryModal` / API de asiento manual: libro obligatorio.
- **Cajas suspendidas (L3):** los selectores y listas para OPERAR (elegir caja en recaudo, egreso,
  ingreso, apertura/cierre, cargue de pagos, pagos fijos, config de cajeras: `treasury/caja-scope.ts`,
  `treasury/cobranzas.service.ts`, `treasury/treasury.service.ts`, `payment-imports`, `pagos-fijos`,
  `config`) filtran `isActive: true`; los INFORMES e históricos siguen mostrándolas con su nombre.
  El backend rechaza (400 claro) un movimiento nuevo contra una caja suspendida. El sync con el
  legacy NO se toca: si el legacy trae un movimiento de esas cajas, entra igual (anotarlo si pasa).
  Las cajas suspendidas no tienen libro propio: sus movimientos históricos, si los hay en el libro
  contable, van a la Oficina central.- Tests de cada camino (factura, ajuste, pago en caja de la sede, pago por banco, egreso de caja,
  egreso de banco con centro de sede, ingreso libre, asiento manual, reverso).

### Fase 4 — Pasar lo existente a libros (backfill)
- Script `backend/scripts/backfill-libros.ts`, ensayo por defecto y `--aplicar`, idempotente:
  1. `bookId` = centro de sus líneas (si todas las líneas tienen el mismo).
  2. Asientos cuyas líneas son de libros distintos o cuya plata está en un banco (111005, o caja con
     `branchLegacy` 0) y la cartera/gasto en una sede → se reescriben como el par de la fase 3 (se
     conservan id, `number` y fecha del principal; el espejo es nuevo).
  3. Sin centro → según L2 (reverso o libro `SIN-ASIGNAR`).
  4. `bookNumber` por libro en orden (fecha, number); secuencias `libro.<code>` al máximo.
- **Invariantes obligatorios** (si alguno falla: BLOQUEO y no aplicar / revertir con el dump):
  - cada asiento cuadra; cada libro cuadra;
  - consolidado sin cuentas internas = foto de la fase 0, cuenta por cuenta, en histórico, agosto y
    septiembre (con L2 = sí, la diferencia debe ser exactamente la de los reversos, anotada);
  - la cuenta interna suma 0 en el consolidado y, para cada sede, su saldo con la central es igual y
    opuesto al saldo de la central con ella.

### Fase 5 — Cierre por libro y asignación de gastos compartidos
- `PeriodsService` por libro: crear/listar/cerrar/reabrir por (libro, mes); `calcularCierre` filtra por
  libro; `assertOpenForDate(date, bookId)`. El consolidado muestra el estado de cada libro del mes.
  Migrar el `FiscalPeriod` existente: un periodo por libro para ese mes (ninguno cerrado).
- Asignación mensual de gastos de la central (servicio + endpoint con vista previa y aplicación),
  criterio configurable (L1), idempotente por mes. No correrla sobre meses pasados salvo septiembre en
  **vista previa** (anotar cifras en la bitácora; no aplicar hasta que el usuario lo vea).
- Tests: cierre de un libro no toca los demás; no se puede cerrar el reparto de un mes después de
  cerrado el libro de la central; reparto suma exactamente el gasto a repartir.

### Fase 6 — Informes, pantallas y acceso por sede
- Selector de **libro** (sede / Oficina central / Consolidado) en balance de prueba, estado de
  resultados, balance general, libro mayor, flujo de caja, libro diario y cierres. Consolidado =
  eliminando cuentas internas (con opción «ver cuentas internas»).
- Pantalla nueva «Cuenta interna»: saldo de cada sede con la central, movimientos, y la asignación
  mensual (vista previa + aplicar).
- `resultados-por-sede` queda como vista comparativa (columnas por libro) sobre el mismo modelo.
- Consecutivo `YOP-000123` visible en el diario y en el detalle del asiento.
- **Contador por sede**: si el usuario tiene sedes acotadas (`sedesDe` ≠ null), la API de contabilidad
  sólo le devuelve y le deja escribir en esos libros, y no ve el consolidado ni la central; sin
  acotar (gerencia, contabilidad general, superusuario) ve todo. Filtrar en el servidor, no sólo en la
  pantalla. Cerrar de paso `/contabilidad` a la cajera en `middleware.ts` (pendiente 5 de anoche).
- Contrato HTTP: añadir las rutas a `contrato-http.json` y regenerar SOLO el router de accounting en
  copia temporal, como hizo la fase 5 de anoche (el generador toca otros routers).

### Fase 7 — Build, despliegue y verificación
- Build backend y frontend **entre las 21:00 y las 05:00 hora Bogotá** (si no, BLOQUEO y esperar), sin
  otro build corriendo; nunca `pm2 stop` antes de que el build haya terminado bien
  ([[build-restart-pm2]]). Reiniciar `saves-backend` y `saves-frontend`.
- Verificación por HTTP con perfiles: superusuario, contabilidad, gerencia, un contador acotado a una
  sede (crear usuario de prueba temporal y borrarlo al final), cajera (403). Un pago de prueba NO se
  hace en producción: la verificación de escritura es con los tests y con asientos manuales en un
  periodo de prueba que se reversan y se anotan.
- Invariantes de la fase 4 otra vez por HTTP. Recorrer las páginas de contabilidad sin error 500.
  Revisar logs de pm2.

### Fase 8 — Cierre
- `docs/libros-por-sede/RESULTADO.md`: qué se hizo, cifras por libro (balance y resultados de
  septiembre), saldos de cuenta interna, decisiones pendientes, cómo revertir.
- Actualizar la memoria `centro-costo-por-sede.md` (ahora libros) y su línea en `MEMORY.md`.

## Reglas para todas las fases

- **No hacer commit, checkout, restore, stash ni reset.** El usuario decide cuándo subir a GitHub.
- **Nada de `prisma db push` ni de `generar:contenedor`.** Migraciones a mano; la única no aditiva es
  el unique de `FiscalPeriod` (fase 1).
- **No tocar**: el sync y el writeback con el legacy, la factura electrónica, Siigo
  (`SiigoAccount.costCenterByBranch`), la numeración de facturas/recibos (tid), los cron, WhatsApp.
- **Escrituras permitidas en la base**: la migración, la siembra de libros y cuentas internas (y `isActive=false` en las cajas 4 y 21), el
  backfill de libros (fase 4, incluidos los asientos espejo), los reversos sólo si L2 = sí, los
  permisos de pantallas nuevas y el usuario de prueba temporal de la fase 7. Nada más de negocio.
- El consolidado **nunca** puede cambiar (salvo los reversos aprobados). Ante la duda: BLOQUEO.
- Toda llamada Bash que compile lleva `cd /home/dev/saves/<app> &&`.
- Si algo no cuadra o hace falta una decisión de negocio, anotarlo en la bitácora como
  `BLOQUEO fase <n>:` con el detalle y **NO** escribir `FASE n: OK`.
- Al final de cada fase, añadir a `BITACORA.md`: la hora (Bogotá), lo hecho, los ficheros tocados, las
  cifras y la línea `FASE <n>: OK`.

## Valores confirmados por el usuario

L1_CRITERIO: abonados-activos (provisional)
L2_APROBADO: no
L3_CAJAS: suspender 4 y 21 (confirmado 24-sep)
