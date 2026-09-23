import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { aiErrorToResponse } from '@/lib/ai/errors';
import { updateAiModelSchema } from '@/lib/validators/ai-settings';
import { updateAiModel } from '@/lib/services/aiSettings';

export const runtime = 'nodejs';

/** Model id only — the schema is `.strict()` and carries no key field, so
 * picking a model can never overwrite or re-submit the stored API key, and the
 * service makes no provider call: changing the model is not a re-verification. */
export const PATCH = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = updateAiModelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    return NextResponse.json(await updateAiModel(session.user.id, parsed.data));
  } catch (error) {
    const mapped = aiErrorToResponse(error);
    if (!mapped) {
      throw error;
    }
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
};
