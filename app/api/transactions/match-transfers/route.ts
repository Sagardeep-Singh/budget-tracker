import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { matchTransfersRequestSchema } from '@/lib/validators/transfers';
import { matchTransfers } from '@/lib/services/transfers';

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // no body at all (a bodiless POST) is a valid "scan everything" request; only a
  // present-but-malformed body is a 400
  const raw = await request.text();
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = matchTransfersRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { from, to } = parsed.data;
  const dateRange = from && to ? { from, to } : undefined;
  return NextResponse.json(await matchTransfers(session.user.id, dateRange));
};
