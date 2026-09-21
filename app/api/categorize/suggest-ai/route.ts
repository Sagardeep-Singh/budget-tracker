import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { aiErrorToResponse } from '@/lib/ai/errors';
import { suggestWithAiSchema } from '@/lib/validators/categorize-ai';
import { suggestCategoryWithAi } from '@/lib/services/aiCategorize';

export const runtime = 'nodejs';

/**
 * A new path under the existing `app/api/categorize/` rather than a change to
 * `app/api/categorize/route.ts` — that handler's `{ text } → { categoryId }`
 * rule-matching contract is untouched.
 *
 * The body is one transaction id and nothing else: the service re-reads the
 * row scoped by `userId`, re-derives the categories and re-checks eligibility,
 * so the note/amount opt-in and the "unmatched rows only" rule stay
 * server-enforced.
 */
export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = suggestWithAiSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await suggestCategoryWithAi(session.user.id, parsed.data.transactionId),
    );
  } catch (error) {
    const mapped = aiErrorToResponse(error);
    if (!mapped) {
      throw error;
    }
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
};
