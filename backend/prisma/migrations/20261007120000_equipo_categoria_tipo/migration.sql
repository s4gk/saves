-- Categoría y tipo de equipo (ONU, OLT, RB…): solo nexus, el legacy no lo tiene.
ALTER TABLE "Equipment" ADD COLUMN "category" TEXT;
ALTER TABLE "Equipment" ADD COLUMN "equipmentType" TEXT;
CREATE INDEX "Equipment_equipmentType_idx" ON "Equipment"("equipmentType");
