import { prisma } from '@/lib/db/prisma';

/** Only counts that prompt the user to act belong in the nav. */
export type NavCounts = {
  categorize: number;
};

export const getNavCounts = async (userId: string): Promise<NavCounts> => {
  // Mirrors the Categorize queue filter: skipped rows, transfer legs and card
  // payments never need a category, so they must not inflate the badge.
  const categorize = await prisma.transaction.count({
    where: { userId, categoryId: null, skippedAt: null, isTransfer: false, isPayment: false },
  });

  return { categorize };
};
