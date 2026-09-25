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

const csvIds = z
  .string()
  .optional()
  .catch(undefined)
  .transform((v) =>
    v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );

const lenientFlag = z
  .enum(['true', 'false'])
  .catch('false')
  .transform((v) => v === 'true');

/**
 * `GET /api/transactions?paginated=1` — the Transactions page's paginated read.
 * Additive alongside {@link listTransactionsQuerySchema}, which is untouched.
 *
 * The desktop filter fields and the two mobile fields are LENIENT: each ends in
 * `.catch(<default>)` so a hand-edited or stale bookmark degrades to "no
 * filter" instead of a 400 — the same contract `parseTransactionFilters`
 * documents for the URL. `limit` and `cursor` are STRICT: our own client
 * generates them, so a malformed value is a bug worth surfacing as a 400.
 * `periodStart`/`periodEnd` are client-computed from `lib/statement.ts` (never
 * in a bookmarkable URL) and must arrive together, start before end.
 */
export const transactionsPageQuerySchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish()
      .catch(null),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish()
      .catch(null),
    accountIds: csvIds,
    categoryIds: csvIds,
    payee: z.string().max(120).catch(''),
    type: transactionTypeSchema.nullish().catch(null),
    amountMin: z.string().nullish().catch(null),
    amountMax: z.string().nullish().catch(null),
    hideTransfers: lenientFlag,
    hidePayments: lenientFlag,
    uncategorizedOnly: lenientFlag,
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date().optional(),
    mobileSearch: z.string().max(120).catch(''),
    quickFilter: z.enum(['all', 'uncategorized', 'spending', 'income']).catch('all'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(200).optional(),
  })
  .refine((v) => (v.periodStart === undefined) === (v.periodEnd === undefined), {
    message: 'periodStart and periodEnd must be provided together',
    path: ['periodStart'],
  })
  .refine((v) => !v.periodStart || !v.periodEnd || v.periodStart < v.periodEnd, {
    message: 'periodStart must be before periodEnd',
    path: ['periodEnd'],
  });

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
export type TransactionsPageQuery = z.infer<typeof transactionsPageQuerySchema>;
