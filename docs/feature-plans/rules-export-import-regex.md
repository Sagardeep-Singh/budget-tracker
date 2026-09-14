# Category rules: export/import + regex matchText

## Goal

Let a user back up / move their category rules between accounts (export as
a file, import it back), and let a rule's `matchText` be a regular
expression instead of only a plain substring, when written as a `/.../`
literal.

## Decisions

1. **Regex syntax**: `matchText` is treated as a regex when it matches
   `/^\/(.+)\/([gimsuy]*)$/` — a leading `/`, a body, a trailing `/`,
   optional trailing flag letters restricted to real JS regex flags
   (standard JS regex-literal shape: `/pattern/flags`). Restricting the
   flag group (rather than any `[a-z]*`) keeps a literal like `/home/user`
   from back-matching as body `home` + bogus flags `user`. Anything else is
   the existing plain substring match, unchanged.
2. **Case sensitivity differs by design.** Plain substring match stays
   case-insensitive (existing behavior, unchanged). Regex mode respects
   flags **exactly as written** — `/foo/` is case-sensitive unless the
   rule includes `i`. This is the standard, least-surprising behavior for
   anyone deliberately opting into regex syntax; forcing an implicit `i`
   would be a silent, undocumented deviation from what the pattern says.
3. **Invalid regex is rejected at write time** (create/update a single
   rule, via the Zod schema — immediate feedback), but **matching itself
   never throws**: `compileRuleMatcher` catches a bad pattern and falls
   back to literal substring matching, as defense-in-depth against any
   rule that predates this validation or slips through some other path.
4. **Import is per-row lenient, not all-or-nothing.** A batch import skips
   individual bad rows (category name not found for this user, or an
   invalid regex) and reports why, rather than rejecting the whole file
   for one bad row — matches the existing CSV transaction import's
   "best effort, report the skip count" pattern. Only structurally
   malformed input (missing fields, wrong types) 400s the whole request.
5. **Export format is JSON**, `{ rules: [{ matchText, categoryName,
priority }] }` — `categoryName`, not `categoryId`: ids aren't portable
   across users/instances, names are. Priority is preserved as an absolute
   number, not renumbered.
6. **Import matches by category name, case-insensitive, against the
   importing user's own existing categories.** Does not auto-create
   missing categories — creating categories as a side effect of a rules
   import would be a surprising, hard-to-undo action; the user creates
   the category first if it's genuinely missing, then re-imports.
7. **Duplicate rules are skipped, not duplicated**, on re-import: a row
   whose `(categoryId, matchText)` already exists for the user is skipped
   with reason `"already exists"` — makes re-running an import idempotent.
8. `matchText` max length raised from 80 to 300 (a rule schema shared by
   create/update/import) — a realistic regex can exceed 80 chars; 300 is
   generous without being unbounded.

## Known risk: ReDoS

Custom regex from a user is inherently a catastrophic-backtracking risk
(`/(a+)+$/` against a non-matching string never returns). This app runs
multi-tenant on shared Vercel Fluid Compute instances, so one user's
pathological rule can stall requests from _other_ users sharing that
instance, not just their own. Mitigations in this pass:

- `invalidRuleRegexError` rejects the classic nested-quantifier shape
  (`(x+)+`, `(x*)+`, etc.) at create/update/import time.
- This is a heuristic, not a real fix — it doesn't catch every
  catastrophic-backtracking pattern, and Node's `RegExp` has no built-in
  execution timeout. A determined user can still construct a pathological
  pattern that slips past the heuristic.
- A real fix (worker-thread timeout, or swapping `new RegExp` for a
  linear-time engine like `re2`) is out of scope for this pass and should
  be a follow-up if this app grows beyond a small trusted user base.

## Non-goals

- CSV export/import (JSON only — rules aren't tabular in the way
  transactions are, and this is a config/backup format, not something
  meant to be edited in a spreadsheet).
- Regex testing/preview UI (e.g. "try this pattern against sample text")
  — out of scope for this pass.
- Cross-user or cross-instance rule sharing/marketplace.
- Conflict resolution UI for duplicate/skipped rows beyond a summary count
  - reasons — no per-row accept/reject step.

## What was built

- `lib/services/categorize.ts`: `compileRuleMatcher(matchText)` — regex vs.
  literal detection + safe fallback. `matchCategoryRule`, the
  `getCategorizeQueue` inline matcher, and `categoryRules.ts`'s
  `appliedCount` all now go through it (previously three copies of the
  same `haystack.toLowerCase().includes(...)` logic, now one place that
  also knows about regex). These three sites also switched from a
  pre-lowered haystack to the raw text — pre-lowering broke case-sensitive
  regex matching.
- `lib/validators/category-rules.ts`: `matchText` max raised to 300;
  `createCategoryRuleSchema`/`updateCategoryRuleSchema` gain a
  `.superRefine` that compiles a `/.../`-shaped `matchText` and reports a
  clear "Invalid regular expression" error if it doesn't compile.
- `lib/validators/category-rule-transfer.ts` (new): lenient
  `importCategoryRulesSchema` (no regex-validity check at this layer —
  the service handles that per-row) and the `ExportedCategoryRule` type
  for the file shape export produces.
- `lib/services/categoryRules.ts`: `exportCategoryRules(userId)` and
  `importCategoryRules(userId, rows)` — returns
  `{ imported: number; skipped: { matchText: string; reason: string }[] }`.
- Routes: `GET /api/rules/export` (streams the JSON with a
  `Content-Disposition: attachment` header so the browser downloads it
  directly — no client-side blob juggling), `POST /api/rules/import`.
- `components/rules/rules-view.tsx`: Export button (plain link to the GET
  route) and Import button (file picker → parse JSON client-side → POST →
  show a summary of imported/skipped counts with reasons).

## Checklist

- [x] Plan written (this doc)
- [x] Regex matcher + safe fallback, shared across all three match sites
- [x] Validator: raised max length, regex-validity check on create/update
- [x] Export service + route
- [x] Import service (lenient, per-row skip+reason) + route
- [x] UI: export/import buttons on the Rules screen
- [x] Unit tests: regex matching (literal, regex, invalid-regex fallback,
      case sensitivity), export, import (skip reasons, idempotent re-import)
- [x] `npm run format:fix && npm run lint`, `npx tsc --noEmit`, `npm run test`
