import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import {
  createTransactionSchema,
  listTransactionsQuerySchema,
} from '@/lib/validators/transactions';
import { createTransaction, listTransactions } from '@/lib/services/transactions';
import { ServiceValidationError } from '@/lib/services/common';

export const GET = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const parsed = listTransactionsQuerySchema.safeParse({
    accountId: url.searchParams.get('accountId') ?? undefined,
    categoryId: url.searchParams.get('categoryId') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json(await listTransactions(session.user.id, parsed.data));
};

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = createTransactionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const transaction = await createTransaction(session.user.id, parsed.data);
    return NextResponse.json(transaction, { status: 201 });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};
