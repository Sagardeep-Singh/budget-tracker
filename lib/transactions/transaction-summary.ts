import type { FrontendTransaction } from '@/lib/services/transactions';

export type TransactionSummary = {
  count: number;
  credit: number;
  debit: number;
  net: number;
  payments: number;
  transfers: number;
  reimbursementIncome: number;
};

/** Payments toward a credit card's balance settle the *previous* statement,
 * and both legs of a transfer between the user's own accounts are money that
 * never left the ledger, so neither counts toward this period's
 * credit/debit/net; they're reported separately instead. */
export const summarizeTransactions = (
  list: Pick<
    FrontendTransaction,
    'amount' | 'type' | 'isPayment' | 'isTransfer' | 'isReimbursementIncome'
  >[],
): TransactionSummary => {
  const summary = list.reduce(
    (acc, t) => {
      const amount = Number(t.amount);
      // isPayment is checked first so a card payment keeps its existing
      // "Payments (excluded)" treatment once transfer matching also flags it
      if (t.isPayment) {
        acc.payments += amount;
      } else if (t.isTransfer) {
        acc.transfers += amount;
      } else if (t.isReimbursementIncome) {
        acc.reimbursementIncome += amount;
      } else if (t.type === 'INCOME') {
        acc.credit += amount;
      } else {
        acc.debit += amount;
      }
      return acc;
    },
    { credit: 0, debit: 0, payments: 0, transfers: 0, reimbursementIncome: 0 },
  );
  return { ...summary, count: list.length, net: summary.credit - summary.debit };
};
