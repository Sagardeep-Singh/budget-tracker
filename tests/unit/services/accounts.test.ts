import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    account: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { createAccount, deleteAccount, listAccounts, updateAccount } =
  await import('@/lib/services/accounts');
const { ServiceValidationError } = await import('@/lib/services/common');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listAccounts', () => {
  it('derives balance from starting balance plus signed transaction amounts', async () => {
    prismaMock.account.findMany.mockResolvedValue([
      {
        id: 'acc-1',
        name: 'Checking',
        type: 'CHECKING',
        startingBalance: 100,
        createdAt: new Date('2026-01-01'),
        transactions: [
          { amount: 50, type: 'INCOME' },
          { amount: 20, type: 'EXPENSE' },
        ],
      },
    ]);

    const result = await listAccounts('user-1');

    expect(result).toEqual([
      {
        id: 'acc-1',
        name: 'Checking',
        type: 'CHECKING',
        startingBalance: 100,
        createdAt: '2026-01-01T00:00:00.000Z',
        balance: '130.00',
      },
    ]);
  });
});

describe('createAccount', () => {
  it('creates an account scoped to the user', async () => {
    prismaMock.account.create.mockResolvedValue({
      id: 'acc-2',
      name: 'Savings',
      type: 'SAVINGS',
      startingBalance: 0,
      createdAt: new Date('2026-01-01'),
      transactions: [],
    });

    const result = await createAccount('user-1', {
      name: 'Savings',
      type: 'SAVINGS',
      startingBalance: 0,
    });

    expect(prismaMock.account.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1' }) }),
    );
    expect(result.balance).toBe('0.00');
  });
});

describe('updateAccount / deleteAccount', () => {
  it('throws ServiceValidationError when the account does not belong to the user', async () => {
    prismaMock.account.findFirst.mockResolvedValue(null);

    await expect(updateAccount('user-1', 'acc-x', { name: 'x' })).rejects.toThrow(
      ServiceValidationError,
    );
    await expect(deleteAccount('user-1', 'acc-x')).rejects.toThrow(ServiceValidationError);
  });
});
