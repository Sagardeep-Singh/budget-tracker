import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { undoImportBatch } from '@/lib/services/importBatches';
import {
  BatchAlreadyUndoneError,
  ReimbursementConflictError,
  ServiceValidationError,
} from '@/lib/services/common';

type RouteParams = { params: Promise<{ id: string }> };

// POST, not DELETE: the batch survives undo (decision 4), only its transactions
// are removed, so this is a state transition rather than a resource deletion.
export const POST = async (_request: Request, { params }: RouteParams): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const { id } = await params;
  try {
    return NextResponse.json(await undoImportBatch(userId, id));
  } catch (error) {
    if (error instanceof BatchAlreadyUndoneError) {
      return NextResponse.json({ code: 'ALREADY_UNDONE', error: error.message }, { status: 409 });
    }
    if (error instanceof ReimbursementConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
};
