import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { previewImportSchema } from '@/lib/validators/csv-import';
import { previewImport } from '@/lib/services/csvImport';

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = previewImportSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const preview = await previewImport(session.user.id, parsed.data);
  return NextResponse.json(preview);
};
