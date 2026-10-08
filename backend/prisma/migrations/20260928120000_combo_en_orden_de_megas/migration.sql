-- La orden de megas puede llevar un COMBO destino (internet + TV / streaming).
ALTER TABLE "Ticket" ADD COLUMN "bundleToId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "bundleToName" TEXT;
