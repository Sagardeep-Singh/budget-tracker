import { describe, expect, it } from 'vitest';
import { resolveImportedTransactionType } from '@/lib/import';

describe('resolveImportedTransactionType', () => {
  it('treats a negative amount as an expense for a checking/savings/cash account', () => {
    expect(resolveImportedTransactionType(-42.5, 'CHECKING')).toBe('EXPENSE');
    expect(resolveImportedTransactionType(-42.5, 'SAVINGS')).toBe('EXPENSE');
    expect(resolveImportedTransactionType(-42.5, 'CASH')).toBe('EXPENSE');
  });

  it('treats a positive amount as income for a checking/savings/cash account', () => {
    expect(resolveImportedTransactionType(42.5, 'CHECKING')).toBe('INCOME');
  });

  it('treats a positive amount as an expense for a credit card account (a charge)', () => {
    expect(resolveImportedTransactionType(42.5, 'CREDIT_CARD')).toBe('EXPENSE');
  });

  it('treats a negative amount as income for a credit card account (a payment or refund)', () => {
    expect(resolveImportedTransactionType(-42.5, 'CREDIT_CARD')).toBe('INCOME');
  });
});
