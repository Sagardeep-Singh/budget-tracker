# Rule Import: Opt-In Category Auto-Creation

## Background

`classifyImportRows` (`lib/services/categoryRules.ts`) currently skips any rule-import row whose `categoryName` doesn't match an existing category, per a prior deliberate decision ("never auto-create a category as a side effect of import" — `docs/feature-plans/rules-export-import-regex.md`). User has confirmed directly this should change: import should be able to create the missing category, but only as an **explicit per-row opt-in**, never automatic/bulk.

## User Story

As the user, when I import category rules and some rows reference categories I don't have yet, I want the preview to flag which rows would create a new category and let me include/exclude each one individually, so I can bring in rules for not-yet-existing categories without anything being auto-created behind my back.

## Decisions

1. **No new wire field.** The existing include/exclude mechanism (checked rows are the only ones POSTed to commit) is reused as-is — `will-create` rows are simply excluded from the payload if unchecked. No `createCategory: boolean` flag needed.
2. **`will-create` rows default unchecked** in the preview — matches existing `skip`-row default, reads as opt-in.
3. **Canonical casing**: when multiple checked rows reference the same missing category (case-insensitively), the first occurrence (in submitted-row order) wins the stored casing. `matchText` comparison stays case-sensitive, unchanged.
4. **Transaction added**: `importCategoryRules` now wraps writes in `prisma.$transaction` — the new failure mode (category created, rule attach fails → orphaned category) didn't exist before, and rule-level dedupe has no DB unique constraint, so reads must be coherent with the writes inside one transaction.
5. **No schema/migration changes.** `Category` already has everything needed (`name`, `isDefault`, `@@unique([userId, name])`).
6. **Name normalization**: none beyond existing `.trim()` in the validator — matches `createCategorySchema`.

## Non-Goals

- No bulk "create all missing" toggle.
- No color/icon/type/budget setup for auto-created categories.
- No changes to manual single-rule creation form, CSV transaction import, category matching logic, export format, or schema.
- No relaxing the existing whole-file 400 on structurally invalid rows.

## Implementation Checklist

- [x] product-manager: user story + acceptance criteria
- [x] software-architect: type/logic design, transaction decision, file-by-file impact
- [x] ui-designer: preview modal — third row state (`will-create`), result banner copy for `createdCategories`
- [x] tester: unit test plan (`tests/unit/services/categoryRules.test.ts` — extend, mock needs `$transaction` + `category.createMany`) and any e2e plan needed for rules-view preview flow (no e2e: no rules-import harness exists, out of scope to stand one up)
- [x] senior-developer: implement `lib/services/categoryRules.ts`, `components/rules/rules-view.tsx`, extend `tests/unit/services/categoryRules.test.ts`
- [x] tester: review implementation, run lint/unit/e2e, try edge cases (same-name collisions, all-unchecked, commit-time drift) — found 2 small gaps, both fixed: missing `role="alert"` on the in-modal commit-error paragraph, and a vacuous test that didn't actually exercise "row omitted from submission"

## Type/Contract Changes

`ImportRowStatus = 'ready' | 'skip' | 'will-create'` — three independent copies (`ClassifiedImportRow` in service, `ImportPreviewRow` service DTO, `PreviewRow` in `rules-view.tsx`) all gain the new member together.

`ImportPreviewRow` gains optional `newCategoryName?: string` (present iff `status === 'will-create'`).

`ImportCategoryRulesResult` gains `createdCategories: string[]`.

See architect design (folded into implementation) for exact `classifyImportRows`/`importCategoryRules` logic — canonical-casing pending-create keying, transaction wrapping, `skipDuplicates` + re-fetch pattern for category creation.

## Implementation notes

- `classifyImportRows` takes an optional `db: Prisma.TransactionClient = prisma` so commit re-classifies inside its own transaction; `importCategoryRules` always opens `prisma.$transaction`, even for an all-skip commit, because classification must read coherently with the writes.
- `tx.category.createMany({ skipDuplicates: true })` is used directly rather than `createCategory` from `lib/services/categories.ts`: that helper throws on duplicate names and takes no transaction client, so it can't serve this path. Justified bypass of "extend existing services," not an omission.
- `createdCategories` is `namesToCreate` (deduped by lowercase, first-occurrence casing, in row order), not a post-write diff — a category that already exists at commit time classifies as `ready`/`skip`, never `will-create`, so it can't appear in the list.
- The old `Category "X" not found` skip path is deleted; it is unreachable under this design.
- Also bundled in (ui-designer, in scope): `role="status"` on the import result banner and `role="alert"` on the import error paragraph — neither was a live region, so screen readers missed both after the async commit.

## Files Touched

- `lib/services/categoryRules.ts` — all logic changes
- `components/rules/rules-view.tsx` — preview row rendering (3 states), result banner
- `tests/unit/services/categoryRules.test.ts` — extend mock (`$transaction`, `category.createMany`) + new cases

No changes to: validators, API route handlers (response shape changes, no handler logic), schema/migrations, `lib/services/categories.ts`, `lib/services/csvImport.ts`, `lib/services/categorize.ts`.
