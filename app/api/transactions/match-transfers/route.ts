import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { matchTransfers } from '@/lib/services/transfers';

export const POST = async (): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json(await matchTransfers(session.user.id));
};
