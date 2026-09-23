-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('ANTHROPIC', 'OPENAI');

-- CreateTable
CREATE TABLE "UserAiSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "sendNote" BOOLEAN NOT NULL DEFAULT false,
    "sendAmount" BOOLEAN NOT NULL DEFAULT false,
    "disclosureAcceptedAt" TIMESTAMP(3),
    "suggestCountDate" INTEGER,
    "suggestCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAiSettings_userId_key" ON "UserAiSettings"("userId");

-- AddForeignKey
ALTER TABLE "UserAiSettings" ADD CONSTRAINT "UserAiSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
