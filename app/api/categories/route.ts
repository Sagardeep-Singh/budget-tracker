import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { createCategorySchema } from '@/lib/validators/categories';
import { createCategory, listCategories } from '@/lib/services/categories';
import { ServiceValidationError } from '@/lib/services/common';

export const GET = async (): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  return NextResponse.json(await listCategories(userId));
};

export const POST = async (request: Request): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const parsed = createCategorySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const category = await createCategory(userId, parsed.data);
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};
