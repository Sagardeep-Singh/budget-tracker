import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session';
import { resendVerificationEmail } from '@/lib/services/emailVerification';

export const POST = async (): Promise<NextResponse> => {
  const session = await requireSession();
  if (session instanceof NextResponse) {
    return session;
  }

  const result = await resendVerificationEmail(session.user.id, session.user.email ?? '');
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Please wait before requesting another email.', retryAfterMs: result.retryAfterMs },
      { status: 429 },
    );
  }
  return NextResponse.json({ ok: true });
};
