import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { undoImportBatch } from '@/lib/services/importBatches';
import { BatchAlreadyUndoneError, ServiceValidationError } from '@/lib/services/common';

type RouteParams = { params: Promise<{ id: string }> };

// POST, not DELETE: the batch survives undo (decision 4), only its transactions
// are removed, so this is a state transition rather than a resource deletion.
export const POST = async (_request: Request, { params }: RouteParams): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    return NextResponse.json(await undoImportBatch(session.user.id, id));
  } catch (error) {
    if (error instanceof BatchAlreadyUndoneError) {
      return NextResponse.json({ code: 'ALREADY_UNDONE', error: error.message }, { status: 409 });
    }
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
};
