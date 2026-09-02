import { prisma } from '@/lib/db/prisma';
import { ServiceValidationError } from '@/lib/services/common';
import type {
  CreateTransactionInput,
  ListTransactionsQuery,
  UpdateTransactionInput,
} from '@/lib/validators/transactions';

export type FrontendTransaction = {
  id: string;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  amount: string;
  type: string;
  date: string;
  payee: string | null;
  note: string | null;
};

const toFrontend = (tx: {
  id: string;
  accountId: string;
  categoryId: string | null;
  amount: unknown;
  type: string;
  date: Date;
  payee: string | null;
  note: string | null;
  account: { name: string };
  category: { name: string } | null;
}): FrontendTransaction => ({
  id: tx.id,
  accountId: tx.accountId,
  accountName: tx.account.name,
  categoryId: tx.categoryId,
  categoryName: tx.category?.name ?? null,
  amount: Number(tx.amount).toFixed(2),
  type: tx.type,
  date: tx.date.toISOString(),
  payee: tx.payee,
  note: tx.note,
});

const include = {
  account: { select: { name: true } },
  category: { select: { name: true } },
} as const;

export const listTransactions = async (
  userId: string,
  query: ListTransactionsQuery,
): Promise<FrontendTransaction[]> => {
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      accountId: query.accountId,
      categoryId: query.categoryId,
      date: {
        gte: query.from,
        lte: query.to,
      },
    },
    include,
    orderBy: { date: 'desc' },
  });
  return transactions.map(toFrontend);
};

const assertOwnedRefs = async (
  userId: string,
  accountId: string,
  categoryId?: string | null,
): Promise<void> => {
  const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!account) {
    throw new ServiceValidationError('Account not found');
  }
  if (categoryId) {
    const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
    if (!category) {
      throw new ServiceValidationError('Category not found');
    }
  }
};

export const createTransaction = async (
  userId: string,
  input: CreateTransactionInput,
): Promise<FrontendTransaction> => {
  await assertOwnedRefs(userId, input.accountId, input.categoryId);

  const transaction = await prisma.transaction.create({
    data: {
      userId,
      accountId: input.accountId,
      categoryId: input.categoryId ?? null,
      amount: input.amount,
      type: input.type,
      date: input.date,
      payee: input.payee,
      note: input.note,
    },
    include,
  });
  return toFrontend(transaction);
};

export const updateTransaction = async (
  userId: string,
  transactionId: string,
  input: UpdateTransactionInput,
): Promise<FrontendTransaction> => {
  const existing = await prisma.transaction.findFirst({ where: { id: transactionId, userId } });
  if (!existing) {
    throw new ServiceValidationError('Transaction not found');
  }
  if (input.accountId || input.categoryId !== undefined) {
    await assertOwnedRefs(
      userId,
      input.accountId ?? existing.accountId,
      input.categoryId ?? undefined,
    );
  }

  const transaction = await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      accountId: input.accountId,
      categoryId: input.categoryId,
      amount: input.amount,
      type: input.type,
      date: input.date,
      payee: input.payee,
      note: input.note,
    },
    include,
  });
  return toFrontend(transaction);
};

export const deleteTransaction = async (userId: string, transactionId: string): Promise<void> => {
  const existing = await prisma.transaction.findFirst({ where: { id: transactionId, userId } });
  if (!existing) {
    throw new ServiceValidationError('Transaction not found');
  }
  await prisma.transaction.delete({ where: { id: transactionId } });
};
