import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { createReimbursementLinkSchema } from '@/lib/validators/reimbursements';
import { createReimbursementLink } from '@/lib/services/reimbursements';
import { ReimbursementConflictError, ServiceValidationError } from '@/lib/services/common';

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = createReimbursementLinkSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const summary = await createReimbursementLink(session.user.id, parsed.data);
    return NextResponse.json(summary, { status: 201 });
  } catch (error) {
    if (error instanceof ReimbursementConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};
