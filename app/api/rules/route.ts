import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { createCategoryRuleSchema } from '@/lib/validators/category-rules';
import { createCategoryRule, listCategoryRules } from '@/lib/services/categoryRules';
import { ServiceValidationError } from '@/lib/services/common';

export const GET = async (): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json(await listCategoryRules(session.user.id));
};

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = createCategoryRuleSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const rule = await createCategoryRule(session.user.id, parsed.data);
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};
