import { monthToRange } from '@/lib/period-selection';
import { transactionsHref } from '@/lib/transactions/transaction-filters';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * `/transactions` links for Overview's drill-downs. Each mirrors how its
 * figure is computed in `getOverviewData`: transfers are never counted, and
 * card payments never count as income. Two differences the filters can't
 * express: income linked as a reimbursement still lists, and expenses show
 * their gross amount rather than net of reimbursements.
 */
export const overviewIncomeHref = (month: number): string =>
  transactionsHref({
    ...monthToRange(month),
    type: 'INCOME',
    hideTransfers: true,
    hidePayments: true,
  });

export const overviewExpenseHref = (month: number): string =>
  transactionsHref({ ...monthToRange(month), type: 'EXPENSE', hideTransfers: true });

/** Both sides of Net: everything except transfers and card payments. */
export const overviewNetHref = (month: number): string =>
  transactionsHref({ ...monthToRange(month), hideTransfers: true, hidePayments: true });

/** A budget ring or a pie slice. No ids means the Uncategorized slice. */
export const overviewCategoryHref = (month: number, categoryIds: string[]): string =>
  transactionsHref({
    ...monthToRange(month),
    type: 'EXPENSE',
    hideTransfers: true,
    ...(categoryIds.length > 0 ? { categoryIds } : { uncategorizedOnly: true }),
  });

/** One day of `month`, optionally opening a transaction's detail drawer. */
export const overviewDayHref = (month: number, day: number, transactionId?: string): string => {
  const date = `${Math.floor(month / 100)}-${pad2(month % 100)}-${pad2(day)}`;
  const href = transactionsHref({ from: date, to: date });
  return transactionId ? `${href}&tx=${encodeURIComponent(transactionId)}` : href;
};
