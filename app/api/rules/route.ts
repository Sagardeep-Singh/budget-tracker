import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { createCategoryRuleSchema } from '@/lib/validators/category-rules';
import { createCategoryRule, listCategoryRules } from '@/lib/services/categoryRules';
import { ServiceValidationError } from '@/lib/services/common';

export const GET = async (): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  return NextResponse.json(await listCategoryRules(userId));
};

export const POST = async (request: Request): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const parsed = createCategoryRuleSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const rule = await createCategoryRule(userId, parsed.data);
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};
