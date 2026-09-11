-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('ACTIVE', 'UNDONE');

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filenameNormalized" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "skippedDuplicates" INTEGER NOT NULL,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_userId_accountId_filenameNormalized_idx" ON "ImportBatch"("userId", "accountId", "filenameNormalized");

-- CreateIndex
CREATE INDEX "ImportBatch_userId_createdAt_idx" ON "ImportBatch"("userId", "createdAt");

-- Backfill: clear pre-existing orphan batch ids before the FK is enforced.
-- Pre-existing `importBatchId` values were bare randomUUID()s with no companion
-- entity, so they have no matching "ImportBatch" row and would fail the FK below.
UPDATE "Transaction" SET "importBatchId" = NULL WHERE "importBatchId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
