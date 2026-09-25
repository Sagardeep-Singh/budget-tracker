import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { updateCategoryRuleSchema } from '@/lib/validators/category-rules';
import { deleteCategoryRule, updateCategoryRule } from '@/lib/services/categoryRules';
import { ServiceValidationError } from '@/lib/services/common';

type RouteParams = { params: Promise<{ id: string }> };

export const PATCH = async (request: Request, { params }: RouteParams): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const { id } = await params;
  const parsed = updateCategoryRuleSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    return NextResponse.json(await updateCategoryRule(userId, id, parsed.data));
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
};

export const DELETE = async (_request: Request, { params }: RouteParams): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const { id } = await params;
  try {
    await deleteCategoryRule(userId, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
};
