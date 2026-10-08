-- Seguimiento de cartera: fecha del último pago, clasificación a mano y observaciones.
ALTER TABLE "CarteraSeguimiento" ADD COLUMN "ultimoPago" DATE;
ALTER TABLE "CarteraSeguimiento" ADD COLUMN "categoriaManual" TEXT;
ALTER TABLE "CarteraSeguimiento" ADD COLUMN "observaciones" TEXT;
ALTER TABLE "CarteraSeguimiento" ADD COLUMN "gestionadoPorId" TEXT;
ALTER TABLE "CarteraSeguimiento" ADD COLUMN "gestionadoEn" TIMESTAMP(3);

-- Los meses ya cerrados no tenían la fecha: se saca de los mismos ingresos que
-- cuentan como "pagado" (VIGENTES, dentro del mes).
UPDATE "CarteraSeguimiento" c SET "ultimoPago" = p.ultimo
FROM (
  SELECT c2.id, MAX(t.date)::date ultimo
  FROM "CarteraSeguimiento" c2
  JOIN "Transaction" t ON t."subscriberId" = c2."subscriberId" AND t.type = 'INCOME' AND t.status = 'VIGENTE'
   AND t.date >= c2.mes AND t.date < (c2.mes + INTERVAL '1 month')
  WHERE c2."cerradoEn" IS NOT NULL
  GROUP BY c2.id
) p
WHERE p.id = c.id;
