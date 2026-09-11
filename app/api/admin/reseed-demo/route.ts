import { NextResponse } from 'next/server';
import { seedDemoData } from '@/prisma/demo-seed';

/**
 * Triggered by Vercel Cron (see vercel.json) to periodically refresh the
 * demo account with a large, deterministic dataset. Vercel Cron only
 * issues GET requests, and automatically sends `Authorization: Bearer
 * $CRON_SECRET` on invocations it makes when CRON_SECRET is set as a
 * project env var — that's the only auth this route checks.
 *
 * Never touches real user data: seedDemoData scopes every write to one
 * fixed demo user (DEMO_EMAIL), looked up/created via upsert, and every
 * delete is `where: { userId }` against that same user — there is no
 * global deleteMany here or in seedDemoData.
 *
 * Gated on DEMO_ENABLED=true so the demo can be turned off without
 * removing CRON_SECRET or the cron schedule itself — the cron still
 * fires, this just no-ops instead of erroring, so it never pages anyone.
 */
export const GET = async (request: Request): Promise<NextResponse> => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.DEMO_ENABLED !== 'true') {
    return NextResponse.json({ ok: false, skipped: true, reason: 'DEMO_ENABLED is not true' });
  }

  const result = await seedDemoData();
  return NextResponse.json({ ok: true, ...result });
};
