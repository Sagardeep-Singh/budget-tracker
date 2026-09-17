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
  isReimbursable: boolean;
  reimbursementExpectedAmount: string | undefined;
};

/**
 * Shapes the /api/transactions request body. Pure so the regression-sensitive
 * rules below are unit-testable: `isPayment` (and, the same way,
 * `isReimbursable`) must be forced false whenever the account/type
 * combination can't take it, even if the checkbox state is still true from
 * before the user switched away from an eligible combination (the checkbox
 * is conditionally rendered, so its state can go stale).
 */
export const buildTransactionPayload = ({
  values,
  categoryId,
  type,
  canBePayment,
  isPayment,
  isTransfer,
  canBeReimbursable,
  isReimbursable,
  reimbursementExpectedAmount,
}: {
  values: TransactionFormValues;
  categoryId: string;
  type: string;
  canBePayment: boolean;
  isPayment: boolean;
  isTransfer: boolean;
  canBeReimbursable: boolean;
  isReimbursable: boolean;
  reimbursementExpectedAmount: string;
}): TransactionPayload => {
  const resultingReimbursable = canBeReimbursable && isReimbursable;
  return {
    accountId: values.accountId,
    categoryId: categoryId || null,
    amount: values.amount,
    type,
    date: values.date,
    payee: values.payee || undefined,
    note: values.note || undefined,
    isPayment: canBePayment && isPayment,
    isTransfer,
    isReimbursable: resultingReimbursable,
    reimbursementExpectedAmount: resultingReimbursable
      ? reimbursementExpectedAmount || undefined
      : undefined,
  };
};
