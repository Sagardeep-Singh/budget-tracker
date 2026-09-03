import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { createBudgetSchema } from '@/lib/validators/budgets';
import { createBudget, listBudgets } from '@/lib/services/budgets';
import { ServiceValidationError } from '@/lib/services/common';

const currentMonth = (): number => {
  const now = new Date();
  return now.getUTCFullYear() * 100 + (now.getUTCMonth() + 1);
};

export const GET = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const monthParam = url.searchParams.get('month');
  const month = monthParam ? Number(monthParam) : currentMonth();

  return NextResponse.json(await listBudgets(session.user.id, month));
};

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = createBudgetSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const budget = await createBudget(session.user.id, parsed.data);
    return NextResponse.json(budget, { status: 201 });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};
