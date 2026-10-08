-- Activos fijos: ubicación GPS tomada en el sitio (coordenadas, precisión, quién y cuándo).
ALTER TABLE "FixedAsset" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION,
ADD COLUMN "gpsAccuracy" INTEGER,
ADD COLUMN "gpsCapturedAt" TIMESTAMP(3),
ADD COLUMN "gpsCapturedBy" TEXT;
