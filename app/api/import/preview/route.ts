import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerAuthSession } from '@/lib/auth/session';
import { previewImport } from '@/lib/services/csvImport';

const rawRowSchema = z.object({
  accountId: z.string().min(1),
  date: z.string().min(1),
  amount: z.coerce.number(),
  type: z.enum(['INCOME', 'EXPENSE']),
  payee: z.string().trim().max(120).optional(),
  note: z.string().trim().max(280).optional(),
});

const previewSchema = z.object({ rows: z.array(rawRowSchema).min(1).max(2000) });

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = previewSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const preview = await previewImport(session.user.id, parsed.data.rows);
  return NextResponse.json(preview);
};
