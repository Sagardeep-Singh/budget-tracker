-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "isReimbursable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reimbursementCompletedAt" TIMESTAMP(3),
ADD COLUMN     "reimbursementExpectedAmount" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "ReimbursementLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expenseTransactionId" TEXT NOT NULL,
    "incomeTransactionId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReimbursementLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReimbursementLink_userId_idx" ON "ReimbursementLink"("userId");

-- CreateIndex
CREATE INDEX "ReimbursementLink_incomeTransactionId_idx" ON "ReimbursementLink"("incomeTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReimbursementLink_expenseTransactionId_incomeTransactionId_key" ON "ReimbursementLink"("expenseTransactionId", "incomeTransactionId");

-- CreateIndex
CREATE INDEX "Transaction_userId_isReimbursable_idx" ON "Transaction"("userId", "isReimbursable");

-- AddForeignKey
ALTER TABLE "ReimbursementLink" ADD CONSTRAINT "ReimbursementLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementLink" ADD CONSTRAINT "ReimbursementLink_expenseTransactionId_fkey" FOREIGN KEY ("expenseTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementLink" ADD CONSTRAINT "ReimbursementLink_incomeTransactionId_fkey" FOREIGN KEY ("incomeTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
