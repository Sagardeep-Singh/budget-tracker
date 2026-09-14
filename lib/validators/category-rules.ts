import { z } from 'zod';

/** `/pattern/flags` — same shape lib/services/categorize.ts matches against. */
const REGEX_RULE = /^\/(.+)\/([gimsuy]*)$/;

/**
 * Crude catastrophic-backtracking heuristic: a quantified group that is
 * itself quantified (e.g. `(a+)+`, `(a*)+`, `(a|a)*`) is the classic ReDoS
 * shape. This app runs on shared Vercel Fluid Compute instances, so one
 * user's pathological rule could stall requests from other users on the
 * same instance — worth rejecting up front even though it can't catch every
 * case. Not a substitute for a linear-time engine, just a cheap tripwire.
 */
const REDOS_SHAPE = /\([^)]*[+*][^)]*\)[+*]/;

/**
 * Returns an error message if a `/.../`-shaped matchText doesn't compile as
 * a regex (or looks like catastrophic backtracking), else null. Shared by
 * this schema's superRefine (single create/update — reject with a clear
 * message) and the bulk-import service (per-row skip+reason, rather than
 * rejecting the whole file).
 */
export const invalidRuleRegexError = (matchText: string): string | null => {
  const parsed = REGEX_RULE.exec(matchText);
  if (!parsed) return null;
  if (REDOS_SHAPE.test(parsed[1])) {
    return 'Invalid regular expression: nested quantifiers like (a+)+ can hang matching and are not allowed';
  }
  try {
    new RegExp(parsed[1], parsed[2]);
    return null;
  } catch (error) {
    return `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`;
  }
};

const matchTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .superRefine((value, ctx) => {
    const message = invalidRuleRegexError(value);
    if (message) ctx.addIssue({ code: 'custom', message });
  });

export const createCategoryRuleSchema = z.object({
  categoryId: z.string().min(1),
  matchText: matchTextSchema,
  priority: z.coerce.number().int().min(0).default(0),
});

export const updateCategoryRuleSchema = createCategoryRuleSchema.partial();

export type CreateCategoryRuleInput = z.infer<typeof createCategoryRuleSchema>;
export type UpdateCategoryRuleInput = z.infer<typeof updateCategoryRuleSchema>;
