import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { aiErrorToResponse } from '@/lib/ai/errors';
import { updateAiTogglesSchema } from '@/lib/validators/ai-settings';
import { updateAiToggles } from '@/lib/services/aiSettings';

export const runtime = 'nodejs';

/** Toggles only — the schema is `.strict()` and carries no key field, so a
 * toggle flip can never overwrite or re-submit the stored API key. */
export const PATCH = async (request: Request): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const parsed = updateAiTogglesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    return NextResponse.json(await updateAiToggles(userId, parsed.data));
  } catch (error) {
    const mapped = aiErrorToResponse(error);
    if (!mapped) {
      throw error;
    }
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
};
