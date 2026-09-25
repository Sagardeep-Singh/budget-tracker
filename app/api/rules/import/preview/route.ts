import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { importCategoryRulesSchema } from '@/lib/validators/category-rule-transfer';
import { previewCategoryRuleImport } from '@/lib/services/categoryRules';

export const POST = async (request: Request): Promise<NextResponse> => {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }

  const parsed = importCategoryRulesSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const rows = await previewCategoryRuleImport(userId, parsed.data.rules);
  return NextResponse.json({ rows });
};
