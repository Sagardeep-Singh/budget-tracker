import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { aiErrorToResponse } from '@/lib/ai/errors';
import { getAiDisclosurePreview } from '@/lib/services/aiCategorize';
import { acceptAiDisclosure } from '@/lib/services/aiSettings';

export const runtime = 'nodejs';

/** The preview the user reviews before accepting — gated on nothing but the
 * session, since it is what they read *before* there is an acceptance. */
export const GET = async (): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await getAiDisclosurePreview(session.user.id));
};

export const POST = async (): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json(await acceptAiDisclosure(session.user.id));
  } catch (error) {
    const mapped = aiErrorToResponse(error);
    if (!mapped) {
      throw error;
    }
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
};
