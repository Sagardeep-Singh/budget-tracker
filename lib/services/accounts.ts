import { prisma } from '@/lib/db/prisma';
import { toSerializable } from '@/lib/utils';
import { ServiceValidationError } from '@/lib/services/common';
import type { CreateAccountInput, UpdateAccountInput } from '@/lib/validators/accounts';

export type FrontendAccount = {
  id: string;
  name: string;
  type: string;
  startingBalance: string;
  balance: string;
  createdAt: string;
  statementDay: number | null;
};

const toFrontendAccount = (account: {
  id: string;
  name: string;
  type: string;
  startingBalance: unknown;
  createdAt: Date;
  statementDay: number | null;
  transactions: { amount: unknown; type: string }[];
}): FrontendAccount => {
  const starting = Number(account.startingBalance);
  const net = account.transactions.reduce((sum, t) => {
    const amount = Number(t.amount);
    return sum + (t.type === 'INCOME' ? amount : -amount);
  }, 0);

  return {
    id: account.id,
    name: account.name,
    type: account.type,
    startingBalance: toSerializable(account.startingBalance) as string,
    createdAt: account.createdAt.toISOString(),
    balance: (starting + net).toFixed(2),
    statementDay: account.statementDay,
  };
};

export const listAccounts = async (userId: string): Promise<FrontendAccount[]> => {
  const accounts = await prisma.account.findMany({
    where: { userId },
    include: { transactions: { select: { amount: true, type: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return accounts.map(toFrontendAccount);
};

export const createAccount = async (
  userId: string,
  input: CreateAccountInput,
): Promise<FrontendAccount> => {
  const account = await prisma.account.create({
    data: {
      userId,
      name: input.name,
      type: input.type,
      startingBalance: input.startingBalance,
      statementDay: input.type === 'CREDIT_CARD' ? (input.statementDay ?? null) : null,
    },
    include: { transactions: { select: { amount: true, type: true } } },
  });
  return toFrontendAccount(account);
};

export const updateAccount = async (
  userId: string,
  accountId: string,
  input: UpdateAccountInput,
): Promise<FrontendAccount> => {
  const existing = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!existing) {
    throw new ServiceValidationError('Account not found');
  }

  const nextType = input.type ?? existing.type;
  if (nextType !== 'CREDIT_CARD' && input.statementDay) {
    throw new ServiceValidationError('statementDay only applies to credit card accounts');
  }

  const account = await prisma.account.update({
    where: { id: accountId },
    data: {
      ...input,
      statementDay: nextType === 'CREDIT_CARD' ? input.statementDay : input.type ? null : undefined,
    },
    include: { transactions: { select: { amount: true, type: true } } },
  });
  return toFrontendAccount(account);
};

export const deleteAccount = async (userId: string, accountId: string): Promise<void> => {
  const existing = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!existing) {
    throw new ServiceValidationError('Account not found');
  }
  await prisma.account.delete({ where: { id: accountId } });
};
