import { z } from 'zod';

/**
 * The file shape export produces (and import's shape after parsing).
 * `categoryName`, not `categoryId` — ids aren't portable across
 * users/instances, names are. No schema here: export builds this directly
 * from the DB, nothing parses untrusted input into this shape.
 */
export type ExportedCategoryRule = { matchText: string; categoryName: string; priority: number };

/**
 * Deliberately lenient on category — a bad row (category not found) is
 * skipped with a reason, not a reason to reject the whole file; the service
 * does that per-row leniency. This layer only guards against structurally
 * malformed input (missing fields, wrong types, absurd sizes).
 */
export const importedCategoryRuleSchema = z.object({
  matchText: z.string().trim().min(1).max(80),
  categoryName: z.string().trim().min(1).max(60),
  priority: z.coerce.number().int().min(0).default(0),
});

export const importCategoryRulesSchema = z.object({
  rules: z.array(importedCategoryRuleSchema).min(1).max(2000),
});

export type ImportedCategoryRule = z.infer<typeof importedCategoryRuleSchema>;
export type ImportCategoryRulesInput = z.infer<typeof importCategoryRulesSchema>;
