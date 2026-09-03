import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { createAccountSchema } from '@/lib/validators/accounts';
import { createAccount, listAccounts } from '@/lib/services/accounts';
import { ServiceValidationError } from '@/lib/services/common';

export const GET = async (): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accounts = await listAccounts(session.user.id);
  return NextResponse.json(accounts);
};

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = createAccountSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const account = await createAccount(session.user.id, parsed.data);
    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};
