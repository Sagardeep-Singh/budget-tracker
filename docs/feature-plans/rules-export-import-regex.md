# Category rules: export/import

## Goal

Let a user back up / move their category rules between accounts: export as
a file, import it back with a confirmation step before anything is
written.

Note: this plan originally also added regex `matchText` support
(`/pattern/flags`). That was implemented and then explicitly removed at
the user's request — `matchText` is plain case-insensitive substring
matching only, as it was before this feature.

## Decisions

1. **Import has a confirmation step, not a direct commit.** Selecting a
   file first calls a read-only preview endpoint that classifies every row
   (`ready` or `skip` + reason) without writing anything. The UI shows the
   classified list in a modal before any row is imported.
2. **Any parsed row can be deselected before import** — not just skipped
   ones. The confirm step sends only the rows the user left checked;
   default selection is every `ready` row, `skip` rows start unchecked.
   This covers both "don't import this specific match" and "category
   doesn't exist, decide what to do" — the user sees exactly why a row
   would be skipped and can leave it out, without any auto-create magic.
3. **Missing target category is always a skip, never an auto-create.**
   Creating a category as a side effect of a rules import would be a
   surprising, hard-to-undo action. The row shows `Category "X" not
found` in the preview; the user creates the category first (or fixes
   the file) and re-imports — the row is simply left unchecked otherwise.
4. **Commit re-classifies at write time**, not trusting the client-sent
   preview — DB state (categories, existing rules) can change between
   preview and confirm, so `importCategoryRules` reruns the same
   classification (`classifyImportRows`) rather than blindly writing
   whatever rows the client posts.
5. **Import is per-row lenient, not all-or-nothing.** A bad row (category
   not found) is skipped with a reason rather than rejecting the whole
   file for one bad row — matches the existing CSV transaction import's
   "best effort, report the skip count" pattern. Only structurally
   malformed input (missing fields, wrong types) 400s the whole request.
6. **Export format is JSON**, `{ rules: [{ matchText, categoryName,
priority }] }` — `categoryName`, not `categoryId`: ids aren't portable
   across users/instances, names are. Priority is preserved as an absolute
   number, not renumbered.
7. **Import matches by category name, case-insensitive**, against the
   importing user's own existing categories.
8. **Duplicate rules are skipped, not duplicated**, on re-import: a row
   whose `(categoryId, matchText)` already exists for the user is skipped
   with reason `"Already exists"` — makes re-running an import idempotent,
   and is also just another row the confirm-step preview shows and lets
   the user leave unchecked.

## Non-goals

- CSV export/import (JSON only — rules aren't tabular in the way
  transactions are, and this is a config/backup format, not something
  meant to be edited in a spreadsheet).
- Regex matchText (implemented, then removed — see note above).
- Cross-user or cross-instance rule sharing/marketplace.
- Editing a row's category/matchText/priority inline in the preview —
  the only per-row action is include/exclude.

## What was built

- `lib/services/categorize.ts`: `compileRuleMatcher(matchText)` — a small
  case-insensitive substring matcher, shared by `matchCategoryRule`, the
  `getCategorizeQueue` inline matcher, and `categoryRules.ts`'s
  `appliedCount` (previously three separate copies of the same
  `haystack.toLowerCase().includes(...)` logic).
- `lib/validators/category-rule-transfer.ts` (new): `importedCategoryRuleSchema`
  / `importCategoryRulesSchema` (lenient — category-not-found is a
  per-row service-level skip, not a schema rejection) and the
  `ExportedCategoryRule` type for the file shape export produces.
- `lib/services/categoryRules.ts`: `exportCategoryRules(userId)`;
  `classifyImportRows` (shared classification used by both preview and
  commit); `previewCategoryRuleImport(userId, rows)` (read-only,
  returns each row's `ready`/`skip` status + reason); `importCategoryRules(userId, rows)`
  (commit — re-classifies, writes only `ready` rows).
- Routes: `GET /api/rules/export` (streams the JSON with a
  `Content-Disposition: attachment` header so the browser downloads it
  directly), `POST /api/rules/import/preview` (classify only, no writes),
  `POST /api/rules/import` (commit).
- `components/rules/rules-view.tsx`: Export button (plain link to the GET
  route); Import button opens a file picker, parses the JSON client-side,
  posts it to the preview route, then shows a modal listing every row with
  a checkbox (checked by default only for `ready` rows, skipped rows show
  their reason) — Cancel closes without writing, Confirm posts only the
  checked rows to the commit route and shows an imported/skipped summary.

## Checklist

- [x] Plan written and kept up to date through implementation
- [x] Matcher shared across all three match sites
- [x] Export service + route
- [x] Preview (read-only classify) service + route
- [x] Import commit service (lenient, per-row skip+reason, re-classifies
      at write time) + route
- [x] UI: export button, import confirmation modal with per-row
      include/exclude checkboxes
- [x] Unit tests: matcher, export, preview classification, import
      (skip reasons, idempotent re-import, in-file dedup)
- [x] `npm run format:fix && npm run lint`, `npx tsc --noEmit`, `npm run test`
