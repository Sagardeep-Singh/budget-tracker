import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { updateReminderPreferenceSchema } from '@/lib/validators/reminders';
import { updateReminderPreference } from '@/lib/services/reminders';

export const PATCH = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = updateReminderPreferenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const preference = await updateReminderPreference(session.user.id, parsed.data);
  return NextResponse.json(preference);
};
