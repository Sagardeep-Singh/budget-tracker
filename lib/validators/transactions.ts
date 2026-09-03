import { z } from 'zod';

export const transactionTypeSchema = z.enum(['INCOME', 'EXPENSE']);

export const createTransactionSchema = z.object({
  accountId: z.string().min(1),
  categoryId: z.string().min(1).nullable().optional(),
  amount: z.coerce.number().positive(),
  type: transactionTypeSchema,
  date: z.coerce.date(),
  payee: z.string().trim().max(120).optional(),
  note: z.string().trim().max(280).optional(),
  isPayment: z.coerce.boolean().default(false),
});

export const updateTransactionSchema = createTransactionSchema.partial();

export const listTransactionsQuerySchema = z.object({
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
