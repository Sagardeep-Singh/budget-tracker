import { z } from 'zod';

export const transactionTypeSchema = z.enum(['INCOME', 'EXPENSE']);

const transactionFieldsSchema = z.object({
  accountId: z.string().min(1),
  categoryId: z.string().min(1).nullable().optional(),
  amount: z.coerce.number().positive(),
  type: transactionTypeSchema,
  date: z.coerce.date(),
  payee: z.string().trim().max(120).optional(),
  note: z.string().trim().max(280).optional(),
  isPayment: z.coerce.boolean().default(false),
  isTransfer: z.coerce.boolean().default(false),
  isReimbursable: z.coerce.boolean().default(false),
  reimbursementExpectedAmount: z.coerce.number().positive().nullable().optional(),
  reimbursementCompleted: z.coerce.boolean().optional(),
});

/**
 * Cross-field checks that are self-contained within one payload — no DB state.
 * Applied identically to create and update (the latter over a fully partial
 * shape), so every check below tolerates any of its fields being `undefined`.
 * Everything that depends on existing DB state (current linked totals, the
 * expense's amount on a partial PATCH) is enforced in the service instead.
 */
const refineReimbursable = (
  v: {
    type?: 'INCOME' | 'EXPENSE';
    amount?: number;
    isTransfer?: boolean;
    isPayment?: boolean;
    isReimbursable?: boolean;
    reimbursementExpectedAmount?: number | null;
    reimbursementCompleted?: boolean;
  },
  ctx: z.RefinementCtx,
): void => {
  if (v.isReimbursable === true) {
    if (v.type !== undefined && v.type !== 'EXPENSE') {
      ctx.addIssue({
        code: 'custom',
        path: ['isReimbursable'],
        message: 'Only an expense can be reimbursable',
      });
    }
    if (v.isTransfer === true) {
      ctx.addIssue({
        code: 'custom',
        path: ['isReimbursable'],
        message: 'A reimbursable expense cannot also be a transfer',
      });
    }
    if (v.isPayment === true) {
      ctx.addIssue({
        code: 'custom',
        path: ['isReimbursable'],
        message: 'A reimbursable expense cannot also be a card payment',
      });
    }
    if (v.reimbursementExpectedAmount == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['reimbursementExpectedAmount'],
        message: 'Expected reimbursement amount is required',
      });
    } else if (v.amount !== undefined && v.reimbursementExpectedAmount > v.amount) {
      ctx.addIssue({
        code: 'custom',
        path: ['reimbursementExpectedAmount'],
        message: 'The expected reimbursement cannot exceed the expense amount',
      });
    }
  } else if (v.isReimbursable === false && v.reimbursementExpectedAmount != null) {
    ctx.addIssue({
      code: 'custom',
      path: ['reimbursementExpectedAmount'],
      message: 'A non-reimbursable expense cannot have an expected reimbursement amount',
    });
  }

  if (v.reimbursementCompleted === true && v.isReimbursable === false) {
    ctx.addIssue({
      code: 'custom',
      path: ['reimbursementCompleted'],
      message: 'Only a reimbursable expense can be marked fully reimbursed',
    });
  }
};

export const createTransactionSchema = transactionFieldsSchema.superRefine(refineReimbursable);
export const updateTransactionSchema = transactionFieldsSchema
  .partial()
  .superRefine(refineReimbursable);

export const listTransactionsQuerySchema = z.object({
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  batchId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
