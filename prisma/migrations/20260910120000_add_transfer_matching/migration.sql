-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "isTransfer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "transferMatchId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_transferMatchId_idx" ON "Transaction"("transferMatchId");
