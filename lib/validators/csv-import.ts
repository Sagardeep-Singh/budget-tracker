import { z } from 'zod';

export const importRowSchema = z.object({
  accountId: z.string().min(1),
  date: z.coerce.date(),
  amount: z.coerce.number(),
  type: z.enum(['INCOME', 'EXPENSE']),
  payee: z.string().trim().max(120).optional(),
  note: z.string().trim().max(280).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  include: z.boolean().default(true),
});

export const commitImportSchema = z.object({
  rows: z.array(importRowSchema).min(1),
});

export type ImportRowInput = z.infer<typeof importRowSchema>;
export type CommitImportInput = z.infer<typeof commitImportSchema>;
