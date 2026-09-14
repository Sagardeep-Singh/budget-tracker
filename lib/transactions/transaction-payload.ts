export type TransactionFormValues = {
  accountId: string;
  amount: string;
  date: string;
  payee?: string;
  note?: string;
};

export type TransactionPayload = {
  accountId: string;
  categoryId: string | null;
  amount: string;
  type: string;
  date: string;
  payee: string | undefined;
  note: string | undefined;
  isPayment: boolean;
  isTransfer: boolean;
};

/**
 * Shapes the /api/transactions request body. Pure so the one
 * regression-sensitive rule below is unit-testable: `isPayment` must be
 * forced false whenever the account/type combination can't take a payment,
 * even if the checkbox state is still true from before the user switched
 * away from an eligible combination (the checkbox is conditionally
 * rendered, so its state can go stale).
 */
export const buildTransactionPayload = ({
  values,
  categoryId,
  type,
  canBePayment,
  isPayment,
  isTransfer,
}: {
  values: TransactionFormValues;
  categoryId: string;
  type: string;
  canBePayment: boolean;
  isPayment: boolean;
  isTransfer: boolean;
}): TransactionPayload => ({
  accountId: values.accountId,
  categoryId: categoryId || null,
  amount: values.amount,
  type,
  date: values.date,
  payee: values.payee || undefined,
  note: values.note || undefined,
  isPayment: canBePayment && isPayment,
  isTransfer,
});
