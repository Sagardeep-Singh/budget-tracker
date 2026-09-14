import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { listImportBatchesQuerySchema } from '@/lib/validators/import-batches';
import { listImportBatches } from '@/lib/services/importBatches';

export const GET = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const parsed = listImportBatchesQuerySchema.safeParse({
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json(await listImportBatches(session.user.id, parsed.data));
};
