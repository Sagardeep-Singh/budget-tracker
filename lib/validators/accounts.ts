import { z } from 'zod';

export const accountTypeSchema = z.enum(['CHECKING', 'SAVINGS', 'CREDIT_CARD', 'CASH']);

export const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: accountTypeSchema,
  startingBalance: z.coerce.number().finite().default(0),
});

export const updateAccountSchema = createAccountSchema.partial();

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
