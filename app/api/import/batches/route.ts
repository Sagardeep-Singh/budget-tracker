import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { listImportBatchesQuerySchema } from '@/lib/validators/import-batches';
import { listImportBatches } from '@/lib/services/importBatches';

export const GET = async (request: Request): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const url = new URL(request.url);
  const parsed = listImportBatchesQuerySchema.safeParse({
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json(await listImportBatches(userId, parsed.data));
};
