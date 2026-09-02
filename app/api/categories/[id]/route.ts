import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { updateCategorySchema } from '@/lib/validators/categories';
import { deleteCategory, updateCategory } from '@/lib/services/categories';
import { ServiceValidationError } from '@/lib/services/common';

type RouteParams = { params: Promise<{ id: string }> };

export const PATCH = async (request: Request, { params }: RouteParams): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const parsed = updateCategorySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    return NextResponse.json(await updateCategory(session.user.id, id, parsed.data));
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
    await deleteCategory(session.user.id, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
};
