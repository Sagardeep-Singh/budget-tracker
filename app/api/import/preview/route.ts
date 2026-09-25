import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { previewImportSchema } from '@/lib/validators/csv-import';
import { previewImport } from '@/lib/services/csvImport';

export const POST = async (request: Request): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const parsed = previewImportSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const preview = await previewImport(userId, parsed.data);
  return NextResponse.json(preview);
};
