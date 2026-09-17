import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { savePushSubscriptionSchema } from '@/lib/validators/push';
import { savePushSubscription } from '@/lib/services/pushSubscriptions';

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = savePushSubscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const subscription = await savePushSubscription(
    session.user.id,
    parsed.data,
    request.headers.get('user-agent'),
  );
  return NextResponse.json(subscription, { status: 201 });
};
