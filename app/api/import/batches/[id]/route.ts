import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { getImportBatch } from '@/lib/services/importBatches';
import { ServiceValidationError } from '@/lib/services/common';

type RouteParams = { params: Promise<{ id: string }> };

export const GET = async (_request: Request, { params }: RouteParams): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    return NextResponse.json(await getImportBatch(session.user.id, id));
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
};
