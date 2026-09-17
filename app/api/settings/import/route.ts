import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { MAX_IMPORT_BYTES, userDataFileSchema } from '@/lib/validators/user-data';
import { importUserData } from '@/lib/services/userData';
import { ServiceValidationError } from '@/lib/services/common';

export const maxDuration = 60;

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // A client can lie about or omit Content-Length, so it's a fast-path
  // rejection only — the real guard is the byte length re-check below.
  // `request.json()` parses before you can measure, so this route reads
  // `text()` first regardless of which check catches an oversized body.
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: `File is larger than the ${MAX_IMPORT_BYTES / (1024 * 1024)} MB import limit.` },
      { status: 413 },
    );
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: `File is larger than the ${MAX_IMPORT_BYTES / (1024 * 1024)} MB import limit.` },
      { status: 413 },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "That file isn't valid JSON." }, { status: 400 });
  }

  const parsed = userDataFileSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const result = await importUserData(session.user.id, parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};
