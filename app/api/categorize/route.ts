import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerAuthSession } from '@/lib/auth/session';
import { suggestCategoryId } from '@/lib/services/categorize';

const schema = z.object({ text: z.string() });

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const categoryId = await suggestCategoryId(session.user.id, parsed.data.text);
  return NextResponse.json({ categoryId });
};
