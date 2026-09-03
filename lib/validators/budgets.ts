import { z } from 'zod';

export const createBudgetSchema = z.object({
  categoryId: z.string().min(1),
  month: z.coerce.number().int().min(190001).max(299912),
  limitAmount: z.coerce.number().positive(),
});

export const updateBudgetSchema = z.object({
  limitAmount: z.coerce.number().positive(),
});

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
