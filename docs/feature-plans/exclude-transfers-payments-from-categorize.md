# Exclude transfers and card payments from the categorize queue

Status: implemented (service + unit tests)
Branch: `exclude-transfers-payments-from-categorize`

## Blocker for the caller: two functions in the PM scope do not exist

The scope handed down names four functions. Only two are real.

`lib/services/categorize.ts` is 104 lines; its complete export list is
`compileRuleMatcher`, `matchCategoryRule`, `suggestCategoryId`,
`getCategorizeQueue`, `getCategorizeQueueStats` (plus module-private
`compileMatchers`). A repo-wide grep over `*.ts`/`*.tsx` for
`getCategorizeProgress` and `getUncategorizedMonthSummary` returns **zero
hits** anywhere in `app/`, `lib/`, `components/`, or `tests/`.

Consequences:

- **`getCategorizeProgress`** — does not exist. There is no progress
  denominator anywhere in the codebase, so PM story 3's acceptance criterion
  ("denominator and uncategorized count computed over the same eligible
  population") has nothing to apply to. It is not silently dropped here — it
  is unsatisfiable until someone decides whether a progress indicator is a
  feature we actually want. That is a product decision, not an architecture
  one. **Not planned below.**
- **`getUncategorizedMonthSummary`** — does not exist. The brief's premise
  ("already filters `isTransfer: false` but not `isPayment: false`") describes
  code that isn't in the tree. **Not planned below.** The `isPayment`
  reasoning it asked for is still answered, because it turns out to be
  load-bearing for the two real functions (see below).

Do not create either function as part of this change. Send the discrepancy
back to product-manager.

## What actually changes

Two Prisma `where` clauses in one file.

### `lib/services/categorize.ts`

`getCategorizeQueue` (line 60):

```ts
where: { userId, categoryId: null, skippedAt: null, isTransfer: false, isPayment: false },
```

`getCategorizeQueueStats` (line 91): identical addition to the
`prisma.transaction.findMany` inside the `Promise.all`.

Carry one shared comment above each, in the spirit of `lib/services/budgets.ts:36-38`:

> a transfer leg or a card payment isn't spending or income — it never needs a
> category, so keep it out of the triage queue entirely

Nothing else in the file moves.

### Style precedent: copy `budgets.ts`, not `overview.ts`/`trends.ts`

`overview.ts` (lines 132, 135, 142, 194-195, 209, 226) and `trends.ts`
(lines 91, 93) filter **post-fetch in JS** (`!t.isTransfer`) because those
services already hold the rows in memory for other reasons.
`budgets.ts:39-46` filters **in the Prisma `where`**. Categorize has no reason
to fetch rows it will discard, so it follows `budgets.ts`.

### Schema confirms plain `false` is correct

`prisma/schema.prisma:89,93` — `isPayment Boolean @default(false)` and
`isTransfer Boolean @default(false)`. Both non-nullable, so `isTransfer: false`
matches every non-transfer row. No `{ not: true }` NULL-safety dance needed.

### Why `isPayment: false` is required, not cosmetic

Neither function filters by transaction `type`, so the queue spans INCOME and
EXPENSE. `lib/transactions/use-transaction-form.ts:66` defines
`canBePayment = type === 'INCOME' && selectedAccount?.type === 'CREDIT_CARD'`,
and `lib/transactions/transaction-payload.ts:51` forces
`isPayment: canBePayment && isPayment` — so `isPayment` is only ever true on
INCOME rows against a credit-card account. (Corroborated by `overview.ts:132`
/ `194` and `trends.ts:91`, which guard `isPayment` only on the INCOME side and
never on EXPENSE.) Omitting the filter would leave credit-card
payment income legs sitting in the queue — exactly the rows this feature
exists to remove. Include it.

## What else moves (outside the stated UI scope — flagging, not deciding)

`getCategorizeQueueStats` has a **second consumer**: `lib/services/overview.ts:214`
feeds it into `OverviewData.triage` (`{ total, matched }`, type at
`overview.ts:75`), rendered on the dashboard. So the dashboard triage count
drops too, not just the categorize page.

This is almost certainly desirable — it makes triage agree with every other
overview aggregate, all of which already exclude transfers/payments. But it is
a visible change on a screen the PM scope said was untouched. Confirm before
merge; no code change required either way.

## What does NOT change

- **Rule matching / auto-apply** — `matchCategoryRule`, `compileRuleMatcher`,
  `compileMatchers`, `suggestCategoryId`, and `app/api/categorize/route.ts`
  are untouched. Out of scope per PM.
- **CSV import auto-categorization** — untouched.
- **UI** — `app/(protected)/categorize/page.tsx` and
  `components/categorize/categorize-view.tsx` need no edits; they receive a
  shorter queue through the existing `CategorizeQueueRow[]` contract. No flags
  are surfaced in that UI today and none are added.
- **Schema / migrations** — `prisma/schema.prisma` is not touched. No
  migration, no `prisma:generate`. Both columns already exist.
- **Manual categorization** — `categoryId` remains independently settable on a
  transfer/payment row via the transaction form
  (`lib/services/transactions.ts:122,157`). This change only affects what the
  queue _returns_.
- **Public type signatures** — `CategorizeQueueRow`, `CategorizeQueueStats`,
  and both function signatures are unchanged. No caller needs updating.

## Test impact

`tests/unit/services/categorize-queue.test.ts:71` **will fail**. It asserts
a strict deep-equal object inside `expect.objectContaining`:

```ts
where: { userId: 'user-1', categoryId: null, skippedAt: null },
```

Adding two keys breaks that equality. It must be updated, not deleted.

The second case in that file (line 84, `expect.objectContaining({ skippedAt: null })`)
is loose and will still pass.

There is currently **no test coverage for `getCategorizeQueueStats`** —
`tests/unit/services/categorize.test.ts` only covers `matchCategoryRule` and
`compileRuleMatcher`. Add coverage.

`tests/unit/services/overview.test.ts` exercises `getCategorizeQueueStats`
indirectly via `getOverviewData` (`overview.ts:214`); it mocks
`prisma.transaction.findMany` by call order and asserts only the _result_
(`result.triage` at line 77), never the `where` clause — so it should keep
passing unchanged. Re-run it to confirm rather than assuming.

## Checklist

- [ ] Send the missing-function discrepancy (`getCategorizeProgress`,
      `getUncategorizedMonthSummary`) back to product-manager; do not implement
      either. This does **not** block the two edits below — they are
      independently executable today.
- [x] `lib/services/categorize.ts` — add `isTransfer: false, isPayment: false`
      to the `prisma.transaction.findMany` `where` in `getCategorizeQueue`
      (line 60), with the explanatory comment.
- [x] `lib/services/categorize.ts` — same addition in
      `getCategorizeQueueStats` (line 91).
- [x] `tests/unit/services/categorize-queue.test.ts` — update the strict
      `where: { userId: 'user-1', categoryId: null, skippedAt: null }`
      assertion (line 71) to include both flags.
- [x] `tests/unit/services/categorize-queue.test.ts` — add a case asserting
      the queue query excludes transfers and payments
      (`expect.objectContaining({ isTransfer: false, isPayment: false })`).
- [x] Confirm `tests/unit/services/overview.test.ts` still passes unchanged.
- [x] Add a `getCategorizeQueueStats` describe block (new file or alongside
      the queue tests) covering:
      the same flag assertion; `matched` counting only rule-matched rows;
      empty-queue returning `{ total: 0, matched: 0 }`.
- [ ] Confirm with PM/user that the dashboard triage count dropping (via
      `overview.ts:214`) is intended.
- [x] `npm run format:fix && npm run lint && npm run test`.
