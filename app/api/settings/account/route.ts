import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { deleteAccountSchema } from '@/lib/validators/account-deletion';
import { deleteUserAccount } from '@/lib/services/accountDeletion';
import { GoogleReauthRequiredError, ServiceValidationError } from '@/lib/services/common';

export const DELETE = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = deleteAccountSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    // Read from the session, never the request body — a client-supplied
    // "I reauthenticated" flag would be trivially spoofable; the signed JWT
    // is not.
    const result = await deleteUserAccount(
      session.user.id,
      parsed.data,
      session.user.reauthenticatedAt,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GoogleReauthRequiredError) {
      return NextResponse.json(
        { error: error.message, requiresGoogleReauth: true },
        { status: 428 },
      );
    }
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};
