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

const { createTransaction, updateTransaction, skipTransaction, listTransactions } =
  await import('@/lib/services/transactions');

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
  importBatchId: null,
  account: { name: 'Visa' },
  category: null,
  importBatch: null,
};

describe('listTransactions import batch filter', () => {
  it('filters on importBatchId when a batchId is supplied', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([]);

    await listTransactions('user-1', { batchId: 'batch-1' });

    expect(prismaMock.transaction.findMany.mock.calls[0][0].where).toEqual({
      userId: 'user-1',
      accountId: undefined,
      categoryId: undefined,
      importBatchId: 'batch-1',
      date: { gte: undefined, lte: undefined },
    });
  });

  it('leaves importBatchId undefined (never null) when no batchId is supplied', async () => {
    // a `null` here would silently narrow the list to manually-entered rows only
    prismaMock.transaction.findMany.mockResolvedValue([]);

    await listTransactions('user-1', {});

    const where = prismaMock.transaction.findMany.mock.calls[0][0].where;
    expect(where.importBatchId).toBeUndefined();
    expect(where).toEqual({
      userId: 'user-1',
      accountId: undefined,
      categoryId: undefined,
      importBatchId: undefined,
      date: { gte: undefined, lte: undefined },
    });
  });
});

describe('listTransactions import batch mapping', () => {
  it('exposes the batch id and filename for an imported transaction', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        ...baseTx,
        importBatchId: 'b1',
        importBatch: { id: 'b1', filename: 'march.csv' },
      },
    ]);

    const [result] = await listTransactions('user-1', {});

    expect(result.importBatchId).toBe('b1');
    expect(result.importBatchFilename).toBe('march.csv');
  });

  it('leaves both batch fields null for a manually entered transaction', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([baseTx]);

    const [result] = await listTransactions('user-1', {});

    expect(result.importBatchId).toBeNull();
    expect(result.importBatchFilename).toBeNull();
  });

  it('still serializes the amount as a fixed-2 string', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([baseTx]);

    const [result] = await listTransactions('user-1', {});

    expect(result.amount).toBe('50.00');
  });
});

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

describe('skipTransaction', () => {
  it('sets skippedAt to a server-generated timestamp, not a client-supplied one', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({ id: 'tx-1', accountId: 'acc-1' });
    prismaMock.transaction.update.mockResolvedValue(baseTx);

    await skipTransaction('user-1', 'tx-1');

    expect(prismaMock.transaction.findFirst).toHaveBeenCalledWith({
      where: { id: 'tx-1', userId: 'user-1' },
    });
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: { skippedAt: expect.any(Date) },
    });
  });

  it('throws when the transaction does not belong to the user', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(null);

    await expect(skipTransaction('user-1', 'tx-missing')).rejects.toThrow('Transaction not found');
    expect(prismaMock.transaction.update).not.toHaveBeenCalled();
  });
});
