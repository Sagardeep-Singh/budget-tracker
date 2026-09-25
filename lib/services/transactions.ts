import { prisma } from '@/lib/db/prisma';
import { ReimbursementConflictError, ServiceValidationError } from '@/lib/services/common';
import {
  assertNoActiveLinks,
  deriveReimbursementStatus,
  toCents,
  type ReimbursementStatus,
} from '@/lib/services/reimbursements';
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
  isPayment: boolean;
  importBatchId: string | null;
  /** null when the transaction was entered manually rather than imported */
  importBatchFilename: string | null;
  isTransfer: boolean;
  transferMatchId: string | null;
  isReimbursable: boolean;
  reimbursementExpectedAmount: string | null;
  reimbursementLinkedTotal: string;
  reimbursementOutstanding: string;
  reimbursementStatus: ReimbursementStatus | null;
  reimbursementCompletedManually: boolean;
  /** this row is the INCOME side of >=1 link: excluded from income aggregates, blocked from delete */
  isReimbursementIncome: boolean;
  reimbursementIncomeLinkedTotal: string;
};

/** Exported for `lib/services/transactionsPage.ts` — one row shape for both read paths. */
export const toFrontend = (tx: {
  id: string;
  accountId: string;
  categoryId: string | null;
  amount: unknown;
  type: string;
  date: Date;
  payee: string | null;
  note: string | null;
  isPayment: boolean;
  importBatchId: string | null;
  isTransfer: boolean;
  transferMatchId: string | null;
  isReimbursable: boolean;
  reimbursementExpectedAmount: unknown;
  reimbursementCompletedAt: Date | null;
  account: { name: string };
  category: { name: string } | null;
  importBatch: { id: string; filename: string } | null;
  reimbursementExpenseLinks: { amount: unknown }[];
  reimbursementIncomeLinks: { amount: unknown }[];
}): FrontendTransaction => {
  const expectedCents =
    tx.reimbursementExpectedAmount == null ? null : toCents(tx.reimbursementExpectedAmount);
  const linkedCents = tx.reimbursementExpenseLinks.reduce((sum, l) => sum + toCents(l.amount), 0);
  const incomeLinkedCents = tx.reimbursementIncomeLinks.reduce(
    (sum, l) => sum + toCents(l.amount),
    0,
  );
  const status = deriveReimbursementStatus({
    isReimbursable: tx.isReimbursable,
    expectedCents,
    linkedCents,
    completedAt: tx.reimbursementCompletedAt,
  });
  const outstandingCents = expectedCents === null ? 0 : Math.max(0, expectedCents - linkedCents);

  return {
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
    isPayment: tx.isPayment,
    importBatchId: tx.importBatchId,
    importBatchFilename: tx.importBatch?.filename ?? null,
    isTransfer: tx.isTransfer,
    transferMatchId: tx.transferMatchId,
    isReimbursable: tx.isReimbursable,
    reimbursementExpectedAmount: expectedCents === null ? null : (expectedCents / 100).toFixed(2),
    reimbursementLinkedTotal: (linkedCents / 100).toFixed(2),
    reimbursementOutstanding: (outstandingCents / 100).toFixed(2),
    reimbursementStatus: status,
    reimbursementCompletedManually: tx.reimbursementCompletedAt !== null,
    isReimbursementIncome: tx.reimbursementIncomeLinks.length > 0,
    reimbursementIncomeLinkedTotal: (incomeLinkedCents / 100).toFixed(2),
  };
};

/** Exported for `lib/services/transactionsPage.ts` — the relations `toFrontend` needs. */
export const include = {
  account: { select: { name: true } },
  category: { select: { name: true } },
  importBatch: { select: { id: true, filename: true } },
  reimbursementExpenseLinks: { select: { amount: true } },
  reimbursementIncomeLinks: { select: { amount: true } },
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
      importBatchId: query.batchId,
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
      isPayment: input.isPayment,
      isTransfer: input.isTransfer,
      isReimbursable: input.isReimbursable,
      reimbursementExpectedAmount: input.isReimbursable ? input.reimbursementExpectedAmount : null,
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
  const existing = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    include: {
      reimbursementExpenseLinks: { select: { amount: true } },
      reimbursementIncomeLinks: { select: { amount: true } },
    },
  });
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

  const resultingIsTransfer = input.isTransfer ?? existing.isTransfer;
  const resultingIsPayment = input.isPayment ?? existing.isPayment;
  const resultingIsReimbursable = input.isReimbursable ?? existing.isReimbursable;
  const resultingAmountCents = toCents(input.amount ?? existing.amount);
  const resultingExpectedCents =
    input.reimbursementExpectedAmount !== undefined
      ? input.reimbursementExpectedAmount === null
        ? null
        : toCents(input.reimbursementExpectedAmount)
      : existing.reimbursementExpectedAmount === null
        ? null
        : toCents(existing.reimbursementExpectedAmount);
  const expenseLinkedCents = existing.reimbursementExpenseLinks.reduce(
    (sum, l) => sum + toCents(l.amount),
    0,
  );
  const incomeLinkedCents = existing.reimbursementIncomeLinks.reduce(
    (sum, l) => sum + toCents(l.amount),
    0,
  );

  if (input.type !== undefined && input.type !== existing.type) {
    if (existing.type === 'EXPENSE' && expenseLinkedCents > 0) {
      throw new ReimbursementConflictError(
        'Cannot change the type of a transaction that has reimbursement links',
      );
    }
    if (existing.type === 'INCOME' && incomeLinkedCents > 0) {
      throw new ReimbursementConflictError(
        'Cannot change the type of a transaction that has reimbursement links',
      );
    }
  }

  if (resultingIsReimbursable && (resultingIsTransfer || resultingIsPayment)) {
    throw new ServiceValidationError(
      'A reimbursable expense cannot also be a transfer or a card payment',
    );
  }
  if ((resultingIsTransfer || resultingIsPayment) && incomeLinkedCents > 0) {
    throw new ReimbursementConflictError(
      'This income is linked to a reimbursable expense; it cannot also be a transfer or card payment',
    );
  }

  if (input.isReimbursable === false && expenseLinkedCents > 0) {
    throw new ReimbursementConflictError(
      "Remove this expense's reimbursement links before un-marking it",
    );
  }

  if (resultingIsReimbursable && resultingExpectedCents !== null) {
    if (resultingExpectedCents > resultingAmountCents) {
      throw new ServiceValidationError(
        'The expected reimbursement cannot exceed the expense amount',
      );
    }
    if (resultingExpectedCents < expenseLinkedCents) {
      throw new ReimbursementConflictError(
        `${(expenseLinkedCents / 100).toFixed(2)} is already linked to this expense; the expected reimbursement cannot be lower`,
      );
    }
  }

  if (
    existing.type === 'INCOME' &&
    input.amount !== undefined &&
    resultingAmountCents < incomeLinkedCents
  ) {
    throw new ReimbursementConflictError(
      `This income is linked to ${(incomeLinkedCents / 100).toFixed(2)} of reimbursements; its amount cannot be lower`,
    );
  }

  if (input.reimbursementCompleted === true && !resultingIsReimbursable) {
    throw new ServiceValidationError('Only a reimbursable expense can be marked fully reimbursed');
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
      isPayment: input.isPayment,
      isTransfer: input.isTransfer,
      // un-marking a transfer drops the correlation id too, so a bad auto-match
      // leaves nothing dangling on this row
      transferMatchId: input.isTransfer === false ? null : undefined,
      isReimbursable: input.isReimbursable,
      reimbursementExpectedAmount:
        input.isReimbursable === false ? null : input.reimbursementExpectedAmount,
      reimbursementCompletedAt:
        input.reimbursementCompleted === true
          ? (existing.reimbursementCompletedAt ?? new Date())
          : input.reimbursementCompleted === false
            ? null
            : undefined,
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
  await assertNoActiveLinks(
    userId,
    [transactionId],
    'This transaction has reimbursement links. Remove them before deleting it.',
  );
  await prisma.transaction.delete({ where: { id: transactionId } });
};

export const skipTransaction = async (userId: string, transactionId: string): Promise<void> => {
  const existing = await prisma.transaction.findFirst({ where: { id: transactionId, userId } });
  if (!existing) {
    throw new ServiceValidationError('Transaction not found');
  }
  await prisma.transaction.update({
    where: { id: transactionId },
    data: { skippedAt: new Date() },
  });
};
