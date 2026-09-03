import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    transaction: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    account: { findFirst: vi.fn() },
    category: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { createTransaction, updateTransaction } = await import('@/lib/services/transactions');

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.account.findFirst.mockResolvedValue({ id: 'acc-1' });
});

const baseTx = {
  id: 'tx-1',
  accountId: 'acc-1',
  categoryId: null,
  amount: 50,
  type: 'INCOME' as const,
  date: new Date('2026-03-16'),
  payee: 'Card payment',
  note: null,
  isPayment: true,
  account: { name: 'Visa' },
  category: null,
};

describe('createTransaction isPayment', () => {
  it('persists isPayment when flagged as a card payment', async () => {
    prismaMock.transaction.create.mockResolvedValue(baseTx);

    const result = await createTransaction('user-1', {
      accountId: 'acc-1',
      amount: 50,
      type: 'INCOME',
      date: new Date('2026-03-16'),
      payee: 'Card payment',
      isPayment: true,
    });

    expect(prismaMock.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPayment: true }) }),
    );
    expect(result.isPayment).toBe(true);
  });

  it('defaults isPayment to false for ordinary transactions', async () => {
    prismaMock.transaction.create.mockResolvedValue({ ...baseTx, isPayment: false });

    await createTransaction('user-1', {
      accountId: 'acc-1',
      amount: 12,
      type: 'EXPENSE',
      date: new Date('2026-03-16'),
      isPayment: false,
    });

    expect(prismaMock.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPayment: false }) }),
    );
  });
});

describe('updateTransaction isPayment', () => {
  it('passes isPayment through on update', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({ id: 'tx-1', accountId: 'acc-1' });
    prismaMock.transaction.update.mockResolvedValue(baseTx);

    await updateTransaction('user-1', 'tx-1', { isPayment: true });

    expect(prismaMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPayment: true }) }),
    );
  });
});
