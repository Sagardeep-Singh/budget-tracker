import { NextResponse } from 'next/server';
import { getServerAuthSession } from '@/lib/auth/session';
import { importCategoryRulesSchema } from '@/lib/validators/category-rule-transfer';
import { previewCategoryRuleImport } from '@/lib/services/categoryRules';

export const POST = async (request: Request): Promise<NextResponse> => {
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = importCategoryRulesSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const rows = await previewCategoryRuleImport(session.user.id, parsed.data.rules);
  return NextResponse.json({ rows });
};
