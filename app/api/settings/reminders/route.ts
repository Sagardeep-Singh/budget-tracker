import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { updateReminderPreferenceSchema } from '@/lib/validators/reminders';
import { updateReminderPreference } from '@/lib/services/reminders';

export const PATCH = async (request: Request): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const parsed = updateReminderPreferenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const preference = await updateReminderPreference(userId, parsed.data);
  return NextResponse.json(preference);
};
