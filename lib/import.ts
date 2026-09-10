/**
 * CSV sign convention differs by account type: checking/savings/cash
 * exports use the debit convention (negative = money out = expense);
 * credit card/line-of-credit exports are inverted (positive = a charge =
 * expense, negative = a payment or refund credited back = income).
 */
export const resolveImportedTransactionType = (
  amount: number,
  accountType: string,
): 'INCOME' | 'EXPENSE' => {
  const isExpense = accountType === 'CREDIT_CARD' ? amount > 0 : amount < 0;
  return isExpense ? 'EXPENSE' : 'INCOME';
};
