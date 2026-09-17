import { describe, expect, it } from 'vitest';
import {
  buildTransactionPayload,
  type TransactionFormValues,
} from '@/lib/transactions/transaction-payload';

const values: TransactionFormValues = {
  accountId: 'acc-1',
  amount: '12.34',
  date: '2026-09-14',
  payee: 'Coffee',
  note: 'morning',
};

const base = {
  values,
  categoryId: 'cat-1',
  type: 'EXPENSE',
  canBePayment: false,
  isPayment: false,
  isTransfer: false,
  canBeReimbursable: false,
  isReimbursable: false,
  reimbursementExpectedAmount: '',
};

describe('buildTransactionPayload', () => {
  it('passes the entered values straight through', () => {
    expect(buildTransactionPayload(base)).toEqual({
      accountId: 'acc-1',
      categoryId: 'cat-1',
      amount: '12.34',
      type: 'EXPENSE',
      date: '2026-09-14',
      payee: 'Coffee',
      note: 'morning',
      isPayment: false,
      isTransfer: false,
      isReimbursable: false,
      reimbursementExpectedAmount: undefined,
    });
  });

  it('sends categoryId as null, not an empty string, when none is chosen', () => {
    expect(buildTransactionPayload({ ...base, categoryId: '' }).categoryId).toBeNull();
  });

  it('sends blank payee and note as undefined, not an empty string', () => {
    const payload = buildTransactionPayload({
      ...base,
      values: { ...values, payee: '', note: '' },
    });
    expect(payload.payee).toBeUndefined();
    expect(payload.note).toBeUndefined();
  });

  it('treats an omitted payee and note as undefined', () => {
    const payload = buildTransactionPayload({
      ...base,
      values: { accountId: 'acc-1', amount: '1.00', date: '2026-09-14' },
    });
    expect(payload.payee).toBeUndefined();
    expect(payload.note).toBeUndefined();
  });

  it('keeps isPayment true when the account and type allow a payment', () => {
    const payload = buildTransactionPayload({
      ...base,
      type: 'INCOME',
      canBePayment: true,
      isPayment: true,
    });
    expect(payload.isPayment).toBe(true);
  });

  it('forces isPayment false when the combination is ineligible, even if the checkbox state is stale', () => {
    const payload = buildTransactionPayload({
      ...base,
      type: 'EXPENSE',
      canBePayment: false,
      isPayment: true,
    });
    expect(payload.isPayment).toBe(false);
  });

  it('carries isTransfer independently of payment eligibility', () => {
    expect(buildTransactionPayload({ ...base, isTransfer: true }).isTransfer).toBe(true);
  });

  it('carries the type from state rather than the form values', () => {
    expect(buildTransactionPayload({ ...base, type: 'INCOME' }).type).toBe('INCOME');
  });

  it('forces isReimbursable false when the type is not EXPENSE, even if the checkbox is stale', () => {
    const payload = buildTransactionPayload({
      ...base,
      type: 'INCOME',
      canBeReimbursable: false,
      isReimbursable: true,
      reimbursementExpectedAmount: '5.00',
    });
    expect(payload.isReimbursable).toBe(false);
    expect(payload.reimbursementExpectedAmount).toBeUndefined();
  });

  it('forces isReimbursable false when isTransfer is true, even if the checkbox is stale', () => {
    const payload = buildTransactionPayload({
      ...base,
      isTransfer: true,
      canBeReimbursable: false,
      isReimbursable: true,
      reimbursementExpectedAmount: '5.00',
    });
    expect(payload.isReimbursable).toBe(false);
    expect(payload.reimbursementExpectedAmount).toBeUndefined();
  });

  it('keeps isReimbursable true and passes the expected amount through on the happy path', () => {
    const payload = buildTransactionPayload({
      ...base,
      canBeReimbursable: true,
      isReimbursable: true,
      reimbursementExpectedAmount: '5.00',
    });
    expect(payload.isReimbursable).toBe(true);
    expect(payload.reimbursementExpectedAmount).toBe('5.00');
  });

  it('sends a blank expected amount as undefined even when reimbursable', () => {
    const payload = buildTransactionPayload({
      ...base,
      canBeReimbursable: true,
      isReimbursable: true,
      reimbursementExpectedAmount: '',
    });
    expect(payload.reimbursementExpectedAmount).toBeUndefined();
  });
});
