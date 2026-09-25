import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { Session } from 'next-auth';

export const getServerAuthSession = () => auth();

const unauthorized = (): NextResponse =>
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

/**
 * For the handful of routes that need more than `session.user.id` (e.g. an
 * auth-provider timestamp) without re-deriving the 401 branch by hand.
 */
export const requireSession = async (): Promise<Session | NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return unauthorized();
  }
  return session;
};

export const requireUserId = async (): Promise<string | NextResponse> => {
  const session = await requireSession();
  if (session instanceof NextResponse) {
    return session;
  }
  return session.user.id;
};
