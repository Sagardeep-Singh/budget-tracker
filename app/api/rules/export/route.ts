import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { exportCategoryRules } from '@/lib/services/categoryRules';

export const GET = async (): Promise<Response> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const rules = await exportCategoryRules(userId);
  const body = JSON.stringify({ rules }, null, 2);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="ledger-rules.json"',
    },
  });
};
