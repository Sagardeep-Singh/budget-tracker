import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { commitImportSchema } from '@/lib/validators/csv-import';
import { commitImport } from '@/lib/services/csvImport';
import { ServiceValidationError } from '@/lib/services/common';

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = commitImportSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await commitImport(session.user.id, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};
