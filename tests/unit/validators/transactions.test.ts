import { describe, expect, it } from 'vitest';
import {
  createTransactionSchema,
  transactionsPageQuerySchema,
  updateTransactionSchema,
} from '@/lib/validators/transactions';

const base = { accountId: 'acc-1', amount: 10, type: 'EXPENSE' as const, date: '2026-01-01' };

describe('createTransactionSchema reimbursement rules', () => {
  it('parses an ordinary payload unaffected by the new fields', () => {
    const result = createTransactionSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('defaults isReimbursable to false when omitted', () => {
    const result = createTransactionSchema.safeParse(base);
    expect(result.success && result.data.isReimbursable).toBe(false);
  });

  it('rejects isReimbursable on an INCOME transaction', () => {
    const result = createTransactionSchema.safeParse({
      ...base,
      type: 'INCOME',
      isReimbursable: true,
      reimbursementExpectedAmount: 5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects isReimbursable combined with isTransfer', () => {
    const result = createTransactionSchema.safeParse({
      ...base,
      isReimbursable: true,
      reimbursementExpectedAmount: 5,
      isTransfer: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects isReimbursable combined with isPayment', () => {
    const result = createTransactionSchema.safeParse({
      ...base,
      isReimbursable: true,
      reimbursementExpectedAmount: 5,
      isPayment: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects isReimbursable without an expected amount', () => {
    const result = createTransactionSchema.safeParse({ ...base, isReimbursable: true });
    expect(result.success).toBe(false);
  });

  it('rejects an expected amount greater than the transaction amount', () => {
    const result = createTransactionSchema.safeParse({
      ...base,
      isReimbursable: true,
      reimbursementExpectedAmount: 20,
    });
    expect(result.success).toBe(false);
  });

  it('accepts an expected amount equal to the transaction amount', () => {
    const result = createTransactionSchema.safeParse({
      ...base,
      isReimbursable: true,
      reimbursementExpectedAmount: 10,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an expected amount less than the transaction amount (partial)', () => {
    const result = createTransactionSchema.safeParse({
      ...base,
      isReimbursable: true,
      reimbursementExpectedAmount: 4,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an expected amount when isReimbursable is false or omitted', () => {
    const result = createTransactionSchema.safeParse({ ...base, reimbursementExpectedAmount: 4 });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive expected amount regardless of isReimbursable', () => {
    const result = createTransactionSchema.safeParse({
      ...base,
      isReimbursable: true,
      reimbursementExpectedAmount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects marking fully reimbursed when not reimbursable', () => {
    const result = createTransactionSchema.safeParse({ ...base, reimbursementCompleted: true });
    expect(result.success).toBe(false);
  });

  it('accepts marking fully reimbursed alongside isReimbursable', () => {
    const result = createTransactionSchema.safeParse({
      ...base,
      isReimbursable: true,
      reimbursementExpectedAmount: 10,
      reimbursementCompleted: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('updateTransactionSchema stays fully partial', () => {
  it('accepts an empty object (the three boolean flags still resolve to their defaults, pre-existing behavior)', () => {
    const result = updateTransactionSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ isPayment: false, isTransfer: false, isReimbursable: false });
    }
  });

  it('accepts a single unrelated field on its own', () => {
    const result = updateTransactionSchema.safeParse({ payee: 'x' });
    expect(result.success).toBe(true);
  });

  it('leaves the expected-amount-vs-amount check as a no-op when amount is absent from this payload', () => {
    const result = updateTransactionSchema.safeParse({
      isReimbursable: true,
      reimbursementExpectedAmount: 50,
    });
    expect(result.success).toBe(true);
  });

  it('still runs the expected-vs-amount comparison when both are present in the same PATCH', () => {
    const result = updateTransactionSchema.safeParse({
      amount: 10,
      reimbursementExpectedAmount: 20,
    });
    expect(result.success).toBe(false);
  });

  it('rejects isTransfer + isReimbursable together on a partial update too', () => {
    const result = updateTransactionSchema.safeParse({ isTransfer: true, isReimbursable: true });
    expect(result.success).toBe(false);
  });

  it('allows isPayment alone, since the isReimbursable conflict needs the DB row', () => {
    const result = updateTransactionSchema.safeParse({ isPayment: true });
    expect(result.success).toBe(true);
  });
});

describe('transactionsPageQuerySchema', () => {
  it('defaults every field for an empty query', () => {
    const result = transactionsPageQuerySchema.parse({});
    // nullish filters stay absent; `toTransactionsPageRequest` maps them to null
    for (const key of ['from', 'to', 'type', 'amountMin', 'amountMax'] as const) {
      expect(result[key] ?? null).toBeNull();
    }
    expect(result).toEqual({
      accountIds: [],
      categoryIds: [],
      payee: '',
      hideTransfers: false,
      hidePayments: false,
      uncategorizedOnly: false,
      mobileSearch: '',
      quickFilter: 'all',
      limit: 50,
    });
  });

  it('degrades malformed filter values to "no filter" instead of failing', () => {
    const result = transactionsPageQuerySchema.parse({
      from: 'garbage',
      to: '2026/06/01',
      type: 'BOTH',
      hideTransfers: 'yes',
      quickFilter: 'everything',
      payee: 'x'.repeat(200),
    });
    expect(result).toMatchObject({
      from: null,
      to: null,
      type: null,
      hideTransfers: false,
      quickFilter: 'all',
      payee: '',
    });
  });

  it('splits and trims comma-separated ids', () => {
    const result = transactionsPageQuerySchema.parse({ accountIds: ' a, b ,,c ' });
    expect(result.accountIds).toEqual(['a', 'b', 'c']);
  });

  it('keeps amount bounds as strings so the service applies the finite-number rule', () => {
    const result = transactionsPageQuerySchema.parse({ amountMin: 'abc', amountMax: '20' });
    expect(result.amountMin).toBe('abc');
    expect(result.amountMax).toBe('20');
  });

  it('is strict about limit', () => {
    expect(transactionsPageQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(transactionsPageQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(transactionsPageQuerySchema.safeParse({ limit: 'ten' }).success).toBe(false);
    expect(transactionsPageQuerySchema.parse({ limit: '25' }).limit).toBe(25);
  });

  it('requires periodStart and periodEnd together, start before end', () => {
    const start = '2026-06-01T00:00:00.000Z';
    const end = '2026-07-01T00:00:00.000Z';
    expect(transactionsPageQuerySchema.safeParse({ periodStart: start }).success).toBe(false);
    expect(
      transactionsPageQuerySchema.safeParse({ periodStart: end, periodEnd: start }).success,
    ).toBe(false);
    const ok = transactionsPageQuerySchema.parse({ periodStart: start, periodEnd: end });
    expect(ok.periodStart?.toISOString()).toBe(start);
    expect(ok.periodEnd?.toISOString()).toBe(end);
  });
});
