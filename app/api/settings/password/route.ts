import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { changePasswordSchema } from '@/lib/validators/password';
import { changePassword } from '@/lib/services/password';
import { ServiceValidationError } from '@/lib/services/common';

export const POST = async (request: Request): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const parsed = changePasswordSchema.safeParse(await request.json());
  if (!parsed.success) {
    // A single string, not flatten(): the client renders this message verbatim.
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    await changePassword(userId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};
