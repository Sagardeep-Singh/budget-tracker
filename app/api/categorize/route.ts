import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/auth/session';
import { suggestCategoryId } from '@/lib/services/categorize';

const schema = z.object({ text: z.string() });

export const POST = async (request: Request): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const categoryId = await suggestCategoryId(userId, parsed.data.text);
  return NextResponse.json({ categoryId });
};
