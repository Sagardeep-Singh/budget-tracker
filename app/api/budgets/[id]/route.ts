import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { updateBudgetSchema } from '@/lib/validators/budgets';
import { deleteBudget, updateBudget } from '@/lib/services/budgets';
import { ServiceValidationError } from '@/lib/services/common';

type RouteParams = { params: Promise<{ id: string }> };

export const PATCH = async (request: Request, { params }: RouteParams): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const parsed = updateBudgetSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await updateBudget(session.user.id, id, parsed.data);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
};

export const DELETE = async (_request: Request, { params }: RouteParams): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    await deleteBudget(session.user.id, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
};
