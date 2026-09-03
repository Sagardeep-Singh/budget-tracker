import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { createCategorySchema } from '@/lib/validators/categories';
import { createCategory, listCategories } from '@/lib/services/categories';
import { ServiceValidationError } from '@/lib/services/common';

export const GET = async (): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json(await listCategories(session.user.id));
};

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = createCategorySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const category = await createCategory(session.user.id, parsed.data);
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};
