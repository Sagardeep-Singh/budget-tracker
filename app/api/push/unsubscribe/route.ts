import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { unsubscribePushSchema } from '@/lib/validators/push';
import { deletePushSubscription } from '@/lib/services/pushSubscriptions';

/**
 * POST, not DELETE: the endpoint URL belongs in a body rather than a path segment,
 * matching the existing precedent of `transactions/[id]/skip`.
 */
export const POST = async (request: Request): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const parsed = unsubscribePushSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const result = await deletePushSubscription(userId, parsed.data.endpoint);
  return NextResponse.json(result);
};
