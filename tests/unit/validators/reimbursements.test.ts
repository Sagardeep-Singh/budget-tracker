import { describe, expect, it } from 'vitest';
import {
  createReimbursementLinkSchema,
  listReimbursementCandidatesQuerySchema,
  updateReimbursementLinkSchema,
} from '@/lib/validators/reimbursements';

describe('createReimbursementLinkSchema', () => {
  it('accepts a valid payload', () => {
    const result = createReimbursementLinkSchema.safeParse({
      expenseTransactionId: 'exp-1',
      incomeTransactionId: 'inc-1',
      amount: 10,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-positive amount', () => {
    const result = createReimbursementLinkSchema.safeParse({
      expenseTransactionId: 'exp-1',
      incomeTransactionId: 'inc-1',
      amount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing expenseTransactionId', () => {
    const result = createReimbursementLinkSchema.safeParse({
      incomeTransactionId: 'inc-1',
      amount: 10,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing incomeTransactionId', () => {
    const result = createReimbursementLinkSchema.safeParse({
      expenseTransactionId: 'exp-1',
      amount: 10,
    });
    expect(result.success).toBe(false);
  });
});

describe('updateReimbursementLinkSchema', () => {
  it('requires a positive amount', () => {
    expect(updateReimbursementLinkSchema.safeParse({ amount: 10 }).success).toBe(true);
    expect(updateReimbursementLinkSchema.safeParse({ amount: 0 }).success).toBe(false);
    expect(updateReimbursementLinkSchema.safeParse({}).success).toBe(false);
  });
});

describe('listReimbursementCandidatesQuerySchema', () => {
  it('defaults limit when omitted', () => {
    const result = listReimbursementCandidatesQuerySchema.safeParse({});
    expect(result.success && result.data.limit).toBe(8);
  });

  it('accepts an explicit search and limit', () => {
    const result = listReimbursementCandidatesQuerySchema.safeParse({
      search: 'refund',
      limit: 5,
    });
    expect(result.success && result.data.search).toBe('refund');
    expect(result.success && result.data.limit).toBe(5);
  });

  it('rejects a limit outside the allowed range', () => {
    expect(listReimbursementCandidatesQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listReimbursementCandidatesQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
  });
});
