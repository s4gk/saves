-- Activos fijos: identificación física (marca, modelo, serial), dónde está (sede +
-- ubicación), custodio, compra (proveedor + factura) y fotos del equipo.
-- Las tablas Pqr* que `migrate diff` quiere borrar son deriva ajena: NO se tocan.
ALTER TABLE "FixedAsset" ADD COLUMN "branchId" TEXT,
ADD COLUMN "brand" TEXT,
ADD COLUMN "createdBy" TEXT,
ADD COLUMN "invoiceNumber" TEXT,
ADD COLUMN "location" TEXT,
ADD COLUMN "model" TEXT,
ADD COLUMN "responsible" TEXT,
ADD COLUMN "serialNumber" TEXT,
ADD COLUMN "supplier" TEXT;

CREATE TABLE "FixedAssetPhoto" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FixedAssetPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FixedAssetPhoto_assetId_idx" ON "FixedAssetPhoto"("assetId");
CREATE INDEX "FixedAsset_branchId_idx" ON "FixedAsset"("branchId");

ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FixedAssetPhoto" ADD CONSTRAINT "FixedAssetPhoto_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FixedAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Categoría para la infraestructura de red (OLT, Mikrotik, switches, radios): va a la
-- 1528 como el equipo de comunicación, a 5 años (tasa fiscal del 20 % anual).
INSERT INTO "FixedAssetCategory" ("id", "code", "name", "method", "usefulLifeMonths",
  "assetAccountId", "depreciationExpenseAccountId", "accumulatedDepreciationAccountId")
SELECT 'fac_red_telecom', 'RED', 'Equipo de red y telecomunicaciones', 'STRAIGHT_LINE', 60,
  (SELECT "id" FROM "Account" WHERE "code" = '1528'),
  (SELECT "id" FROM "Account" WHERE "code" = '5160'),
  (SELECT "id" FROM "Account" WHERE "code" = '1592')
WHERE EXISTS (SELECT 1 FROM "Account" WHERE "code" = '1528')
ON CONFLICT ("code") DO NOTHING;
