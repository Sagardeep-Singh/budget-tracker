import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { changePasswordSchema } from '@/lib/validators/password';
import { changePassword } from '@/lib/services/password';
import { ServiceValidationError } from '@/lib/services/common';

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = changePasswordSchema.safeParse(await request.json());
  if (!parsed.success) {
    // A single string, not flatten(): the client renders this message verbatim.
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    await changePassword(session.user.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};
