-- Notas crédito/débito PENDIENTES: se dejan cuando el cliente aún no tiene factura y
-- se aplican solas a la próxima que nazca. Ver src/billing/notas-pendientes.ts.

-- CreateTable
CREATE TABLE "PendingNote" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "applied" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "retentionType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "authorLegacyId" INTEGER,
    "createdByName" TEXT NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "canceledBy" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingNoteApplication" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingNoteApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingNote_subscriberId_status_idx" ON "PendingNote"("subscriberId", "status");

-- CreateIndex
CREATE INDEX "PendingNote_status_createdAt_idx" ON "PendingNote"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PendingNoteApplication_noteId_idx" ON "PendingNoteApplication"("noteId");

-- CreateIndex
CREATE INDEX "PendingNoteApplication_invoiceId_idx" ON "PendingNoteApplication"("invoiceId");

-- AddForeignKey
ALTER TABLE "PendingNote" ADD CONSTRAINT "PendingNote_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingNoteApplication" ADD CONSTRAINT "PendingNoteApplication_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "PendingNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingNoteApplication" ADD CONSTRAINT "PendingNoteApplication_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SubInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
