import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { aiErrorToResponse } from '@/lib/ai/errors';
import { saveAiSettingsSchema } from '@/lib/validators/ai-settings';
import { getAiSettings, removeAiSettings, saveAiSettings } from '@/lib/services/aiSettings';

// node:crypto (AES-256-GCM key encryption) is not edge-safe.
export const runtime = 'nodejs';

export const GET = async (): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  return NextResponse.json(await getAiSettings(userId));
};

export const PUT = async (request: Request): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const parsed = saveAiSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    return NextResponse.json(await saveAiSettings(userId, parsed.data));
  } catch (error) {
    const mapped = aiErrorToResponse(error);
    if (!mapped) {
      throw error;
    }
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
};

export const DELETE = async (): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  return NextResponse.json(await removeAiSettings(userId));
};
