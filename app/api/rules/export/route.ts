import { getServerAuthSession } from '@/lib/auth/session';
import { exportCategoryRules } from '@/lib/services/categoryRules';

export const GET = async (): Promise<Response> => {
  const session = await getServerAuthSession();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const rules = await exportCategoryRules(session.user.id);
  const body = JSON.stringify({ rules }, null, 2);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="ledger-rules.json"',
    },
  });
};
