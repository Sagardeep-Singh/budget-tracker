import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { listReimbursementCandidatesQuerySchema } from '@/lib/validators/reimbursements';
import { listReimbursementCandidates } from '@/lib/services/reimbursements';
import { ServiceValidationError } from '@/lib/services/common';

type RouteParams = { params: Promise<{ id: string }> };

export const GET = async (request: Request, { params }: RouteParams): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const url = new URL(request.url);
  const parsed = listReimbursementCandidatesQuerySchema.safeParse({
    search: url.searchParams.get('search') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    return NextResponse.json(await listReimbursementCandidates(session.user.id, id, parsed.data));
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
};
