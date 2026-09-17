import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { unsubscribePushSchema } from '@/lib/validators/push';
import { deletePushSubscription } from '@/lib/services/pushSubscriptions';

/**
 * POST, not DELETE: the endpoint URL belongs in a body rather than a path segment,
 * matching the existing precedent of `transactions/[id]/skip`.
 */
export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = unsubscribePushSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const result = await deletePushSubscription(session.user.id, parsed.data.endpoint);
  return NextResponse.json(result);
};
