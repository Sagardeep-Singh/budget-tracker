import { getServerAuthSession } from '@/lib/auth/session';
import { exportUserData } from '@/lib/services/userData';

export const maxDuration = 60;

export const GET = async (): Promise<Response> => {
  const session = await getServerAuthSession();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const file = await exportUserData(session.user.id);
  const filename = `ledger-data-${new Date().toISOString().slice(0, 10)}.json`;

  return new Response(JSON.stringify(file, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
};
