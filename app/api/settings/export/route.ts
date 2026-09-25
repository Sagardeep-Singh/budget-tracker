import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { exportUserData } from '@/lib/services/userData';

export const maxDuration = 60;

export const GET = async (): Promise<Response> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const file = await exportUserData(userId);
  const filename = `ledger-data-${new Date().toISOString().slice(0, 10)}.json`;

  return new Response(JSON.stringify(file, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
};
