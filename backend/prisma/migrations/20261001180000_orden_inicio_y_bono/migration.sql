-- Hora real de inicio de la orden y bono por terminar temprano.
ALTER TABLE "Ticket" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "earlyBonus" INTEGER;

CREATE TABLE "TicketTypeTime" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketTypeTime_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TicketTypeTime_type_key" ON "TicketTypeTime"("type");
