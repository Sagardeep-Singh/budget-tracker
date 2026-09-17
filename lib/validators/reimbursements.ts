import { z } from 'zod';

export const createReimbursementLinkSchema = z.object({
  expenseTransactionId: z.string().min(1),
  incomeTransactionId: z.string().min(1),
  amount: z.coerce.number().positive(),
});

export const updateReimbursementLinkSchema = z.object({
  amount: z.coerce.number().positive(),
});

export const listReimbursementCandidatesQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(8),
});

export type CreateReimbursementLinkInput = z.infer<typeof createReimbursementLinkSchema>;
export type UpdateReimbursementLinkInput = z.infer<typeof updateReimbursementLinkSchema>;
export type ListReimbursementCandidatesQuery = z.infer<
  typeof listReimbursementCandidatesQuerySchema
>;
