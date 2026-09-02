import { z } from 'zod';

export const createCategoryRuleSchema = z.object({
  categoryId: z.string().min(1),
  matchText: z.string().trim().min(1).max(80),
  priority: z.coerce.number().int().default(0),
});

export const updateCategoryRuleSchema = createCategoryRuleSchema.partial();

export type CreateCategoryRuleInput = z.infer<typeof createCategoryRuleSchema>;
export type UpdateCategoryRuleInput = z.infer<typeof updateCategoryRuleSchema>;
