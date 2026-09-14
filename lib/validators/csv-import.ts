import { z } from 'zod';

/** stored raw for display, normalized (trim + lowercase) for duplicate matching */
export const importFilenameSchema = z.string().trim().min(1).max(255);

/** a row straight off the client-side CSV parse, before preview enriches it */
export const rawImportRowSchema = z.object({
  accountId: z.string().min(1),
  date: z.string().min(1),
  amount: z.coerce.number(),
  type: z.enum(['INCOME', 'EXPENSE']),
  payee: z.string().trim().max(120).optional(),
  note: z.string().trim().max(280).optional(),
});

export const previewImportSchema = z.object({
  accountId: z.string().min(1),
  filename: importFilenameSchema,
  rows: z.array(rawImportRowSchema).min(1).max(2000),
});

export const importRowSchema = z.object({
  accountId: z.string().min(1),
  date: z.coerce.date(),
  amount: z.coerce.number(),
  type: z.enum(['INCOME', 'EXPENSE']),
  payee: z.string().trim().max(120).optional(),
  note: z.string().trim().max(280).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  include: z.boolean().default(true),
  /**
   * Client echo of the preview-time duplicate flag. `include: true` together with
   * `duplicate: true` is the user's explicit "import it anyway" override; an absent
   * flag must read as "was not flagged at preview" so stale-preview protection still
   * applies — hence `.default(false)`, not `.optional()`. Fail safe, not fail open.
   */
  duplicate: z.boolean().default(false),
});

export const commitImportSchema = z
  .object({
    accountId: z.string().min(1),
    filename: importFilenameSchema,
    rows: z.array(importRowSchema).min(1).max(2000),
    overrideDuplicateFilename: z.boolean().default(false),
  })
  .refine((input) => input.rows.every((row) => row.accountId === input.accountId), {
    message: 'All rows must belong to the selected account',
    path: ['rows'],
  });

export type RawImportRowInput = z.infer<typeof rawImportRowSchema>;
export type PreviewImportInput = z.infer<typeof previewImportSchema>;
export type ImportRowInput = z.infer<typeof importRowSchema>;
export type CommitImportInput = z.infer<typeof commitImportSchema>;
