import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sendDueReminders } from '@/lib/services/reminders';

/**
 * Constant-time compare with no length-revealing shortcut. Both sides are hashed
 * to a fixed 32 bytes first, which is what lets `timingSafeEqual` — it throws on
 * mismatched lengths — compare secrets of any length without an early return.
 */
const secretMatches = (provided: string, expected: string): boolean =>
  timingSafeEqual(
    createHash('sha256').update(provided).digest(),
    createHash('sha256').update(expected).digest(),
  );

/**
 * Called by Vercel Cron (see `vercel.json`), which sends
 * `Authorization: Bearer $CRON_SECRET`. There is no session here, so the secret is
 * the only gate — an unset secret fails closed with a 500 rather than leaving an
 * unauthenticated endpoint that can spam every user's devices.
 */
export const GET = async (request: Request): Promise<NextResponse> => {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'Cron is not configured' }, { status: 500 });
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const summary = await sendDueReminders(new Date());
  return NextResponse.json(summary);
};
