# Transactions page: server-side pagination + aggregation

## Problem

`app/(protected)/transactions/page.tsx` calls `listTransactions(userId, {})` — no bound — loading
a user's entire transaction history (5 relations each) on every visit to `/transactions`.
`components/transactions/transactions-view.tsx` (762 lines) then does _all_ filtering, the
statement/calendar-month period, the running balance, and the credit/debit/net summary
client-side over that one array. This plan scopes moving that logic server-side alongside
pagination, without changing what the user sees or can do. Source: `docs/reviews/2026-09-17-codebase-review.md`
("listTransactions" finding, 2026-09-18 and 2026-09-23 updates); Phase 4 of
`docs/feature-plans/address-2026-09-17-codebase-review-findings.md`.

This is a scoping doc only. No implementation, schema, or architecture decisions are made here —
those belong to the software-architect pass that follows.

## Checklist

- [x] Product scoping (this doc)
- [x] Software-architect pass: file breakdown, service/validator contracts, schema impact —
      see `## Architecture` below
- [x] UI-designer pass — see `## UI Design` below (Load-more, search pending-state, focus/a11y,
      empty/edge states; one client-side contract addition: an error-kind discriminator)
- [x] Tester: unit test plan + e2e regression plan for filters/period/running-balance/summary
      — see `## Test Plan` below
- [x] Implementation — see `### 11. Implementation notes` under `## Architecture`
- [x] Tester: review pass

## Current behavior (ground truth, read from code)

**Two independent filter pipelines exist today, not one:**

- **Desktop**: `filters` (parsed from the URL via `parseTransactionFilters`/`transactionFiltersToSearchParams`
  in `lib/transactions/transaction-filters.ts`) plus `payeeDraft` (local state, debounced 300ms into
  the URL) plus the account-linked `period` (Period Picker: All time / By month / By statement — only
  shown when exactly one account is selected, statement mode additionally requires
  `account.type === 'CREDIT_CARD' && account.statementDay`; `lib/statement.ts`). `filters.payee` and
  `payeeDraft` are merged into `effectiveFilters` so the list reacts on every keystroke without
  writing to the URL every keystroke.
- **Mobile**: applies `mobileSearch` (local state, **not in the URL**) and `quickFilter`
  (`all`/`uncategorized`/`spending`/`income`, **not in the URL**) _on top of_ the desktop-filtered
  `filtered` array. Mobile's search matches payee **or** a substring match against
  `Number(t.amount).toFixed(2)` — i.e. "12.5" matches "112.50" — which is a formatted-string
  substring match, not a numeric range comparison, and is different from desktop's payee-only
  search.

**Filter semantics** (`matchesTransactionFilters` in `lib/transactions/transaction-filters.ts`):
payee (contains, case-insensitive), accountIds (multi-select, OR within group), categoryIds
(multi-select, OR within group, "no category" never matches an active categoryIds filter), date
range (`from`/`to`, inclusive, compared as `YYYY-MM-DD` strings against `transaction.date.slice(0,10)`),
type (INCOME/EXPENSE), amount range (min/max, unbounded-safe if the string doesn't parse), and three
boolean flags (hideTransfers, hidePayments, uncategorizedOnly). The Period Picker's `period` is a
separate `[start, end)` range ANDed on top, independent of the `from`/`to` filter (both can be
active and intersect).

**Running balance**: computed by sorting the _entire filtered set_ ascending by date, then
accumulating `balance += (type === 'INCOME' ? +amount : -amount)` per row, unlike the summary it
does **not** exclude `isPayment`/`isTransfer`/`isReimbursementIncome`. Because the list renders
newest-first, page 1 of any paginated result needs the running total of every older filtered row —
this is a correctness requirement from row one, not a deep-pagination optimization.

**Summary** (`credit`/`debit`/`payments`/`transfers`/`reimbursementIncome`/`net`): computed over
the filtered set with deliberate bucket precedence — `isPayment` checked first, then `isTransfer`,
then `isReimbursementIncome`, then `type` — so a transaction that is both a payment and a transfer
is bucketed as a payment (existing code comment explains this is intentional). The "Payments
(excluded)"/"Transfers (excluded)"/"Reimbursement income (excluded)" chips render only when their
bucket is `> 0`.

**Other aggregates computed over the full filtered set, independent of any page window**:
`filtered.length` (desktop count label, "N transactions[ in this period]"), `uncategorizedCount`
(mobile pill badge — counted over `filtered`, **not** `mobileFiltered`), per-day totals in
`groupByDay` (computed from whichever rows are present in that day's group).

**Ordering**: `listTransactions` returns `orderBy: { date: 'desc' }` with no secondary sort key;
the client then does its own stable sort ascending by date only for the running balance, and
groups by day (`formatDate`), reversing day order for newest-first display; each day's own rows
render newest-first via `.reverse()`. Same-day row order is currently whatever Postgres/the client
sort happens to produce — effectively insertion order, undefined by any documented contract.

**Not filtered by `listTransactions` today**: `skippedAt` is not in the `where` clause, so skipped
transactions currently appear in the list. Preserve this (or flag it as a deliberate, separately-scoped
fix — do not silently change it as a side effect of this work).

**Known pre-existing copy bug**: the mobile count line reads "N transactions · transfers excluded"
but `mobileFiltered` does not actually exclude transfers (only `quickFilter`/`mobileSearch` apply on
top of the desktop-filtered set, which itself only excludes transfers if `hideTransfers` is active).
Flagged below as an explicit decision point, not assumed either way.

**Other caller, out of scope**: `app/(protected)/import/history/[id]/page.tsx` also calls
`listTransactions(userId, { batchId })` to show all transactions in one import batch. This is
naturally bounded (batch size, not full history) and has no client-side filter/period/aggregation
logic layered on top — not part of this problem and should keep working unchanged.

## User stories / acceptance criteria

1. **As a user with a long transaction history, visiting `/transactions` loads quickly regardless
   of how many transactions I've ever logged.** Acceptance: the initial page load fetches a bounded
   window of transactions (page size TBD by architect), not the full history, while every capability
   below continues to work exactly as today.

2. **As a user, every filter (search, account, category, date range, type, amount range, hide
   transfers/payments, uncategorized-only) still narrows the list to exactly the same rows it does
   today, now computed server-side.** Acceptance: for any combination of active filters, the set of
   transactions shown (across all pages, if paginated) matches what today's client-side
   `matchesTransactionFilters` would produce over the full history — including the existing
   semantics for each filter listed under "Current behavior" above (contains match, multi-select OR,
   inclusive date-string comparison, etc.).

3. **As a user, switching between All time / By month / By statement (when a single credit-card
   account with a statement day is selected) still shows exactly the transactions in that period,
   and prev/next navigation still moves by one period.** Acceptance: period semantics (statement
   period boundary math in `lib/statement.ts`, month boundary math) are unchanged; the picker still
   only appears under the same conditions it does today.

4. **As a user, the running balance column (desktop only) still shows a correct cumulative balance
   for the currently filtered/period-scoped view, on every page, not just the first.** Acceptance:
   the balance shown next to any given transaction equals the sum of that transaction's signed
   amount plus every older transaction's signed amount within the current filter+period scope
   (matching today's include-everything-including-payments-and-transfers semantics), regardless of
   which page that transaction is displayed on.

5. **As a user, the credit/debit/net summary bar and the excluded-bucket chips (Payments/Transfers/
   Reimbursement income) still reflect totals across the entire filtered+period-scoped result set,
   not just the visible page.** Acceptance: bucket precedence (payment > transfer > reimbursement
   income > type) and the "> 0 to render" chip visibility rule are preserved exactly; totals are
   computed once for the full matching set server-side, independent of page size.

6. **As a user, the desktop transaction count ("N transactions[ in this period]") and the mobile
   uncategorized-pill badge count still reflect the full filtered+period-scoped set, not the page
   window.** Acceptance: both counts are full-set aggregates, matching today's semantics
   (`filtered.length`, `uncategorizedCount` over `filtered` not `mobileFiltered`).

7. **As a user, day-group headers (date label + per-day total) still show a correct total for every
   transaction on that day.** Acceptance: a day's total reflects every transaction that occurred on
   that day within the current filter+period scope — see Open Questions on how this interacts with
   page boundaries.

8. **As a user, the mobile quick-filter pills (All/Uncategorized/Spending/Income) and mobile search
   box (payee-or-formatted-amount substring match) still narrow the visible list the same way.**
   Acceptance: mobile's distinct filtering semantics (see Open Questions — whether this moves
   server-side or stays client-side) produce the same visible result set as today for the same
   inputs.

9. **As a user, deep-linking or refreshing a filtered/period URL still reproduces the same filtered
   view.** Acceptance: whatever URL shape the architect defines for pagination, existing filter
   query params continue to round-trip (or their server-equivalent produces an identical result) —
   shareable/bookmarkable filtered URLs are not a regression from today's `?accountIds=...&...` URLs.

10. **As a user, I can see more transactions beyond the initial page** (via whatever mechanism the
    architect/UI-designer choose — load-more, numbered pages, or infinite scroll) **without losing
    my current filters, period, or scroll position unexpectedly.** Acceptance: TBD exact interaction
    once architect/UI-designer decide the pagination UI; the requirement is continuity of filter
    state across page-loading actions.

## Non-goals

- No redesign of the filter dialog, period picker, or list layout/visual design — this is a data
  and pagination change, not a UI/interaction redesign.
- No change to what "running balance" means (starting point, sign convention, what's included/
  excluded) — only _how_ it's computed (server-side, full-scope aggregate vs. client reduce).
- No new filter types, no new quick-filter categories, no merging of the desktop/mobile filter
  pipelines into one unless the open question below is resolved in that direction — that resolution
  is explicitly flagged as a decision needed before implementation, not assumed here.
- No change to `app/(protected)/import/history/[id]/page.tsx`'s use of `listTransactions` — it's
  naturally bounded by batch and out of scope.
- No change to the Period Picker's own account-selection gating logic (single account, credit card
  - statementDay for statement mode).
- No fix to the pre-existing "transfers excluded" mobile copy bug beyond an explicit decision (see
  Open Questions) — not silently changed as a side effect.
- No resolution of other findings from `docs/reviews/2026-09-17-codebase-review.md` (rate limiting,
  `requireUserId()` extraction, security headers, etc.) — out of scope for this phase (those are
  Phases 1-2 of the sibling plan doc and are already done).
- No schema/migration decisions (e.g. an index for cursor pagination) — flagged for the architect,
  not decided here, per CLAUDE.md's "never change schema unless the task requires it."

## Decisions (resolved by the orchestrating session before the architect pass)

1. **Mobile filters move server-side.** `quickFilter` and `mobileSearch` become request
   parameters alongside the desktop filters, on one shared server-side filter pipeline — not two.
   Required for pagination to be safe on mobile at all (see Open Question 1 above).
2. **Mobile's formatted-amount substring search is preserved exactly**, via a two-phase query when
   that search term is active: a cheap `amount`-only (+ id) fetch over the already-filtered set,
   substring-matched in JS against `Number(amount).toFixed(2)`, then the matching id list is what
   gets paginated. No raw SQL. Only runs when an amount-shaped search term is present.
3. **Pagination UI is "Load more"** (append to the current list), not numbered pages or infinite
   scroll — simplest to implement without redesigning the list layout. Page size: 50.
4. **Running balance and summary are separate server-side aggregate queries**, scoped by the exact
   same filter+period predicate as the page query, computed once per request (not per page).
5. **Same-day ordering gets a secondary sort key (`id`)** for a stable cursor — previously
   undefined, so this is a formalization, not a behavior change to any acceptance criterion above.
6. **Day-group per-day totals are their own server-side aggregate**, independent of page
   boundaries — pages are not constrained to end on day boundaries.
7. **`GET /api/transactions`'s existing query params are extended**, not replaced — the desktop
   filter URL contract keeps working; pagination and the newly-server-side mobile params are
   additive.
8. **A new service function is added alongside `listTransactions`**, not a breaking change to it —
   `listTransactions` keeps its current plain-array contract for the batch-detail caller
   (`app/(protected)/import/history/[id]/page.tsx`); the Transactions page calls a new function
   that returns the full paginated envelope (rows + cursor + running-balance start + summary +
   day totals). Shared filter-building logic is factored out so both use one implementation.
9. **`skippedAt` inclusion is preserved exactly as today** (no filter) — not a chance to silently
   change it.
10. **The "transfers excluded" mobile copy bug is left alone** in this pass, to keep it focused on
    pagination/aggregation. Worth a follow-up ticket, not bundled in.

## Open questions (for the architect and/or the orchestrating session, before implementation)

1. **Does mobile's local search/quick-filter state move server-side (into the URL/request), or
   does mobile keep filtering client-side over its page window?** This is the fork that determines
   whether pagination is safe to ship at all for mobile: if mobile stays client-side over a
   paginated (not full-history) result, its counts and "search across all history" behavior
   silently break — no page-size choice fixes that. This is a product decision, not an
   architecture one, and should be resolved before the architect pass.

2. **Mobile's amount search is a formatted-string substring match** (`"12.5"` matches `"112.50"`),
   not a numeric comparison — it can't be expressed as a simple Prisma numeric filter without a
   string cast/`ILIKE`-style expression, which is a departure from the repo's current "no raw SQL
   anywhere" security-positive convention noted in the codebase review. Decide: preserve this exact
   matching semantic server-side (how?), approximate it, or treat as a deliberate, called-out
   behavior change.

3. **What does "page size" and the "load more" interaction look like** — fixed page size with a
   "Load more" button, numbered/offset pagination, or cursor-based infinite scroll? This is an
   architect/UI-designer decision but constrains the API shape (offset+limit vs. cursor), so needs
   an answer before the service contract is finalized.

4. **How is the running-balance opening total computed for a given page?** It requires, at minimum,
   a separate aggregate query (sum of signed amounts for every filtered+period-scoped transaction
   older than the page's oldest row) independent of the page's own `take`/`skip` window — this
   can't be derived from the page's rows alone. Confirm this aggregate query is scoped by the exact
   same filter+period predicate as the page query itself (else the numbers drift), and confirm it
   is _not_ simplified into an account-balance query (it is view-relative, including only filtered/
   period-scoped transactions, not the account's true running balance).

5. **Same-day ordering has no documented tiebreak today** (`orderBy: { date: 'desc' }` only).
   Cursor-based pagination needs a total order (e.g. `date, id`) to avoid skipped/duplicated rows
   across pages. Adding a tiebreak may change which specific transaction sits at which position
   among same-day rows compared to today — call this out as a deliberate, user-visible-in-edge-cases
   change rather than an incidental one.

6. **Do day-group boundaries need to align with page boundaries?** Today's per-day total
   (`groupByDay`) is computed from whichever rows are in memory; if pagination cuts through the
   middle of a day, that day's header total would be partial unless either (a) pages are
   constrained to end on day boundaries, or (b) per-day totals become their own server-side
   aggregate independent of the page window (mirroring the running-balance/summary aggregates).

7. **How should filter/period state round-trip between client and the paginated API** — do existing
   URL query params (`accountIds`, `categoryIds`, `from`, `to`, `payee`, `type`, `amountMin`,
   `amountMax`, `hideTransfers`, `hidePayments`, `uncategorizedOnly`) get extended with pagination
   params on `GET /api/transactions`, or does a paginated variant require a POST body (e.g. if
   mobile's filters also move server-side and grow the payload)? Architect's call, but the existing
   filter URL contract (used for shareable/bookmarkable links) should be preserved or explicitly
   migrated, not silently dropped.

8. **Does the response envelope change for the existing `GET /api/transactions` consumers**, or is
   a new endpoint/shape introduced for the paginated Transactions page while `listTransactions`
   keeps returning a plain array for the batch-detail caller? `listTransactions`'s current return
   type (`FrontendTransaction[]`) is also used unbounded-but-small by
   `app/(protected)/import/history/[id]/page.tsx` — confirm that caller is unaffected either by
   keeping a non-paginated code path or by it explicitly opting out of pagination.

9. **Should `skippedAt` transactions be excluded now that this logic is being rebuilt**, or is
   today's inclusion (no filter on `skippedAt` in `listTransactions`) intentional and to be
   preserved as-is? Not assumed either way — flagging since this logic is being touched anyway.

10. **Should the pre-existing "transfers excluded" mobile copy bug be fixed in this pass** (since
    the mobile filtering logic is being touched regardless) or left as-is to keep this phase focused
    on pagination/aggregation? Explicit decision requested, not a silent fix or silent carry-over.

## Architecture

Software-architect pass. Implements Decisions 1-10 above; no product decisions are reopened here.
Verified against the current code (`transactions-view.tsx`, `lib/services/transactions.ts`,
`lib/transactions/transaction-filters.ts`, `lib/statement.ts`, `lib/format.ts`,
`app/api/transactions/route.ts`, `prisma/schema.prisma`) and against the generated Prisma client
(`@prisma/client` 6.19.3).

### 1. File breakdown

**New**

| File                                           | What it is                                                                                                                                                                                                                                                                            | Why                                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/transactions/transaction-scope.ts`        | Pure, DB-free module: `TransactionScope` type (desktop `TransactionFilters` + `period` + `mobileSearch` + `quickFilter`), the `(date desc, id desc)` comparator, the cursor encode/decode pair, `isAmountSubstringCandidate()`, `needsExactStringMatch()`, and the `dayKey()` helper. | One home for the ordering/cursor/search-shape rules so the service, the validator and the tests all read the same definitions; pure so it is unit-testable without Prisma.                                                                                          |
| `lib/services/transactionsPage.ts`             | The new service: `getTransactionsPage()` plus the shared `buildTransactionWhere()` where-builder and the aggregate helpers.                                                                                                                                                           | Keeps `lib/services/transactions.ts` (CRUD + `listTransactions`) untouched for its existing callers; the paginated read path is a cohesive unit of its own. `buildTransactionWhere` is exported so the page query and every aggregate provably share one predicate. |
| `tests/unit/services/transactionsPage.test.ts` | Unit tests (tester's plan owns the cases).                                                                                                                                                                                                                                            | New service methods need tests per CLAUDE.md.                                                                                                                                                                                                                       |

**Changed**

| File                                                        | Change                                                                                                                                                                                                                                                        | Why                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/validators/transactions.ts`                            | Add `transactionsPageQuerySchema` + `TransactionsPageQuery` type. Leave `listTransactionsQuerySchema` exactly as is.                                                                                                                                          | Decision 7: extend, don't replace. The legacy singular `accountId`/`categoryId`/`batchId`/`from`/`to` contract keeps its current `lte: to` semantics.                                                                                                                           |
| `app/api/transactions/route.ts`                             | `GET` gains a `paginated=1` branch: parse with `transactionsPageQuerySchema`, call `getTransactionsPage`, return the envelope. Without `paginated=1` the handler is byte-for-byte what it is today.                                                           | Additive, no envelope change for existing consumers (there are none in-repo; treated as public anyway). No business logic added to the handler.                                                                                                                                 |
| `app/(protected)/transactions/page.tsx`                     | Read `searchParams`, build the page-1 scope from the URL filters (period/mobile params are always at their defaults on a fresh load), call `getTransactionsPage`, pass `initialPage` + `initialRequestKey` to the view. Drops `listTransactions(userId, {})`. | Kills the unbounded query that motivated this plan while keeping a server-rendered first paint.                                                                                                                                                                                 |
| `components/transactions/transactions-view.tsx`             | Client-computed filtering/summary/balance/day-grouping/counts replaced by fetched data + a `loadMore` action. Detail below in §7.                                                                                                                             | The 762-line client pipeline is the thing being moved server-side.                                                                                                                                                                                                              |
| `lib/transactions/transaction-filters.ts`                   | No functional change. Add a comment on `matchesTransactionFilters` recording that it is no longer on the render path and is retained as the executable reference semantics for the server-parity tests.                                                       | **Recommendation (decided, not an open question):** keep it. It is the only precise, documented statement of the filter semantics the server must reproduce, and the tester's parity plan needs an oracle. Deleting it would delete that oracle and its 15 existing test cases. |
| `docs/feature-plans/transactions-server-side-pagination.md` | This section + the §10 checklist.                                                                                                                                                                                                                             | Plan-of-record per CLAUDE.md.                                                                                                                                                                                                                                                   |

**Deliberately not touched:** `lib/services/transactions.ts` (`listTransactions` and its `ListTransactionsQuery`
contract), `app/(protected)/import/history/[id]/page.tsx`, `lib/statement.ts`, `prisma/schema.prisma`,
`components/transactions/period-picker.tsx`, `components/transactions/transaction-filters-dialog.tsx`.

### 2. Service contract

```ts
// lib/transactions/transaction-scope.ts
export type QuickFilter = 'all' | 'uncategorized' | 'spending' | 'income';

export type TransactionScope = {
  /** the desktop filter set, unchanged shape, straight off the URL */
  filters: TransactionFilters;
  /** the Period Picker's [start, end) window; null = All time */
  period: { start: Date; end: Date } | null;
  /** mobile search box: payee OR formatted-amount substring. '' = no filter */
  mobileSearch: string;
  /** mobile quick-filter pills */
  quickFilter: QuickFilter;
};

export type TransactionCursor = { date: Date; id: string };
export const encodeTransactionCursor = (cursor: TransactionCursor): string => {
  /* base64url JSON */
};
export const decodeTransactionCursor = (raw: string): TransactionCursor | null => {
  /* null = malformed */
};
```

```ts
// lib/services/transactionsPage.ts
export type TransactionsPageRequest = TransactionScope & {
  /** page size, Decision 3 = 50; validator clamps to 1..100 */
  limit: number;
  /** opaque cursor from the previous page's `nextCursor`; absent = first page */
  cursor?: TransactionCursor;
};

export type TransactionSummary = {
  credit: number;
  debit: number;
  payments: number;
  transfers: number;
  reimbursementIncome: number;
  /** credit - debit, precomputed so the client does no money arithmetic */
  net: number;
};

/** signed day total, keyed by UTC `YYYY-MM-DD` (NOT `formatDate` output) */
export type DayTotal = { day: string; total: number };

export type TransactionsPageResult = {
  /** newest-first, `(date desc, id desc)`, at most `limit` items */
  rows: FrontendTransaction[];
  /** null when there is nothing older to load */
  nextCursor: string | null;
  hasMore: boolean;
  /** signed cumulative total of every in-scope row strictly OLDER than the oldest row on this page */
  runningBalanceStart: number;
  /** full-scope row count (mobile params included) — the mobile count line */
  totalCount: number;
  /** desktop-scope row count (mobile params omitted) — the "N transactions[ in this period]" label */
  desktopCount: number;
  /** desktop-scope count of rows with no category — the mobile Uncategorized pill badge */
  uncategorizedCount: number;
  /** desktop-scope totals; bucket precedence isPayment > isTransfer > isReimbursementIncome > type */
  summary: TransactionSummary;
  /** full-day totals for every UTC day this page's rows touch, page-boundary independent */
  dayTotals: DayTotal[];
};

export const getTransactionsPage = async (
  userId: string,
  request: TransactionsPageRequest,
): Promise<TransactionsPageResult> => {
  /* ... */
};
```

**Shared filter building.** One exported builder, used by the page query and by _every_ aggregate in
this file, so page and aggregates cannot drift (Open Question 4's core requirement):

```ts
/** `mobile: false` omits mobileSearch/quickFilter — the desktop-scope predicate. */
export const buildTransactionWhere = (
  userId: string,
  scope: TransactionScope,
  options: { mobile: boolean },
): Prisma.TransactionWhereInput => {
  /* ... */
};
```

Clause-by-clause equivalence with `matchesTransactionFilters` (this mapping is the acceptance bar
for the parity tests):

| Filter                                     | Prisma clause                                                                                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| always                                     | `userId`                                                                                                                                                                            |
| `payee` (trimmed, non-empty)               | `payee: { contains: term, mode: 'insensitive' }`                                                                                                                                    |
| `accountIds`                               | `accountId: { in: accountIds }`                                                                                                                                                     |
| `categoryIds`                              | `categoryId: { in: categoryIds }` — `in` never matches NULL, which is exactly today's "no category never matches an active categoryIds filter"                                      |
| `from` / `to` (`YYYY-MM-DD`, inclusive)    | pushed into the `AND` array as `{ date: { gte: <from>T00:00:00Z } }` and `{ date: { lt: <to + 1 day>T00:00:00Z } }` — day-inclusive, matching the `date.slice(0,10)` string compare |
| `period`                                   | pushed into the same `AND` array as `{ date: { gte: period.start } }`, `{ date: { lt: period.end } }`                                                                               |
| `type`                                     | `type`                                                                                                                                                                              |
| `amountMin` / `amountMax`                  | `amount: { gte, lte }`, each side included **only** when `Number.isFinite` — preserves today's unbounded-safe parse                                                                 |
| `hideTransfers`                            | `isTransfer: false`                                                                                                                                                                 |
| `hidePayments`                             | `isPayment: false`                                                                                                                                                                  |
| `uncategorizedOnly`                        | `categoryId: null`                                                                                                                                                                  |
| `quickFilter` (mobile)                     | `uncategorized` -> `categoryId: null`; `spending` -> `type: 'EXPENSE'`; `income` -> `type: 'INCOME'`                                                                                |
| `mobileSearch` (mobile, non-amount-shaped) | `payee: { contains: term, mode: 'insensitive' }` as a second clause in `AND`                                                                                                        |
| `mobileSearch` (mobile, amount-shaped)     | not expressible — triggers Mode B, §4                                                                                                                                               |
| `skippedAt`                                | **no clause at all**, Decision 9. Skipped transactions stay visible exactly as today.                                                                                               |

Both `from`/`to` and `period` constrain `date`, and `payee` can be constrained twice (desktop filter

- mobile search) — so all date and payee clauses go into a single `AND: [...]` array rather than
  top-level keys. No `min`/`max` reasoning, no key collisions.

`include` and `toFrontend` are reused as-is from `lib/services/transactions.ts` (export `include` and
`toFrontend` from there, or move both into a shared module — do **not** copy them). The 5 relations
per row are now fetched for 50 rows instead of the whole history, which is the actual win.

### 3. Validator contract

Extends `lib/validators/transactions.ts`; `listTransactionsQuerySchema` is untouched.

```ts
const csvIds = z
  .string()
  .optional()
  .transform((v) =>
    v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );

export const transactionsPageQuerySchema = z
  .object({
    // --- desktop filters ---
    // LENIENT by contract: every filter field below ends in `.catch(<default>)` so a
    // hand-edited or stale bookmark degrades to "no filter" instead of 400ing. This is
    // not stylistic — `parseTransactionFilters`' doc comment states it outright ("Unknown/
    // malformed values fall back to 'no filter' rather than throwing, since a hand-edited
    // or stale URL must never crash the page") and AC 9 protects it. A `?from=garbage`
    // URL renders today's unfiltered list, NOT an error state.
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
    hideTransfers: z
      .enum(['true', 'false'])
      .catch('false')
      .transform((v) => v === 'true'),
    hidePayments: z
      .enum(['true', 'false'])
      .catch('false')
      .transform((v) => v === 'true'),
    uncategorizedOnly: z
      .enum(['true', 'false'])
      .catch('false')
      .transform((v) => v === 'true'),
    // --- period: client-computed instants, so lib/statement.ts stays the single source of period math ---
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date().optional(),
    // --- mobile, newly server-side (Decision 1) ---
    mobileSearch: z.string().max(120).catch(''),
    quickFilter: z.enum(['all', 'uncategorized', 'spending', 'income']).catch('all'),
    // --- pagination: STRICT. These are generated by our own client, never hand-typed,
    // so a malformed value is a bug worth surfacing as a 400 rather than silently
    // paginating from the wrong place. ---
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
```

Lenient vs strict, stated once: **every desktop filter field, both mobile fields and `periodStart`/
`periodEnd` are lenient** (`.catch(default)` — malformed values become "no filter"; a malformed
period degrades to All time via the both-or-neither refine); **`limit` and `cursor` are strict**
(400 on malformed). The two `.refine`s above only ever fire on values that already survived
`.catch`, so they cannot turn a stale bookmark into an error page.

`amountMin`/`amountMax` stay **strings** through the validator so the service can apply today's
"ignore it if it doesn't parse finite" rule; a `z.coerce.number()` here would 400 on input the
current UI silently treats as no-filter.

Cursor handling: the route passes `cursor` through as a string; the service decodes it with
`decodeTransactionCursor` and throws `ServiceValidationError('Invalid cursor')` on a malformed value
(the route already maps that to 400). A _stale-but-well-formed_ cursor is not an error — see §6.

Why query params and not a POST body (Open Question 7): the payload is small (11 filter params + 4
new), `GET` stays cacheable/replayable/curl-debuggable, and the desktop filter param names round-trip
unchanged so bookmarked URLs keep working (AC 9). Period and mobile params are request-only and stay
**out** of the URL, exactly as today (they are local component state — changing that is a non-goal).

### 4. Two-phase amount-substring search (Decision 2)

Yes, implementable as described, and it lands **simpler** than Mode A rather than harder.

**Mode selection.** Let `term = mobileSearch.trim()`. Use Mode B iff `term !== ''` **and**
(`/^[0-9.]+$/.test(term)` **or** `term` contains `%` or `_`).

- The amount branch of today's match is `Number(amount).toFixed(2).includes(term)`, and
  `toFixed(2)` output contains only `[0-9.]` (amounts are positive; the sign lives in `type`).
  A term containing any other character therefore _can never_ match the amount branch — so the
  shape test is exactly necessary and sufficient, not an approximation. Non-amount-shaped terms
  collapse losslessly to a Prisma `payee contains` clause (Mode A).
- `%`/`_` are routed to Mode B as a safety measure: Prisma's `contains` compiles to `LIKE
'%<param>%'` and it is **not confirmed** that it escapes LIKE metacharacters (Prisma 6.19.3). If
  it does not, `payee` containing `%` would wildcard-match. This applies to the **desktop `payee`
  filter too** — so the rule is: if _either_ `filters.payee` or `mobileSearch` contains `%` or `_`,
  take Mode B and match that field in JS. The implementer should verify the escaping behaviour with
  one probe query; if `contains` does escape, drop the `%`/`_` condition and keep only the
  amount-shape condition. Tester: cover a payee literally containing `%`.

**Mode B query shape.** The other filters apply in the **same query** as the id+amount fetch — they
are _not_ applied afterwards. One lean full-scope scan, then everything else is in-memory:

```ts
// Phase 1 — every Prisma-expressible clause is already in this `where`.
const scan = await prisma.transaction.findMany({
  where: buildTransactionWhere(userId, scopeWithoutTextTerms, { mobile: true }),
  //      ^ identical to the Mode A predicate minus only the clause(s) Mode B matches in JS
  select: {
    id: true,
    date: true,
    amount: true,
    type: true,
    payee: true,
    categoryId: true,
    isPayment: true,
    isTransfer: true,
    _count: { select: { reimbursementIncomeLinks: true } },
  },
  orderBy: [{ date: 'desc' }, { id: 'desc' }],
});

// Phase 2 — the JS predicate, byte-identical to today's mobile match.
const matched = scan.filter(
  (r) =>
    (r.payee ?? '').toLowerCase().includes(termLower) || Number(r.amount).toFixed(2).includes(term),
);

// Phase 3 — the page window is a slice of that ordered id list, taken by the SAME
// keyset comparator used in Mode A (not by index lookup, so a stale cursor degrades
// gracefully):
const after = cursor ? matched.filter((r) => compareDesc(r, cursor) > 0) : matched;
const pageRows = after.slice(0, limit);
const hasMore = after.length > limit;

// Phase 4 — hydrate only the page.
const hydrated = await prisma.transaction.findMany({
  where: { userId, id: { in: pageRows.map((r) => r.id) } }, // always scope by userId (CLAUDE.md)
  include,
  orderBy: [{ date: 'desc' }, { id: 'desc' }], // `in` does NOT preserve order — required
});
```

Crucially, **every aggregate in Mode B is computed in JS from `matched`** — `totalCount`,
`summary`, `dayTotals`, `runningBalanceStart`. No `id: { in: [...10k ids] }` aggregate queries, no
second scan.

**The two scopes in Mode B, stated as one uniform rule.** The phase-1 `where`
(`scopeWithoutTextTerms`) omits _exactly_ the clauses that will be matched in JS, and nothing else:
the desktop `payee` clause (only when the `%`/`_` exact-match branch triggered it), `mobileSearch`,
and `quickFilter`. `scan` is therefore a strict superset of both scopes, and each scope is rebuilt
by applying the subset of JS predicates it needs:

- **desktop scope** (`summary`, `desktopCount`, `uncategorizedCount`): apply the JS payee predicate
  only.
- **full scope** (`rows`, `totalCount`, `dayTotals`, `runningBalanceStart`): apply the JS payee
  predicate + mobile search + `quickFilter`.

This holds identically for both Mode B triggers — under the amount-shaped trigger the JS payee
predicate is simply absent (`payee` stayed a Prisma clause), so the desktop scope is `scan` itself.
`quickFilter` is expressible in Prisma but is deliberately pulled out of phase 1 so one scan can
serve both scopes.

Mode B costs one lean full-scope scan (no relation payloads, one `_count` subquery) instead of the
full 5-relation hydration this plan is removing, and it only runs when the user has typed a
digits/dot term into the mobile search box. Acceptable per Decision 2. No raw SQL anywhere.

### Probe result: Prisma 6.19.3 `contains` escaping

**Run:** a throwaway `tsx` script against the local dev Postgres with Prisma query-event logging on
(`new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })`), issuing:

```ts
await prisma.transaction.count({ where: { payee: { not: null } } }); // control
await prisma.transaction.count({ where: { payee: { contains: '%' } } });
await prisma.transaction.count({ where: { payee: { contains: '%', mode: 'insensitive' } } });
await prisma.transaction.count({ where: { payee: { contains: '_' } } });
```

**Observed:** `{ totalWithPayee: 1276, containsPercent: 1276, containsPercentInsensitive: 1276,
containsUnderscore: 1276 }`, and the logged SQL was
`WHERE "public"."Transaction"."payee"::text LIKE $1` / `... ILIKE $1` with the bound parameter
`"%%%"` (and `"%_%"` for the underscore case) — i.e. the user's term is interpolated into the
`%…%` wrapper **verbatim**, with no `ESCAPE` clause and no escaping of LIKE metacharacters.

**Conclusion: Prisma 6.19.3 does NOT escape `%`/`_` in `contains`.** A `contains: '%'` term
wildcard-matched every row with a non-null payee instead of the zero rows that literally contain a
percent sign. (SQL injection is not the risk — the term is a bound parameter — but the _matching
semantics_ silently diverge from `matchesTransactionFilters`' plain `String.includes`.)

**Implementation consequence:** the `%`/`_` condition in the Mode B trigger is **kept**, exactly as
§4 specifies. `needsExactStringMatch(term)` returns `true` when the term contains `%` or `_`, and
the affected text match (`filters.payee` and/or `mobileSearch`) is performed in JS against
`String.includes` rather than handed to a Prisma `contains` clause. The tester's contingent cases
therefore take their "probe finds `contains` does not escape" branch: the service must never send a
`%`/`_`-containing term through a Prisma `contains`.

### 5. Aggregate query shapes (Decisions 4, 6) — Mode A

All four use `buildTransactionWhere` output, so the predicate is literally the same object graph as
the page query.

**Page query**

```ts
const rows = await prisma.transaction.findMany({
  where: { AND: [where, keysetClause] }, // keysetClause = {} on the first page
  include,
  orderBy: [{ date: 'desc' }, { id: 'desc' }],
  take: limit + 1, // +1 detects hasMore without a count
});
```

**Summary (desktop scope).** Bucket precedence `isPayment > isTransfer > isReimbursementIncome >
type` cannot be expressed as one Prisma aggregate, because `isReimbursementIncome` is _derived_
(`reimbursementIncomeLinks.length > 0`), not a column. Two `groupBy`s plus a JS fold — this is the
one place JS summation is unavoidable, and it is O(≤8 rows), not O(transactions):

```ts
const by = ['type', 'isPayment', 'isTransfer'] as const;
const [all, reimb] = await Promise.all([
  prisma.transaction.groupBy({ by, where: desktopWhere, _sum: { amount: true } }),
  prisma.transaction.groupBy({
    by,
    where: { AND: [desktopWhere, { reimbursementIncomeLinks: { some: {} } }] },
    _sum: { amount: true },
  }),
]);
```

Verified: `TransactionGroupByArgs.where` is `TransactionWhereInput`, which carries
`reimbursementIncomeLinks?: ReimbursementLinkListRelationFilter` — the relation filter is legal
inside `groupBy`, so no `incomeTransactionId` id-list round trip is needed. Fold: for each of the
≤8 `(type, isPayment, isTransfer)` cells, `isPayment` -> `payments`, else `isTransfer` ->
`transfers`, else the cell's `reimb` share -> `reimbursementIncome` and the remainder
(`all - reimb`) -> `credit` (INCOME) or `debit` (EXPENSE). Subtracting `reimb` per cell rather than
only from `credit` reproduces today's precedence for the (invariant-violating but code-reachable)
EXPENSE-with-income-links case.

**Counts**

```ts
const [totalCount, desktopCount, uncategorizedCount] = await Promise.all([
  prisma.transaction.count({ where }), // full scope
  prisma.transaction.count({ where: desktopWhere }), // desktop scope
  prisma.transaction.count({ where: { AND: [desktopWhere, { categoryId: null }] } }),
]);
```

When the mobile params are at their defaults (all desktop traffic, and mobile before typing)
`desktopWhere === where`: skip the duplicate queries and reuse `totalCount`, and skip the second
summary pair. Two predicates exist because the component renders the desktop and mobile trees
**simultaneously** in one DOM — see §7.

**Day totals (Decision 6).** Scoped to the UTC-day window the page's rows span, so a day cut in half
by a page boundary still gets its _full_ total:

```ts
const dayStart = utcDayStart(oldestRowOnPage.date);       // inclusive
const dayEnd   = utcDayStart(newestRowOnPage.date) + 1d;  // exclusive
const dayRows = await prisma.transaction.groupBy({
  by: ['date', 'type'],
  where: { AND: [where, { date: { gte: dayStart, lt: dayEnd } }] },
  _sum: { amount: true },
});
```

`date` is a timestamp, so `groupBy(['date'])` groups by instant, not by day — fold the result into
`YYYY-MM-DD` buckets in JS (`row.date.toISOString().slice(0, 10)`, signed by `type`). Cardinality is
bounded by distinct timestamps inside one page's date span (normally ≤ a few dozen; dates are stored
at UTC midnight). Slicing to 10 chars agrees with `formatDate`'s pinned `timeZone: 'UTC'` even if a
row ever carries a non-midnight time. `dayTotals` is keyed by the ISO day, **not** by `formatDate`
output — the client groups rows on `t.date.slice(0, 10)` and uses `formatDate` only for the label.

**Running balance start (Decision 4).** View-relative, _not_ an account-balance query, and — unlike
the summary — it includes payments, transfers and reimbursement income (this is today's behaviour;
do not "fix" it):

```ts
const older = { OR: [{ date: { lt: last.date } }, { date: last.date, id: { lt: last.id } }] };
const olderByType = await prisma.transaction.groupBy({
  by: ['type'],
  where: { AND: [where, older] }, // same `where` as the page query, full scope
  _sum: { amount: true },
});
const runningBalanceStart = sum(INCOME) - sum(EXPENSE);
```

This depends on the page's oldest row, so it is a **second round trip**: the page query runs in
parallel with the summary/count queries, then the balance and day-total queries run once `rows` is
known. Two sequential DB phases per request; accepted. (The alternative — return the whole-scope
signed total once and have the client walk _downward_ from the newest row — saves the round trip but
only works while the loaded rows are a contiguous prefix from the newest, so a failed/retried page
would corrupt every balance below it. `runningBalanceStart` makes each page self-sufficient.)
The client then walks this page's rows oldest-first: `balance += type === 'INCOME' ? +amount :
-amount`, starting from `runningBalanceStart` — identical arithmetic to today's loop.

**One comparator, four places.** `(date desc, id desc)` is used by the page `orderBy`, the keyset
`older`/`after` predicate, the Mode B in-memory sort/slice, and the strictly-older balance predicate.
Any drift between them silently corrupts running balances or skips rows across pages. Define it once
in `lib/transactions/transaction-scope.ts` and derive all four from it.

**Empty result set.** When the page query returns zero rows — a common state, any over-narrow
filter produces it — there is no `last`/`oldestRowOnPage`/`newestRowOnPage` to dereference. Both
modes must short-circuit: skip the balance and day-total queries entirely and return
`rows: []`, `runningBalanceStart: 0`, `dayTotals: []`, `nextCursor: null`, `hasMore: false`, with
`summary`/`desktopCount`/`uncategorizedCount`/`totalCount` still computed normally (the desktop
scope can be non-empty while the full scope is empty). The view keeps today's "No transactions
match. Log one to get started." copy.

**Decimal vs float.** Prisma `_sum` returns `Decimal` (exact); today's client sums IEEE doubles.
Totals over large sets can differ by a cent from today's output. Converting with `Number(...)` at the
service boundary keeps the response shape as today's `number`s. Parity tests should compare to cent
tolerance, not bit equality.

### 6. Cursor design (Decision 5)

- **Total order:** `[{ date: 'desc' }, { id: 'desc' }]`. `id` is a `cuid` primary key, so
  `(date, id)` is a total order and pagination can neither skip nor duplicate a row. Formalizing the
  same-day tiebreak may reorder rows _within_ a single day versus today's undefined ordering — a
  deliberate, edge-case-visible change (Open Question 5), not a regression against any AC.
- **Encoding:** `base64url(JSON.stringify({ d: date.toISOString(), i: id }))` — opaque to the
  client, no schema commitment, trivially decodable in tests. `decodeTransactionCursor` returns
  `null` on malformed input (bad base64, bad JSON, missing/invalid fields) and the service throws
  `ServiceValidationError('Invalid cursor')` -> 400.
- **Keyset predicate** (rows strictly older than the cursor):
  `{ OR: [{ date: { lt: d } }, { date: d, id: { lt: i } }] }`, ANDed with the scope `where`.
  Written explicitly rather than via Prisma's `cursor` + `skip: 1`, so the same expression is
  testable, reviewable, and mirrored exactly by the Mode B in-memory comparator.
- **Load more (Decision 3, page size 50):** `take: limit + 1`; if `rows.length > limit`, drop the
  extra, set `hasMore: true` and `nextCursor = encode({ date, id })` of the 50th (oldest kept) row.
  Otherwise `hasMore: false`, `nextCursor: null`. The client sends the identical filter/period/mobile
  params plus `cursor=<nextCursor>` and **appends** the returned rows.
- **Stale cursor:** a well-formed cursor whose row no longer matches (deleted, edited, filters
  changed) is _not_ an error — the keyset comparison is positional, so the next page simply starts
  from the first still-matching row older than that `(date, id)`. Mode B uses the same comparator on
  the in-memory list for exactly this reason (no index/membership lookup).
- The client must discard `cursor` whenever the filter/period/mobile request key changes (§7).

### 7. Component changes (`components/transactions/transactions-view.tsx`)

The ui-designer pass owns the interaction/visual spec. This section is the data contract they design
against.

**Props**

```ts
{
  initialPage: TransactionsPageResult;   // SSR page 1, from app/(protected)/transactions/page.tsx
  initialRequestKey: string;             // the serialized scope that produced it
  accounts: FrontendAccount[];           // unchanged
  categories: FrontendCategory[];        // unchanged
}
```

**Moves to server-fetched** (deleted from the component): the `filtered` array,
`matchesTransactionFilters` + period filtering, `summary`/`net`, `sortedAsc` + the
`runningBalance` Map, `groupByDay` over the full set, `filtered.length`, `uncategorizedCount`,
`mobileFiltered`/`mobileDays`, and the per-day `rows.reduce(...)` day totals in both trees.

**Stays client-side:** every piece of UI state — drawer/dialog open+key state, `detail`,
`confirmDeleteId`, `deletePending`, `matchPending`/`matchResult`; the URL as filter source of truth
(`parseTransactionFilters` / `transactionFiltersToSearchParams` / `countActiveFilterGroups`);
`payeeDraft` and its 300 ms debounce; `periodMode`/`periodAnchor` and all of `lib/statement.ts`'s
period math (unchanged — the computed `period` is _sent_ to the server, not recomputed there);
`mobileSearch`/`quickFilter` as inputs (their _effect_ moves to the request); the `formatDate` day
label; row rendering.

**Server-side `searchParams` adapter.** `parseTransactionFilters` takes a `URLSearchParams`, but
the page component receives an async `searchParams` prop of plain values (a value may be
`string | string[] | undefined`) — read the App Router page-props guide in
`node_modules/next/dist/docs/` before writing it. So: `await searchParams`, build a
`URLSearchParams` from it (first value wins for arrays, skip `undefined`), then feed the existing
`parseTransactionFilters`. One parser for the URL contract on both client and server — do not
hand-roll a second reader in `page.tsx`.

**New client state:** `pages: TransactionsPageResult[]` (page 1 + appended pages), `loading`,
`loadingMore`, `error`, `reloadNonce`. Rendered rows = `pages.flatMap(p => p.rows)`. Scope-level
values (`summary`, `desktopCount`, `totalCount`, `uncategorizedCount`) come from `pages[0]`;
`dayTotals` merge across pages by day key (**overwrite, not add** — each is already an authoritative
full-day total). Running balance is recomputed per page from that page's own `runningBalanceStart`.
Day grouping keys on `t.date.slice(0, 10)`; `formatDate` renders the header label.

**Three fetch rules — write them exactly, they are the part most likely to be re-derived wrongly:**

1. **The SSR payload is consumed once.** `requestKey` = stable serialization of
   `{ filters-with-payeeDraft, period, mobileSearch, quickFilter, reloadNonce }`. On mount the
   client adopts `initialPage` for `initialRequestKey` and thereafter owns all fetching, ignoring
   later `initialPage` prop changes. A `requestKey` change **unconditionally** resets `pages` to
   `[]`, drops any cursor, and fetches page 1 (previous rows may stay on screen while the request is
   in flight — ui-designer's call). Every response carries its originating key; stale responses are
   dropped (`AbortController` + key check). Mutations (create/update/delete/match-transfers) bump
   `reloadNonce` to refetch the list; `router.refresh()` stays only for the rest of the page.
2. **Per-keystroke filtering becomes debounced + network.** Today `payeeDraft` narrows the list with
   zero latency (there is a code comment explaining exactly that). Server-side it becomes ~300 ms +
   a round trip, with the previous rows held visible. This is a deliberate, user-visible change:
   the tester must not assert per-keystroke narrowing, and the ui-designer needs a pending state.
   The same applies to `mobileSearch`, which should get the same 300 ms debounce (it has none today).
3. **The debounced URL push costs one redundant query.** The client fetch fires on key change; the
   URL push 300 ms later re-renders the server component with the _same_ scope. Accept it — the
   redundant SSR result is ignored by rule 1, and dropping the URL push to avoid it would break the
   bookmarkable-URL contract (AC 9).

**Load more:** one action at the end of the list, enabled when `pages.at(-1)!.hasMore`; it fetches
with `cursor = pages.at(-1)!.nextCursor` and the current key, appends the page, and never resets
scroll. Failures set `error` and leave the loaded rows intact (retryable).

**Two scopes in one DOM — why `desktopCount`/`summary`/`uncategorizedCount` are separate fields.**
The component renders the desktop tree _and_ the mobile tree simultaneously (CSS decides which is
visible), and today they show different row sets (`filtered` vs `mobileFiltered`). One request can
only return one row set, so: **rows/`dayTotals`/`totalCount`/`runningBalanceStart` use the
mobile-inclusive scope; `summary`, `desktopCount` and `uncategorizedCount` use the mobile-omitting
scope.** That reproduces today's numbers exactly at both breakpoints — the summary bar and count
label are desktop-only and desktop-scoped, `uncategorizedCount` is over `filtered` not
`mobileFiltered` (today's behaviour), and the mobile count line is over the mobile scope. The one
residual divergence: a user who types into the mobile search box and then widens past `lg` sees the
desktop _list_ narrowed by that search (today it would not be), because there is only one row set.
Mobile inputs are unreachable above `lg` and the scopes are identical whenever the mobile params are
at their defaults, so this is an accepted edge case, called out rather than discovered.

### 8. Migration / rollout risk

- **`listTransactions` is not modified** — same signature, same `ListTransactionsQuery`, same
  `FrontendTransaction[]` return, same `orderBy: { date: 'desc' }`, same `lte: query.to` date
  semantics. `app/(protected)/import/history/[id]/page.tsx`'s `listTransactions(userId, { batchId: id })`
  is therefore untouched: it does not import the new module, the new function does not accept
  `batchId` (batch scoping is not a Transactions-page filter), and the new day-inclusive `from`/`to`
  handling lives only in `buildTransactionWhere`. The batch-detail page stays on the simple-array
  behaviour per the plan's non-goals. Its existing tests (`tests/unit/services/transactions.test.ts`,
  9 `listTransactions` call sites) must keep passing **unchanged** — treat any edit to them as a
  signal the contract was broken.
- If `include`/`toFrontend` are moved to a shared module, `listTransactions` must keep producing a
  byte-identical shape; the existing `toFrontend` tests are the guard.
- **`GET /api/transactions`** is backwards compatible: without `paginated=1` the handler behaves
  exactly as today (array response, `listTransactionsQuerySchema`). No in-repo consumer of that GET
  exists, but the contract is preserved anyway.
- **Feature-flag / rollout:** none needed; the change is a single-page swap with no data migration
  and no background job. Revert is a git revert.
- **Perf watch item:** Mode B scans the whole filtered scope. If that ever becomes a problem it is a
  contained, later optimization inside `getTransactionsPage` — no contract change.
- **Hydration:** `page.tsx` must serialize `Date`-free data only. `FrontendTransaction` already uses
  ISO strings; `DayTotal.day` is a string and all totals are `number`s, so the envelope is
  serializable as-is. `periodStart`/`periodEnd` cross the wire as ISO strings in query params.

### 9. Schema impact

**No `prisma/schema.prisma` change is required, and none is proposed.** Concretely:

- No new column. `isReimbursementIncome` stays derived from `reimbursementIncomeLinks`, and §5 shows
  the relation filter is legal inside `groupBy`, so nothing needs denormalizing.
- No new index is _needed_. The existing `@@index([userId, date])` serves both the `userId` scoping
  and the `date desc` ordering/range for the page query, the keyset predicate, and every aggregate;
  the `id` tiebreak only requires sorting rows that share one `date` (a handful).
- **Flagged, not proposed:** `@@index([userId, date, id])` would turn the page query into a pure
  index scan and remove that residual per-day sort. It is a measurable-later optimization, and
  adding it would need a migration and therefore **explicit task authorization** per CLAUDE.md's
  "never change `prisma/schema.prisma` or migrations unless the task explicitly requires it". Do
  **not** add it as part of this work. If profiling on a realistic dataset later shows it matters,
  raise it as its own authorized task.
- `npm run prisma:generate` is therefore **not** needed for this feature.

### 10. Implementation checklist

- [x] `lib/transactions/transaction-scope.ts`: `TransactionScope`/`QuickFilter` types, the
      `(date desc, id desc)` comparator, cursor encode/decode, `isAmountSubstringCandidate`,
      `needsExactStringMatch`, `dayKey`
- [x] Probe whether Prisma 6.19.3's `contains` escapes `%`/`_`; fix `needsExactStringMatch`
      accordingly and record the finding in this doc
- [x] `lib/validators/transactions.ts`: add `transactionsPageQuerySchema` + `TransactionsPageQuery`
      (leave `listTransactionsQuerySchema` untouched)
- [x] Export `include` + `toFrontend` from `lib/services/transactions.ts` (or lift to a shared
      module) with no change to `listTransactions`' output shape
- [x] `lib/services/transactionsPage.ts`: `buildTransactionWhere` (desktop/mobile variants, `AND`
      array for date + payee clauses, no `skippedAt` clause)
- [x] `getTransactionsPage` Mode A: page query (`take: limit + 1`), keyset clause, counts, summary
      double-`groupBy` + JS fold, day-total `groupBy` + UTC-day fold, strictly-older balance
      `groupBy`
- [x] `getTransactionsPage` Mode B: lean scan, JS payee/amount predicate, comparator-based slice,
      id-hydration with explicit `orderBy`, all aggregates folded in JS
- [x] Skip the desktop-scope duplicate queries when the mobile params are at their defaults
- [x] `app/api/transactions/route.ts`: `paginated=1` branch; legacy path byte-identical
- [x] `app/(protected)/transactions/page.tsx`: build scope from `searchParams`, fetch page 1, pass
      `initialPage` + `initialRequestKey`
- [x] `components/transactions/transactions-view.tsx`: remove the client filter/aggregate pipeline,
      add `pages`/`loading`/`error`/`reloadNonce`, the three fetch rules, Load more, `dayTotals`
      merge-by-overwrite, per-page running-balance walk
- [x] Comment on `matchesTransactionFilters` recording it is off the render path and retained as the
      parity oracle
- [x] `tests/unit/services/transactionsPage.test.ts` + e2e regressions per the tester's plan
- [x] `npm run format:fix && npm run lint`, `npm run test`, `npm run test:e2e`
- [x] Update this doc's top checklist as the passes complete

### 11. Implementation notes (senior-developer pass)

Where the implementation departs from, or had to choose within, the sections above. Each one is
flagged here so the review pass checks it against the code instead of rediscovering it.

**Deviations from the written contract**

- **Money leaves the service as strings, not `number`s.** `TransactionSummary.*` (including
  `net`), `runningBalanceStart` and `DayTotal.total` are `toFixed(2)` strings summed in integer
  cents (`toCents` from `lib/services/reimbursements.ts`). §2 specified `number`, but the repo's
  money convention is "Decimal in Prisma, serialized to strings at the service edge, never a
  float". That convention is followed everywhere else (`FrontendTransaction.amount`, budgets,
  overview). Cents arithmetic also removes §5's "parity to cent tolerance" caveat, since the totals
  are exact. The unit tests assert exact strings, for example `'380.00'`, and use real
  `Prisma.Decimal` mocks. The client parses them with `Number(...)` for sign checks and walks the
  running balance in cents.
- **`TransactionsPageRequest.cursor` is the opaque string, not a decoded `TransactionCursor`.**
  §2's type and §3's prose disagreed. §3 wins: the route passes the string through, and
  `getTransactionsPage` decodes it and throws `ServiceValidationError('Invalid cursor')` before any
  query runs.
- **Every filter clause goes in the single `AND` array, not only date and payee.** `categoryId`
  (`categoryIds` plus `uncategorizedOnly` plus the Uncategorized pill) and `type` (type filter plus
  the Spending/Income pills) are also constrained twice, so top-level keys would silently
  overwrite each other. Default filters still produce exactly `{ userId }` with no empty `AND`.
- **"SSR payload consumed once" (§7 rule 1) was relaxed for refreshes.** The layout's `?overlay=add`
  drawer and mobile "Log a spend", the `useTransactionForm` hook, and the reimbursement panel all
  mutate and then call `router.refresh()` from outside `TransactionsView`. If later `initialPage`
  props were ignored outright, a transaction added through the overlay would never appear.
  `mobile-transaction-filters.spec.ts` adds rows exactly that way. The rule as built is: a new
  `initialPage` whose `initialRequestKey` equals the previous SSR key, and whose serialized content
  differs from the previous SSR page, is a refresh. It bumps `reloadNonce` and refetches the current
  full scope, including period and mobile params. An identical re-render is ignored. Opening or
  closing `?overlay=add` produces one, and treating it as a refresh would collapse Load-more'd
  pages (AC 10), which e2e case "10 (AC 10)" covers. A new `initialPage` for a different URL scope
  is the echo of our own URL push, so it is ignored too. §7 rule 3's redundant query therefore stays
  a single SSR render, and there is no extra client fetch (e2e case 11 asserts exactly one request).
  Delete, Match transfers, and finishing the in-view edit drawer bump `reloadNonce` explicitly. The
  edit drawer needs this because an edit to a row past page 1 can leave page 1 unchanged. The cost
  is that Cancel in the edit drawer also refetches, which resets the list to page 1. Their
  `router.refresh()` can add one superseded, aborted fetch, which is accepted.
- **Period params follow the code contract, not the prose.** `periodStart` and `periodEnd` keep
  §3's both-or-neither and start-before-end refines, which return 400. The prose's "degrades to All
  time" is not implemented. These values are client-computed and never appear in a bookmarkable
  URL, so the stale-bookmark leniency argument doesn't apply to them.

**Judgment calls within the contract**

- **`buildTransactionWhere` itself omits the text terms Prisma can't express faithfully.** These
  are a `%`/`_` desktop payee, and an amount-shaped or `%`/`_` mobile search. Omitting them in the
  builder, rather than relying on the service to pass a stripped scope, makes "never send a `%`/`_`
  term through `contains`" structural. The JS half of the desktop payee is the exported
  `matchesDeferredPayee`, and the parity suite applies it alongside the where-interpreter. Mode B's
  scan uses the `mobile: false` predicate, so quick filter and mobile search are applied in JS and
  one scan serves both scopes, as §4 requires.
- **Malformed `from`/`to` are ignored by the builder.** This covers non-`YYYY-MM-DD` strings and
  impossible dates like `2026-02-30`. The SSR page reads the URL through `parseTransactionFilters`,
  which does no date validation, so without this a hand-edited `?from=garbage` would crash the page
  with a Prisma invalid-date error. That would break AC 9's "never crash on a stale URL".
- **The reimbursement share is clamped to `[0, cell total]`.** This handles the case where a
  `reimb` sum exceeds its cell's `all` sum. That case violates an invariant but the code can reach
  it, and the clamp keeps credit/debit from going negative. It is pinned by a unit test.
- **New module `lib/transactions/transactions-page-query.ts`.** It holds `TRANSACTIONS_PAGE_SIZE`,
  `transactionsPageSearchParams(scope)` and `transactionsPageUrl(scopeKey, cursor)`. The SSR page
  and the client view build the request key through this one serializer, so "is the SSR page still
  current?" is a string compare. It lives in its own file so the already-verified
  `transaction-scope.ts` stays untouched.
- **`getJSON` gained an optional `{ signal }`.** This is an additive change to `lib/api-client.ts`,
  and existing callers are unchanged. Superseded page-1 fetches are aborted, and their late
  responses are dropped on the aborted flag.
- **Fixed a payee debounce echo-guard race (the #64 guard).** The single `lastPushedPayee` echo
  guard was replaced by a queue of pending URL pushes plus a URL-target ref. Here is the race:
  type, pause (settle and push), then clear while that push's RSC round trip is still in flight.
  The clear compared against the stale URL payee and skipped its own push, which left
  `payee=<old>` in the URL. The list looked right, but a reload or a later Filters Apply brought
  the old search back. The old code had the same stuck-URL race, masked because the list filtered
  on the draft. `transaction-filters-dialog.spec.ts` exposed it once the debounce became real. New
  e2e case 11b holds RSC navigations in flight to cover both this race and the original #64
  "snap back mid-word" race.
- **Load-more rules.** Load more is hidden while a scope fetch is pending or has failed, so a
  cursor is never replayed against a different key. After an `invalid-request` (400) failure,
  "Try again" bumps `reloadNonce`, which refetches page 1 without the cursor. After a `network`
  or 5xx failure, it retries the same cursor. This is the error-kind discriminator from UI Design
  §7.
- **Scope-change failure** (UI Design §6 interim) shows `Couldn't load transactions. Try again.`
  with `role="alert"` and a "Try again" button that retries the same key. It renders in both trees
  and lifts the dim.
- **Scroll-to-list-top** fires only when the scope changed, never on a nonce-only reload, so a
  delete deep in a Load-more'd list doesn't yank the viewport. It fires only when the list's top
  is above the viewport.
- **The search-pill spinner** (`data-pending` on `transactions-search-desktop`/`-mobile`) shows for
  any in-flight page-1 fetch, not only search-triggered ones. This is one pending signal, matching
  UI §3's "one rule for scope-loading".
- **Focus after Load more:** focus goes back to the button via `requestAnimationFrame` when more
  remain, because Chrome blurs a focused button when it becomes `disabled`. When the list is
  exhausted, focus moves to the `tabindex="-1"` status line
  (`transactions-load-status-desktop`/`-mobile`).
- **Test selectors added (no visual change):** `transactions-summary`,
  `transactions-list-desktop`/`-mobile` (both carry `aria-busy`), `transaction-day-desktop`,
  `transaction-day-total`, `running-balance`, `transactions-search-desktop`/`-mobile`, and
  `transactions-load-status-desktop`/`-mobile`.
- **e2e seeds 105 same-day rows, not 55.** A third page is needed so that both focus cases are
  exercisable: focus staying on the button while more remain (13a), and moving to the status line
  on exhaustion (13b). All 105 rows fall on one day, so the page boundary cuts through a day group
  (case 9) and every running balance can be computed by hand (case 7).
- **Existing e2e specs changed:**
  - `transaction-filters-dialog.spec.ts`: debounce-aware. The comment is updated, the search now
    awaits the `paginated=1` response, and the assertions are unchanged.
  - `transaction-batch-indicator.spec.ts` and `import-undo.spec.ts`: their CSV rows are dated
    2026-03-01, which lands past row 50 of the shared dev history. They now visit
    `/transactions?payee=<their payee>`. Without that, import-undo's "row is gone" check would have
    passed vacuously. The assertions themselves are unchanged. batch-indicator's "chip doesn't
    navigate" check now compares against the exact list URL, which is stricter than the old
    `/transactions$`.
- **e2e teardown:** `transactions-pagination.spec.ts` deletes its accounts (cascading their
  rows), its category and its reimbursement link in `afterAll`, so the shared dev user isn't left
  with a new set of accounts after every run.
- **Mode B ran live against Postgres**, not only against mocks. The spec calls the API with the
  existing session: an amount-shaped search pages 105 rows as 50/50/5 with no skipped or duplicated
  row, a literal `payee=%` or `payee=_` returns `totalCount: 0`, which is the live proof of the
  probe's consequence, and a malformed cursor returns 400.
- **Not verified:** the mobile safe-area occlusion check that UI Design §1 asks for. It needs a
  real device or emulator with a non-zero `safe-area-inset-bottom`. `pb-20` is unchanged, and the
  existing `mobile-fixed-bottom-stacking.spec.ts` ("the last transaction row clears the fixed
  bottom nav") still passes.

**Verification status (senior-developer pass)**

- `npm run format:fix && npm run lint` and `npx tsc --noEmit` are clean. `npm run test` passes: 57
  files, 867 tests.
- e2e was run with a scratch Playwright config on port 3103 because port 3000 is used by an
  unrelated project. The config was deleted afterwards, and the checked-in `playwright.config.ts`
  is unchanged.
  - `transactions-pagination.spec.ts`: 21/21 pass.
  - Every spec that visits `/transactions` passes: `transaction-filters-dialog`,
    `mobile-transaction-filters`, `transaction-batch-indicator`, `import-undo`,
    `add-transaction-sidebar`, `mobile-add-transaction`, `mobile-overflow`,
    `mobile-fixed-bottom-stacking`, `categorize-dropdown-skip`, `mobile-day-panel` and
    `settings-data-management`.
  - `import-history` also passes, unmodified.
  - The unrelated specs pass too: `confirm-dialogs`, `import-duplicate-filename`, `login`,
    `ai-categorization-settings`, `ai-suggest-categorize`, `mobile-shell`, `mobile-period-sheet`,
    and `email-verification`.
  - Two specs fail for environment reasons and don't touch this change. In `signup`, "hides the
    Google option when it is not configured" fails because the local `.env` sets
    `AUTH_GOOGLE_ID`. In `reminders-settings`, 4 tests fail because there are no VAPID keys in the
    local `.env`.
- **The e2e suite no longer runs in one pass against the dev user.** Phase 2's login rate limit
  (`login:email`, 10 per 15 minutes) trips partway through, because most specs log in once per
  test as `dev@example.com`. For this pass, the specs ran in batches, and the local dev DB's
  `RateLimitBucket` login/signup rows were cleared between batches. That is local data only, and no
  code or config changed. A shared e2e login (storage state) or an e2e-only limit is worth a
  follow-up. It was not done here because it is out of scope.
- The known "transfers excluded" mobile copy bug is untouched (Decision 10). Only a comment marks
  it.

## UI Design

UI-designer pass. Implements Decision 3 (Load more, page size 50) and the pending-state requirement
from §7 rules 2-3 above; no architecture/service contracts are reopened here. Verified against the
current `components/transactions/transactions-view.tsx` (762 lines), `components/transactions/period-picker.tsx`,
`components/settings/reminders-section.tsx` (repo's `pending`-boolean idiom), `components/ui/button.tsx`
(`loading` prop swaps its icon for `Loader2` + `animate-spin`), and the token set in `app/globals.css`
(`--paper`/`--paper-raised`/`--paper-sunk`, `--line`, `--iris`/`--iris-soft`, `--sky`/`--sky-soft` for
income, `--rose`/`--rose-soft` for expense; utility classes `bg-paper-raised`, `border-line`, `text-sky`,
`text-rose`, `bg-iris`, `bg-rose-soft`, `font-mono tabular-nums`, `font-money`). No new component
library, no Radix — this spec only recombines `Button`, `Money`, plain Tailwind, and one new small
presentational unit (the Load-more row).

### 0. Reused vs. new

**Reused, unchanged:** `Drawer`, `ConfirmDialog`, `TransactionFiltersDialog`, `MatchTransfersDialog`,
`PeriodPicker`, `Money`, `Button` (its existing `loading` prop is exactly what the Load-more control
needs). No new modal/dialog is introduced — no `<dialog>`/`Modal`/`Drawer` focus-management notes
apply beyond what's already in the codebase, because nothing here opens a dialog.

**New, presentational only (no new abstraction, no library):**

- **Load-more row** — a single element rendered once at the end of _each_ tree (desktop and mobile
  render their own copies; see §2). Not a new file necessarily — small enough to inline in
  `transactions-view.tsx`, but named here as a distinct unit because it has three states.
- **Scope-loading overlay treatment** — a `data-` / class toggle applied to the _existing_ summary
  bar, count label, and list wrapper elements, not a new component.
- **Search-pending indicator** — swaps the existing `Search` icon for `Loader2` inside the existing
  search pill (desktop) and the existing search pill (mobile). No new markup shape, same pill.

Everything else — row markup, day-group header markup, quick-filter pills, filter button, category
chips — is **visually unchanged**. This is a data/interaction-state spec, not a redesign, per the
architecture doc's non-goals.

**Deliberate carry-over, not a bug to "fix":** the desktop tree currently formats money inline
(`Number(summary.credit).toFixed(2)`, the day-total header, the amount column, the running-balance
column) rather than through `<Money>`, while the mobile tree already uses `<Money>` throughout. This
spec does not change that inconsistency — touching it is a visual/redesign change forbidden by the
architecture doc's non-goals ("no redesign of ... list layout/visual design"). Implementers must not
"helpfully" convert the desktop inline formatting to `<Money>` as a side effect of this work; if it's
wanted, it's a separate, explicitly-scoped follow-up.

### 1. Component tree / structural changes

No new file is required. Structural diff inside `TransactionsView`:

```
TransactionsView
├── (desktop) filter row, summary bar, count label   — now scope-loading-aware (§3)
├── (desktop) day-group list                         — rows now come from pages.flatMap(...)
│     └── … existing day groups …
│     └── [NEW] Load-more row (desktop)               — idle | loading | (unmounted when !hasMore)
├── (mobile) search + quick-filter pills + count line — now scope-loading-aware (§3)
├── (mobile) day-group list                           — rows now come from pages.flatMap(...)
│     └── … existing day groups …
│     └── [NEW] Load-more row (mobile)                — idle | loading | (unmounted when !hasMore)
├── existing Drawers / ConfirmDialog / dialogs — unchanged
└── existing fixed bottom CTA bar — unchanged, see mobile-occlusion note below
```

**Two Load-more rows, not one.** The component renders the desktop tree (`hidden lg:block`) and the
mobile tree (`lg:hidden`) simultaneously in the DOM (CSS decides which is visible, per the
architecture doc's §7 "Two scopes in one DOM" note). Both trees read from the same `pages` state, so
both Load-more rows are driven by one `hasMore`/`loadingMore`/`error`, but each tree renders its own
row, styled to match its own list (desktop: inside the bordered list card rhythm; mobile: a full-width
pill button matching the quick-filter pill / filters-button visual language). Do not hoist a single
shared Load-more row above the `hidden lg:block` / `lg:hidden` split — it would render for both
breakpoints at once or need its own breakpoint logic duplicated anyway.

**Placement.** The Load-more row sits directly after the last day group, inside the same vertical
rhythm as day groups (desktop: `mt-5.5` spacing like a day-group boundary, but with no day-header
line since it isn't a day; mobile: `mt-5` spacing matching day-group gaps). It is not sticky and does
not float — it scrolls with the list, consistent with "Load more" being an append action, not a
persistent control.

**Mobile occlusion check.** The root wrapper is `pb-20 lg:pb-0` and there is a `fixed` bottom CTA bar
at `bottom: calc(60px + env(safe-area-inset-bottom))`, `z-20`, plus the app's bottom nav beneath that.
`pb-20` (80px) must clear both the CTA bar's own height and the nav; if in practice the CTA bar +
safe-area exceeds 80px on any target device, increase the wrapper's bottom padding (not the Load-more
row's own margin) so the Load-more row — and the last row of the list — is never rendered under the
fixed bar. This must be verified against a real safe-area-inset device or emulator during
implementation, not assumed from the numbers alone.

**Day-group / page-boundary interaction.** A "Load more" click can land mid-day-group: Decision 6
makes day totals a server aggregate independent of page boundaries, and §7 says the client merges
`dayTotals` across pages **by overwrite, not add** — each `dayTotals` entry is already the complete,
authoritative total for that day regardless of how many of that day's rows have been fetched so far.
Concretely:

- **The day-group header total is always complete**, even when only some of that day's rows have
  loaded. There is no "partial day total" state to design — the architecture forbids it by
  construction. Do not sum the loaded rows client-side for the header; always render the `dayTotals`
  value for that day key.
- **No visual distinction between a "fully loaded" and "partially loaded" day group.** The row list
  under a day header simply has however many rows have loaded so far for that day; clicking Load
  more may add more rows to the _existing_ bottom day-group's row list rather than starting a new
  group. This must not create a duplicate day-group header for the same day: when a fetched page's
  first rows share a day key with the currently-last-rendered day group, the new rows are appended
  into that same group (`t.date.slice(0, 10)` match), not rendered as a second header for that date.
  This is the one place a naive "render each page's `dayTotals`/day-groups independently" approach
  breaks — call this out to the implementer explicitly.
- No loading skeleton or "…more today" affordance inside a day group — the appended rows simply
  appear under the existing header once the fetch resolves (see §4 for the live-region announcement
  that substitutes for a visual affordance here).

### 2. Load-more control — states

Rendered only when there's something to say about the tail of the list; never rendered when
`pages.length === 0` is still resolving (that's the initial-load state, §3) and never rendered once
`!pages.at(-1)!.hasMore`.

| State                | Trigger                                                | Visual                                                                                                                                                                                                                                                                                               | Behavior                                                                                                                                                     |
| -------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Idle**             | `pages.at(-1)!.hasMore === true`, no request in flight | `Button variant="secondary"` (existing variant, matches the "Filters" button's visual weight), full-width on mobile / centered on desktop, label `Load more`, no icon                                                                                                                                | Enabled, click fetches next page                                                                                                                             |
| **Loading**          | Load-more request in flight (`loadingMore === true`)   | Same `Button`, `loading` prop set — this swaps the label's leading space for the existing `Loader2` spinner via `Button`'s built-in `loading` behavior; label stays `Load more` (component already disables + dims per its own `disabled:opacity-50`)                                                | Disabled (native `disabled`, from `Button`'s existing `loading` implementation), not clickable, no double-fetch possible                                     |
| **Exhausted**        | `pages.at(-1)!.hasMore === false`                      | **Unmounted** — nothing renders in its place except the live-region status element described in §4 (kept in the DOM, visually empty, for focus purposes)                                                                                                                                             | N/A                                                                                                                                                          |
| **Load-more failed** | The load-more fetch rejects or returns non-2xx         | `Button` reverts to idle visual but the label becomes `Try again`; directly above/below it (mobile: below, matching the reminders-section `role="alert"` placement pattern; desktop: same relative position) a short `text-rose` line: `Couldn't load more transactions. Try again.`, `role="alert"` | Clicking `Try again` retries with the **same** `cursor` (no state lost); already-loaded rows are untouched (§7's "leave the loaded rows intact (retryable)") |

**Copy strings** (exact, for the tester's e2e assertions):

- Idle / retry-idle button label: `Load more`
- Loading button label: `Load more` (spinner replaces the icon slot; do not change the text while
  loading — the disabled+spinner state communicates progress, per `Button`'s existing convention
  used elsewhere in the repo)
- Failed-retry button label: `Try again`
- Failed inline message: `Couldn't load more transactions. Try again.`

**"Exactly 50 results" is not a distinct state.** Because the page query uses `take: limit + 1`
server-side (architecture §6), `hasMore` is authoritative the moment page 1 resolves — there is no
"click once more, then learn there's nothing left" sequence, and no "no more results" terminal
message is shown. The control simply never renders when the true count is a multiple of 50 (or less
than 50). Do not add a "you've reached the end" footer line — it's an extra state with no
information the absence of the button doesn't already convey, and the architecture doesn't hand you
a boundary case that would motivate one.

### 3. Search pending-state design (the 300ms-debounce + round-trip gap)

Applies identically to the desktop payee search pill and the (newly debounced, per §7 rule 2) mobile
search pill. One rule set, two instances.

**Trigger threshold — spinner starts on request-fire, not on keystroke.** The debounce timer itself
(300 ms) shows nothing — no spinner flashes on every keystroke while the user is still typing. The
spinner appears only once the debounced value actually triggers a network request (i.e., at the
300 ms mark when no further keystroke has occurred) and disappears when that request's response is
applied or it's superseded by a newer request. This avoids the flicker of a sub-300ms spinner on
every keypress and matches "don't design a spinner for the debounce, design one for the round trip."

**Where the spinner lives.** In place, inside the existing search pill, replacing the leading
`Search` icon (`lucide-react`) with `Loader2` + `animate-spin` at the same `size={15}` — this is the
exact idiom `Button`'s own `loading` prop already uses elsewhere in the repo, applied here to a
plain input pill instead of a button. No layout shift: same icon slot, same pill width, input stays
focused and editable while the spinner shows (the user can keep typing/backspacing during the
in-flight request; a subsequent keystroke restarts the debounce and, per the fetch rules, the
in-flight response is dropped when it lands because it no longer matches `requestKey`).

**Stale results stay visible during the fetch — do not clear or skeleton the list.** Per architecture
§7 rule 1 ("previous rows may stay on screen while the request is in flight — ui-designer's call"):
they stay. Rationale: a 300ms-debounce keystroke search is a "narrowing," and clearing to empty/
skeleton on every keystroke reads as broken far more than briefly-stale rows do. Concretely:

- The moment a request fires (matching the spinner-trigger threshold above), apply a **scope-loading
  dim** to every scope-derived region at once: the summary bar (credit/debit/net + excluded chips),
  the count label, and the row list — `opacity-60` (the repo's existing dim idiom, used in
  `reminders-section.tsx`'s toggle) plus `pointer-events-none` on the list only (so a stale row can't
  be clicked into the detail drawer mid-swap; the summary bar has no click targets so it only needs
  the opacity). Do **not** apply the dim to the search input itself, the Filters button, the Period
  Picker, or the quick-filter pills — those remain fully interactive so the user can keep adjusting
  filters while a previous request resolves.
  - Also set `aria-busy="true"` on the list container and the summary-bar container for the duration.
- When the response for the **current** `requestKey` lands, remove the dim, swap in the new rows/
  summary/counts in one paint (no intermediate empty frame).
- If a **newer** keystroke supersedes an in-flight request (see architecture §7 rule 1's
  `AbortController` + key check), the superseded response is discarded silently — the dim stays
  active (a new request is presumably about to fire or has already fired) until the eventually-
  current request resolves.

**Scope-change dim is the same treatment as search.** Any `requestKey` change — filter dialog Apply,
period switch/prev/next, quick-filter pill tap, mobile search, or a `reloadNonce` bump from a mutation
— uses this identical dim treatment, not a separate "filter changed" visual. One rule, applied
uniformly, is simpler to implement and to test than a matrix of near-identical loading treatments.

### 4. Interaction states — filter/period change reset

**`pages` resets on every `requestKey` change, unconditionally** (architecture §7 rule 1). UX
specification for that reset:

- **Scroll position: reset to the top of the list** on a `requestKey` change (new filter, period
  change, quick-filter pill, mobile search settling) — the user just changed what they're looking at,
  so showing them the newest matching rows first is correct, not disorienting. Scroll to the top of
  the list container (not necessarily the page — if the filter row/summary bar are still above the
  fold, scrolling `window` to the list's top edge is sufficient; do not force-scroll to `(0,0)` of the
  page if the user was already scrolled past the header controls, since that would also hide the
  Filters/search controls they may still be interacting with).
- **Load more never resets scroll** (architecture §7, "Load more ... never resets scroll") — appended
  rows extend the list below the fold; the user's scroll position stays exactly where it was.
- **Visual treatment during the reset-triggering fetch is the same scope-loading dim from §3** — the
  previous page's rows stay visible, dimmed, non-interactive, while the new page 1 loads; once it
  resolves, `pages` is replaced (not appended) with the single new page 1 result and the dim lifts.
- **No separate "resetting filters" message or skeleton** — the dim + eventual swap is the entire
  affordance, consistent with the "one rule for scope-loading" principle in §3.

### 5. Accessibility

**Focus management on Load-more click.** The button itself is the correct focus target while it
remains mounted — per common accessible load-more-list pattern, focus should move to the _first
newly-loaded row_ when practical, but that pattern assumes rows are keyboard-focusable elements. They
are not: rows are `<div onClick>` with no `tabindex`, `role`, or key handler, and adding that is a
markup/interaction change out of scope for this pass (non-goal: no list-layout/visual redesign; also
not requested by the architecture doc). Given that constraint:

- **While the button remains mounted** (there's still more to load after this click), focus **stays
  on the Load-more button** through the loading state and back to idle — do nothing to move it. This
  matches the button's own native focus retention (it goes `disabled` during the fetch, which some
  browsers visually indicate but does not blur it if it was already focused) — no explicit
  `.focus()` call needed for this case, but the implementer should verify focus isn't lost when the
  `disabled` attribute toggles on Safari/Firefox (a known cross-browser rough edge with disabling a
  focused button) and add `element.focus()` on load resolve if it is.
- **When the button's _own_ click causes it to unmount** (this page was the last one, `hasMore`
  flips to `false`), focus must not silently drop to `<body>`. Move focus programmatically to the
  status element described below (the same element that carries the live-region announcement),
  which must be a real, programmatically focusable node (`tabindex="-1"`) rendered in the Load-more
  row's place once it unmounts — not a `sr-only`-only text node with nothing to focus.
- **On Load-more failure**, focus stays on the button (now showing `Try again`) — no forced move,
  since it's still the same interactive element in the same place.

**Live-region announcements.**

- A visually-hidden (`sr-only`), `aria-live="polite"` status element per tree (desktop/mobile each
  get their own, consistent with each having its own Load-more row) announces:
  - On successful Load more: `Loaded {N} more transaction{s}. {rendered} of {totalCount} shown.`
    where `{N}` is the just-appended page's row count, `{rendered}` is the new total rendered-row
    count (`pages.flatMap(...).length`), and `{totalCount}` uses the tree's own scope (`totalCount`
    for mobile, `desktopCount` for desktop — matching which count label that tree already shows, per
    architecture §7's two-scope split).
  - On the last page loading (button unmounts): same message as above (no separate "that's
    everything" phrasing needed — the count reaching `{totalCount}` already communicates it, and
    Load more not reappearing communicates the rest).
  - On search/filter-scope settling (after the §3/§4 dim lifts): `{rendered} of {totalCount} shown.`
    fired once per settled `requestKey`, not on every intermediate superseded response.
  - On Load-more failure: the inline `role="alert"` message from §2 is sufficient; do not also
    duplicate it into the `aria-live="polite"` region (would double-announce).
- **`aria-busy`**: set to `"true"` on the list container and summary-bar container for the entire
  dim duration described in §3 (covers both search-debounce settling and Load-more fetches padded
  onto the _reset_ case — Load-more itself, being an append not a scope reset, does **not** set
  `aria-busy` on the whole list, only the Load-more button itself goes `disabled`/`aria-disabled`
  via `Button`'s existing implementation).

**Keyboard.** No new keyboard traps or focus loss beyond what's called out above. The search pills,
Filters button, Period Picker, quick-filter pills, and Load-more button are all already-native
focusable elements (`input`, `button`) with the repo's existing `focus-visible:outline-iris
focus-visible:outline-2 focus-visible:outline-offset-2` treatment (visible in `Button`) — nothing
new to add there. Rows stay non-keyboard-reachable, exactly as today; this spec does not fix that
pre-existing gap (flag it as a known, separately-scoped accessibility debt if it comes up in the
tester pass, but it is not part of this feature's contract).

### 6. Empty / edge states

- **No results after filtering** — unchanged copy, both trees: `No transactions match. Log one to
get started.` Keyed on **rendered-row count** (`pages[0]?.rows.length === 0` after the first page
  resolves for the current `requestKey`), not on `desktopCount`/`totalCount` directly — those two
  can legitimately disagree per the architecture doc's accepted mobile/desktop scope divergence, and
  the empty state should reflect what that specific tree would actually render, not the other tree's
  count. No Load-more row renders in this state (`hasMore` is `false` on an empty page by
  construction, per architecture §5's empty-result-set short-circuit).
- **Initial load (first paint before `pages[0]` resolves post-SSR)** — the SSR `initialPage` prop
  means there is no true "loading" flash on first paint; the server already rendered `pages[0]`.
  This state only matters if the initial `searchParams`-derived scope somehow needs a client refetch
  before paint (it shouldn't, per §7's "SSR payload is consumed once"), so no separate initial
  skeleton is designed — treat first paint as already-resolved data.
- **Exactly 50 (or any multiple-of-50) results** — see §2: the Load-more control simply never
  appears; no separate "you're all caught up" state.
- **Fewer than 50 results** — same as above; no Load-more control renders on page 1.
- **Load-more request fails** — §2's Load-more-failed state; loaded rows are untouched, retryable.
- **Scope-change (filter/period/search) request fails** — not explicitly covered by architecture §7
  (which only names Load-more failures as retryable). This is the one gap flagged in §7 below;
  pending that clarification, the interim UI is: keep the previous (pre-change) rows visible with the
  dim lifted (not stuck dimmed forever), and show the same `role="alert"` inline message pattern as
  Load-more failure (`Couldn't load transactions. Try again.`) directly under the summary bar, with a
  `Try again` action that retries the same `requestKey`. This does not invent new copy beyond
  reusing the Load-more failure pattern, but the exact retry mechanics depend on the error-shape
  clarification requested below.
- **Malformed/expired cursor mid-session** (e.g. the user leaves the tab open for a long time, comes
  back, clicks Load more, and the server can't decode/resolve something) — per architecture §6, a
  _stale-but-well-formed_ cursor is never an error (positional keyset degrades gracefully), so this
  reduces to an ordinary Load-more-failed case only if the request itself 400s or 5xxs, not a distinct
  UI state.

### 7. Props contract confirmation

**Mostly sufficient.** `TransactionsPageResult` (rows, `nextCursor`, `hasMore`,
`runningBalanceStart`, `totalCount`, `desktopCount`, `uncategorizedCount`, `summary`, `dayTotals`)
carries everything this spec's states need: the count-label copy in §6, the live-region text in §5,
the day-total-is-always-complete behavior in §1, and the Load-more control's enabled/disabled state
in §2.

**One gap to close before implementation, so the tester and senior-developer aren't stuck
reconciling two docs:** architecture §7 states "Failures set `error` and leave the loaded rows
intact (retryable)" as a single blanket rule, but this pass needs the client to distinguish two
different failure shapes to implement §2/§6 correctly:

1. **A malformed/invalid request** (e.g. `cursor` fails validator decode -> `ServiceValidationError`
   -> the route's existing 400 mapping) — this should **not** be silently retried with the same
   (bad) `cursor`; the client should drop the cursor and either re-fetch page 1 for the current
   `requestKey` or, for a Load-more click specifically, surface the failed state from §2 but have
   `Try again` retry _without_ a cursor (equivalent to "start over from the top of what's already
   loaded" rather than replaying the same malformed cursor forever).
2. **A transient/network/5xx failure** — this is squarely what §2's `Try again` (same cursor) and
   §6's scope-change retry are designed for: identical inputs, just retry the request.

**What's needed in the contract, stated precisely:** the client-side fetch wrapper (not the service/
API response shape itself — that's fine as-is) needs to expose an error classification alongside the
`error` state, e.g. `{ kind: 'invalid-request' | 'network' } | null` rather than a bare boolean/
message, so the Load-more retry handler and the scope-change retry handler in §6 can each pick the
correct retry strategy instead of guessing from an HTTP status code re-derived ad hoc in the
component. This is a client-side addition (in `transactions-view.tsx`'s own fetch logic), not a
service/validator change — flagging it here rather than reopening the architecture section, but
calling it out explicitly so it isn't rediscovered independently by whoever implements §2/§6.

Everything else in §7's contract — the two-scope split, the SSR-consumed-once rule, the debounce
rules, the cursor-append mechanics — is sufficient as written for this design; no other additions
are requested.

## Test Plan

Tester pass, before implementation. Acceptance bar for the senior-developer pass per CLAUDE.md's
Agent Workflow. Written against the `## Architecture` and `## UI Design` sections above and against
the current code (`lib/transactions/transaction-filters.ts`, `lib/services/transactions.ts`,
`lib/statement.ts`, `app/api/transactions/route.ts`, `lib/validators/transactions.ts`,
`components/transactions/transactions-view.tsx`, `tests/unit/lib/transaction-filters.test.ts`,
`tests/unit/services/budgets.test.ts`, `tests/e2e/transaction-filters-dialog.spec.ts`,
`tests/e2e/mobile-transaction-filters.spec.ts`).

**Discrepancy flagged, not silently worked around:** the task prompt and the architecture doc's
File Breakdown both reference `tests/e2e/match-transfers-dialog.spec.ts` as an existing spec to read
for conventions. It does not exist in `tests/e2e/`. There is a `MatchTransfersDialog` component and
a `match-transfers` route, but no e2e spec covers it today. The plans below only reference specs that
actually exist (`transaction-filters-dialog.spec.ts`, `mobile-transaction-filters.spec.ts`,
`transaction-batch-indicator.spec.ts`, `add-transaction-sidebar.spec.ts`,
`mobile-add-transaction.spec.ts`). If a match-transfers e2e spec is wanted, it is a separate,
explicitly-scoped addition, not assumed here.

**Where the `%`/`_` probe result must be recorded.** Three items below (the `needsExactStringMatch`
unit case, the `'100% Coffee'` parity case, and the "what NOT to test" LIKE-escaping exclusion) are
explicitly contingent on the implementation checklist's "probe whether Prisma 6.19.3's `contains`
escapes `%`/`_`" step. The senior-developer must record that finding as a named subsection —
`### Probe result: Prisma 6.19.3 \`contains\` escaping`— appended directly under`### 4. Two-phase
amount-substring search (Decision 2)`in the Architecture section above, stating the query run, the
result observed, and which branch of`needsExactStringMatch` was kept as a result. The review pass
checks the implemented tests against that written finding, not against a guess.

### 1. Unit test plan

**New file: `tests/unit/lib/transaction-scope.test.ts`** (pure module, no Prisma — follow
`tests/unit/lib/transaction-filters.test.ts`'s plain `describe`/`it` style, no `vi.hoisted` needed).

`encodeTransactionCursor` / `decodeTransactionCursor`:

- Round-trip: `decodeTransactionCursor(encodeTransactionCursor({ date, id }))` returns an
  equal `{ date, id }` (compare `date.getTime()`, since `Date` objects aren't `toEqual`-safe across
  a JSON round trip unless the decoder re-hydrates a `Date`).
- `decodeTransactionCursor('')` returns `null`.
- `decodeTransactionCursor('not-base64url-!!!')` returns `null` (malformed base64).
- `decodeTransactionCursor(base64url('not json'))` returns `null` (valid base64, invalid JSON).
- `decodeTransactionCursor(base64url(JSON.stringify({ d: 'not-a-date', i: 'x' })))` returns `null`
  (invalid date field).
- `decodeTransactionCursor(base64url(JSON.stringify({ i: 'x' })))` returns `null` (missing `d`).
- `decodeTransactionCursor(base64url(JSON.stringify({ d: new Date().toISOString() })))` returns
  `null` (missing `i`).

`(date desc, id desc)` comparator (whatever it's named/exported, e.g. `compareTransactionOrder`):

- Two rows with different dates: the later date sorts first (returns negative/positive consistent
  with the doc's stated direction — assert the _sign convention_ the implementation picks, then hold
  it fixed; don't just assert "not equal").
- Two rows with the same date: the row with the lexicographically/numerically larger `id` sorts
  first (cuid string comparison — assert with two concrete ids, not just "differs").
- Two rows identical on both `date` and `id` (should never happen with real cuids, but the
  comparator must be well-defined): returns `0`.
- Used consistently as both a `.sort()` comparator (Mode B in-memory sort) and a strictly-older
  predicate: add one case that feeds the comparator's output into a manual "is `a` older than `b`"
  check and asserts it matches the sign the keyset `OR` clause is built from — this is the one place
  a sign inversion would silently corrupt pagination without any single unit test catching it in
  isolation, so pin the exact relationship (e.g. `comparator(a, b) > 0` implies `a` is newer than
  `b`, matching `orderBy: [{ date: 'desc' }, { id: 'desc' }]`).

`isAmountSubstringCandidate` / `needsExactStringMatch` (or whatever the shape-test/`%`+`_` detector
ends up named — the plan calls out two predicates in §4, cover both under whatever names land):

- `''` (empty/whitespace-only search term) → not a Mode B trigger (Mode A, `payee contains ''` is
  the desktop no-op case — confirm the empty string doesn't accidentally satisfy the digits/dot
  regex).
- `'12.50'` → amount-shaped → Mode B.
- `'.'` and `'12.5.0'` (multiple dots, still `[0-9.]+`) → amount-shaped → Mode B (the regex is
  `/^[0-9.]+$/`, not a strict decimal grammar — assert the implementation matches that, not a
  stricter parse).
- `'Coffee'` → not amount-shaped, no `%`/`_` → Mode A (payee `contains`).
- `'100%'` → contains `%` → Mode B, **even though it's also amount-shaped** (both conditions agree
  here; still assert Mode B, not just "amount-shaped implies Mode B" via a different path).
- `'Whole_Foods'` → contains `_` → Mode B (this is the desktop-`payee`-safety case from §4; assert
  the same predicate fires for a term with no digits at all).
- **Depends on the Decision 10 implementation-checklist item "probe whether Prisma 6.19.3's
  `contains` escapes `%`/`_`"**: if the probe finds `contains` _does_ escape, the `%`/`_` branch is
  removed per the doc's own instruction ("if it does, drop the `%`/`_` condition"). Whichever way
  it lands, this unit test file must match the doc's finding — flag it back to the tester/architect
  if the two disagree at review time, don't let the review pass discover it as an "undocumented"
  behavior change.

`dayKey`:

- A UTC-midnight `Date` (e.g. `2026-06-15T00:00:00.000Z`) → `'2026-06-15'`.
- A non-midnight `Date` (e.g. `2026-06-15T23:00:00.000Z`, defensive case per §5's "even if a row
  ever carries a non-midnight time") → still `'2026-06-15'`, i.e. it slices/derives from the ISO
  string the same way the client's `t.date.slice(0, 10)` does, not from local time. Add one case at
  a boundary the local-time bug class would catch: a `Date` whose _local_ representation (if tests
  ever ran in a non-UTC TZ) would be a different calendar day than its UTC date — e.g. construct via
  `new Date(Date.UTC(2026, 5, 15, 23, 0, 0))` and assert `'2026-06-15'` regardless of `TZ` env var
  (vitest config should already pin `TZ=UTC`; if it doesn't, that's a review-pass finding, not
  something to silently work around here).

**New file: `tests/unit/services/transactionsPage.test.ts`.** Prisma fully mocked via `vi.hoisted`,
following `tests/unit/services/budgets.test.ts`'s style **but escalated**: `getTransactionsPage`
calls `findMany` (1-2x), `count` (1-3x) and `groupBy` (2-4x) _in the same test_, so a single
`mockResolvedValue` per method cannot distinguish calls — **use `mockImplementation` dispatching on
the call's `args`** (e.g. switch on `args.by` array identity/contents for the three different
`groupBy` shapes — summary's `['type','isPayment','isTransfer']`, day-totals' `['date','type']`,
running-balance's `['type']` — and on the presence/absence of `args.where.AND[].OR` or
`args._count`/`select` shape to distinguish the two `findMany` calls and three `count` calls). State
the call order explicitly in each test's setup so a `mockResolvedValueOnce` chain is also viable
where dispatch-on-args would be more code than the test is worth — either technique is acceptable,
but **not** a bare `mockResolvedValue` shared across distinguishable calls; that produces a test that
would still pass if the service called the wrong query shape.

**`buildTransactionWhere`** (`options.mobile: false` vs `true`), one `it` per row of the
architecture's clause-mapping table, each asserting the exact clause shape (not just "narrows the
result," since this function's contract _is_ its output shape — parity coverage against
`matchesTransactionFilters` is a separate concern, part 2 below):

- `userId` always present, regardless of any filter state.
- Default/empty filters → `where` has no filter clauses beyond `userId` (and no empty `AND: []`
  noise that would still technically match everything but signals a builder bug).
- `payee: '  Coffee  '` (leading/trailing whitespace, matching `matchesTransactionFilters`'s
  `.trim()`) → `payee: { contains: 'Coffee', mode: 'insensitive' }`, not `'  Coffee  '`.
- `payee: ''` (whitespace-only after trim) → no payee clause at all (today's "empty string is not a
  filter" semantic — verify against `matchesTransactionFilters`'s `if (payee && ...)` guard).
- `accountIds: ['a','b']` → `accountId: { in: ['a','b'] }`.
- `accountIds: []` → no `accountId` clause.
- `categoryIds: ['c1']` → `categoryId: { in: ['c1'] }` — assert this clause, evaluated against a
  Prisma mental model, does **not** match a `categoryId: null` row (document the assertion as "this
  is why `in` reproduces the no-category-never-matches rule," per the architecture table, even
  though the unit test can't execute real Prisma — the parity test in part 2 is where this actually
  gets proven against fixture data).
- `from: '2026-06-10'`, no `to` → `AND` includes `{ date: { gte: <2026-06-10T00:00:00.000Z> } }`
  only, no `lt` clause.
- `to: '2026-06-20'`, no `from` → `AND` includes `{ date: { lt: <2026-06-21T00:00:00.000Z> } }` —
  **assert the day-plus-one boundary explicitly** (`2026-06-21`, not `2026-06-20`), since an
  off-by-one here silently drops the last day of every date-range filter.
- `from` and `to` both set → both clauses present in the same `AND` array (not top-level `date: {
gte, lt }` — the doc requires the `AND` array shape specifically because `period` can also
  constrain `date`).
- `period: { start, end }` with no `from`/`to` → `AND` includes `{ date: { gte: start } }` and
  `{ date: { lt: end } }`, as separate entries alongside (not merged into) any `from`/`to` entries —
  add one case with **both** `period` and `from`/`to` active simultaneously and assert all four date
  clauses land in the same `AND` array (per Decision/§2's explicit "both can be active and
  intersect").
- `type: 'INCOME'` → `type: 'INCOME'`.
- `amountMin: '20'`, `amountMax: '100'` → `amount: { gte: 20, lte: 100 }`.
- `amountMin: 'abc'` (unparseable) → no `gte` key at all (not `gte: NaN`) — mirrors
  `matchesTransactionFilters`'s `Number.isFinite` guard; assert the _key is absent_, since a Prisma
  `gte: NaN` would behave unpredictably rather than being ignored.
- `amountMin: 'abc'`, `amountMax: '100'` → only `lte: 100` present, no `gte` key (mixed valid/invalid
  case, not just both-invalid or both-valid).
- `hideTransfers: true` → `isTransfer: false`.
- `hidePayments: true` → `isPayment: false`.
- `uncategorizedOnly: true` → `categoryId: null`.
- `uncategorizedOnly: true` **and** `categoryIds: ['c1']` simultaneously (both are expressible
  together even though they're logically contradictory in the UI) → assert the builder emits both
  clauses without throwing; don't assume the UI prevents this combination from reaching the service.
- **`skippedAt`**: assert the returned `where` object has **no `skippedAt` key at all**, for a filter
  set with every other field populated — this is Decision 9, and the easiest thing for an
  implementer to get wrong is to "helpfully" add `skippedAt: null` while rebuilding this query from
  scratch.
- `options.mobile: false` with `mobileSearch: 'foo'` and `quickFilter: 'spending'` set → neither
  `mobileSearch` nor `quickFilter`'s clause appears in the output (the desktop-scope predicate omits
  them regardless of their value).
- `options.mobile: true`, `quickFilter: 'uncategorized'` → `categoryId: null` (same clause shape as
  `uncategorizedOnly`, added independently — assert both can co-exist if both are somehow active).
- `options.mobile: true`, `quickFilter: 'spending'` → `type: 'EXPENSE'`; `quickFilter: 'income'` →
  `type: 'INCOME'`; `quickFilter: 'all'` → no `type` clause from `quickFilter` (but `filters.type` if
  set independently still applies — one case with `filters.type: 'INCOME'` and `quickFilter: 'all'`
  confirms the desktop `type` filter still works standalone under `mobile: true`).
- `options.mobile: true`, `mobileSearch: 'Coffee'` (non-amount-shaped) → a second `payee: {
contains: 'Coffee', mode: 'insensitive' }` entry lands in the `AND` array (Mode A path) —
  **and** if `filters.payee` is _also_ set, both payee clauses appear (two independent `AND` entries,
  not one merged/overwritten clause) — this is explicitly named in the architecture's "payee can be
  constrained twice" note; test it, don't assume it.
- `options.mobile: true`, `mobileSearch: '12.50'` (amount-shaped): `buildTransactionWhere` is **not**
  where Mode B's JS filtering happens (that's in `getTransactionsPage` itself), but assert
  `buildTransactionWhere` does **not** emit a bogus Prisma clause for an amount-shaped
  `mobileSearch` — either it's excluded entirely from the builder's output (matching §4's
  "`scopeWithoutTextTerms`" description) or the test documents whatever the implementation actually
  does here, since the architecture doc is explicit that Mode B's predicate is _assembled_ by the
  service, not solely by this builder.

**`getTransactionsPage` — Mode A (no amount-shaped mobile search):**

- Happy path, no filters, no cursor: `findMany` called with `take: limit + 1`,
  `orderBy: [{ date: 'desc' }, { id: 'desc' }]`; returns `limit` rows (mock returns exactly `limit`
  rows, not `limit + 1`) → `hasMore: false`, `nextCursor: null`.
- `findMany` mock returns `limit + 1` rows → response `rows` has exactly `limit` items (the extra
  dropped), `hasMore: true`, `nextCursor` decodes back to the `(date, id)` of the 50th (last kept)
  row, **not** the 51st.
- Cursor provided (a decoded `{ date, id }`): the page `findMany`'s `where.AND` includes the keyset
  `OR` clause `{ OR: [{ date: { lt: d } }, { date: d, id: { lt: i } }] }` — assert the exact clause
  shape, since this is the "one comparator, four places" contract from §5.
- Malformed `cursor` string (already caught by the validator per §3, but the service's own defense
  per §3's "decodes it with `decodeTransactionCursor` and throws `ServiceValidationError` on a
  malformed value" line): call `getTransactionsPage` with a request whose `cursor` decodes to `null`
  → throws `ServiceValidationError('Invalid cursor')`, and **no Prisma call happens** (assert
  `findMany` was not called — a malformed cursor must fail before any query, not after a wasted
  round trip).
- **Empty result set** (§5's explicit short-circuit): `findMany` returns `[]` → response is
  `{ rows: [], nextCursor: null, hasMore: false, runningBalanceStart: 0, dayTotals: [] }`, **and**
  assert the day-total `groupBy` and the running-balance `groupBy` were **not called** (call-count
  assertion — `expect(prismaMock.transaction.groupBy).not.toHaveBeenCalledWith(expect.objectContaining({ by: ['date', 'type'] }))`
  or equivalent) — this is the only way to actually verify the short-circuit exists rather than the
  aggregate queries merely returning empty by coincidence. Also assert `summary`/`desktopCount`/
  `uncategorizedCount`/`totalCount` are **still** computed (not zeroed) — feed the mocks a non-zero
  desktop count while the page `findMany` returns `[]`, confirming the two are independent.
- **Running balance correctness**, hand-computed: mock the "strictly older" `groupBy` to return
  `[{ type: 'INCOME', _sum: { amount: 500 } }, { type: 'EXPENSE', _sum: { amount: 120 } }]` →
  `runningBalanceStart` is `380` (`500 - 120`), asserted as a `number`, not a string or `Decimal`.
- **Decimal → Number conversion**: mock at least one `_sum.amount` value as an actual
  `new Prisma.Decimal('123.45')` instance (import `Prisma` from `@prisma/client` in the test, same as
  production code would receive it) rather than a plain JS number, for both the running-balance
  `groupBy` and the summary `groupBy` — assert the envelope's corresponding field (`runningBalanceStart`,
  `summary.credit`/`debit`) is a plain `number` with the correct value. This is the money-handling
  edge case CLAUDE.md flags explicitly; a test using only plain-number mocks would pass even if the
  service left a `Decimal` unconverted (which would then string-concatenate or throw downstream).
- **Summary bucket precedence — the isPayment+isTransfer edge case** named in the architecture and
  product doc: mock the summary `groupBy` cells such that one cell has `isPayment: true,
isTransfer: true, type: 'EXPENSE', _sum: { amount: 50 }` → asserted output has that `50` folded
  into `summary.payments`, **not** `summary.transfers` (payment checked first, per the doc's
  explicit precedence and existing code comment). Add a second cell `isPayment: false, isTransfer:
true, type: 'EXPENSE', _sum: { amount: 30 }` → folds into `summary.transfers`. A third cell with
  `isPayment: false, isTransfer: false, type: 'INCOME'` and a nonzero result from the `reimb`
  groupBy for the same `(type, isPayment, isTransfer)` key → the `reimb` share goes to
  `summary.reimbursementIncome` and the remainder to `summary.credit`, matching the "subtract `reimb`
  per cell" fold rule in §5 — include a case where `reimb`'s `_sum` for a cell **exceeds** the `all`
  groupBy's `_sum` for the same cell (shouldn't happen but is code-reachable per the doc's own "
  invariant-violating but code-reachable" note) and assert the fold does not produce a negative
  `credit` that silently corrupts the total — pin whatever behavior the implementation lands on
  (e.g. clamped to 0) rather than leaving it unspecified; if the implementation has no explicit
  handling, that is a review-pass finding.
- **Day totals, hand-computed**: mock `groupBy(['date','type'])` to return two rows on the same UTC
  day but different instants (e.g. `2026-06-15T00:00:00Z` and `2026-06-15T14:00:00Z`, one INCOME one
  EXPENSE) → `dayTotals` folds them into one entry keyed `'2026-06-15'` with the net signed total
  (INCOME `+`, EXPENSE `-`), not two separate entries.
- **`desktopWhere === where` optimization** (§5, "skip the duplicate queries when mobile params are
  at their defaults"): call with `mobileSearch: ''`, `quickFilter: 'all'` → assert `count` is called
  the reduced number of times and `totalCount === desktopCount` in the response (same underlying
  value, not just coincidentally equal numbers) — then a second test with `quickFilter: 'spending'`
  set → assert the _additional_ desktop-scope `count`/summary calls happen and `totalCount !==
desktopCount` given differing mock returns for the two `count` calls (e.g. full scope 10, desktop
  scope 6) — this is the concrete way to prove the two scopes actually diverge in the response, not
  just that two queries fired.
- **`userId` scoping**: every `findMany`/`count`/`groupBy` call's `where` (or nested `where.AND[0]`,
  wherever `buildTransactionWhere`'s output lands) includes `userId` equal to the `userId` argument —
  assert this on at least the page query, one `count` call, and the running-balance `groupBy`, not
  just on `buildTransactionWhere`'s own unit tests (this proves the service actually _uses_ the
  builder's output rather than reconstructing its own unscoped `where` somewhere).

**`getTransactionsPage` — Mode B (amount-shaped or `%`/`_` mobile search):**

- `mobileSearch: '12.50'`: assert the phase-1 scan `findMany`'s `select` is the lean shape from §4
  (`id, date, amount, type, payee, categoryId, isPayment, isTransfer, _count`) — **not** the full
  `include` (this is the perf property the mode exists for; a regression here silently reintroduces
  the 5-relation-per-row cost Mode B was built to avoid).
- Phase-2 JS filter, hand-computed: scan mock returns three rows with `amount` `112.50`, `12.00`,
  `212.50` and `payee` values that don't contain `'12.50'` → only the `112.50` and `212.50` rows
  survive (string-substring match on `Number(amount).toFixed(2)`, matching today's mobile semantic
  exactly — copy a case straight from the existing behavior, e.g. `'12.5'` matching `'112.50'`).
- Phase-2 payee-OR-amount: a row whose `payee` contains the term but whose amount doesn't, and vice
  versa — both survive (OR, not AND).
- Phase-4 hydration query: assert its `where` is exactly `{ userId, id: { in: [...] } }` (own case,
  per the advisor's flag — this is precisely where `userId` scoping could get dropped on a second,
  easy-to-overlook query) **and** its `orderBy` is the same `[{ date: 'desc' }, { id: 'desc' }]` —
  mock `findMany` to return the hydrated rows in a _different_ order than `pageRows` and assert the
  response's `rows` order matches the comparator order, not `findMany`'s return order (proves the
  code doesn't rely on `in` preserving order, which Prisma doesn't guarantee — the doc calls this out
  explicitly).
- Cursor mid-scan: `matched` array of 5 rows, cursor pointing at the 2nd row → `after` contains rows
  3-5 only (`compareDesc(r, cursor) > 0`), proving the keyset filter runs against the in-memory list
  and not via a second DB round trip.
- **Stale cursor in Mode B**: cursor's `(date, id)` doesn't exactly match any row in `matched` (the
  row was deleted/edited since) → the comparator still partitions correctly (no throw, no dropped/
  duplicated rows) — construct a cursor between two existing rows' `(date, id)` values and assert
  exactly the rows strictly older than it are returned.
- All Mode B aggregates (`totalCount`, `summary`, `dayTotals`, `runningBalanceStart`) computed from
  `matched` in JS, **no additional `groupBy`/`count` Prisma calls**: assert
  `prismaMock.transaction.groupBy` and `prismaMock.transaction.count` were **not called** at all in
  a Mode B request (only the phase-1 scan and phase-4 hydration `findMany` calls happen) — this
  proves the "no second scan" property in §4, not just that the numbers happen to be right.
- **Two-scope rule inside Mode B** (§4's "uniform rule" paragraph): one test with `mobileSearch`
  amount-shaped (desktop scope = `scan` itself, no JS payee predicate for desktop) and one test with
  `filters.payee` containing `%` (desktop scope needs the JS payee predicate applied) — assert
  `desktopCount`/`summary` differ correctly between the two scenarios given the same `scan` mock
  data.

**`%`/`_` LIKE-escaping risk** (flagged by the architect as untestable-against-a-mock in the strict
sense — Prisma's actual SQL compilation isn't exercised by a mocked `findMany`). Unit-testable parts:

- `buildTransactionWhere` still emits a literal (unescaped) `contains: '100%'` clause when Mode B
  routes that case away from Prisma entirely — assert the _service_ never sends a `%`/`_`-containing
  term through a Prisma `contains` clause (i.e., whenever `filters.payee` or `mobileSearch` contains
  `%`/`_`, the corresponding text match happens in JS, not via the builder) **if** the probe from the
  implementation checklist finds `contains` does not escape. If the probe finds it _does_ escape,
  this test instead asserts the opposite — a literal `payee: { contains: 'Whole%Foods' }` clause is
  emitted and trusted to Prisma. **This test's expected behavior is contingent on that probe's
  documented finding in this doc** (§4/§10) — the senior-developer must update this doc with the
  probe's result before this test can be written correctly; do not guess.
- Add a payee value containing `%` as one row in the parity fixture set (part 2 below) so the
  chosen behavior — literal Prisma `contains` vs. JS matching — produces the same visible result
  either way (this doesn't test the escaping itself, which requires a real Postgres connection out of
  unit-test scope, but does prove the _feature_ behaves correctly regardless of which path was taken;
  actual LIKE-escaping behavior is a manual/integration verification the checklist already calls for,
  not something this suite can assert without a live DB).

### 2. Parity tests (server `buildTransactionWhere` vs. client `matchesTransactionFilters`)

**Mechanism.** `buildTransactionWhere` returns a `Prisma.TransactionWhereInput` object graph, not a
predicate function — it cannot be diffed against `matchesTransactionFilters` by calling both with
the same input and comparing return values, since one returns a filter _description_ and the other a
`boolean`. The parity suite needs a small **in-test Prisma-where interpreter**: a pure function
(local to `tests/unit/services/transactionsPage.test.ts` or a new
`tests/unit/services/transactionsPage.parity.test.ts`) that takes a `FrontendTransaction`-shaped
fixture row and a `Prisma.TransactionWhereInput` and evaluates it, recognizing only the clause shapes
the architecture doc's table declares: `userId` (equality), `payee.contains` + `mode: 'insensitive'`,
`accountId.in`, `categoryId.in`, `categoryId: null`, `date.gte`/`date.lt` (inside `AND` entries),
`type` (equality), `amount.gte`/`amount.lte`, `isTransfer`/`isPayment` (equality), and top-level
`AND: [...]` (conjunction of its entries). **It must throw on any clause shape it doesn't recognize**
(e.g. an unexpected key, an `OR` at the top level, a nested `NOT`) rather than silently treating an
unrecognized clause as "no constraint" — an unrecognized-clause-passes-silently interpreter would
mask exactly the kind of drift this suite exists to catch.

**Table-driven cases.** For each case: build a small fixture array of `FrontendTransaction`s (reuse
the `tx()` builder pattern from `tests/unit/lib/transaction-filters.test.ts`, imported or duplicated),
a `TransactionFilters` value, run both `matchesTransactionFilters(row, filters)` for every fixture
row and the interpreter against `buildTransactionWhere('user-1', { filters, period: null,
mobileSearch: '', quickFilter: 'all' }, { mobile: false })`, and assert the two produce the identical
subset of the fixture array. Cover, at minimum, one case per row of the architecture's clause table
plus every **combination** named in "Current behavior" §2 of this doc:

- Every filter alone (payee, accountIds, categoryIds, from, to, from+to, type, amountMin, amountMax,
  amountMin+amountMax, hideTransfers, hidePayments, uncategorizedOnly) — 12+ cases.
- `categoryIds` active against a row with `categoryId: null` — both sides must exclude it (this is
  the one the architecture table calls out as "the reason `in` works," so it's the highest-value
  single parity case in the suite).
- `amountMin: 'abc'` (unparseable) with a row at every amount — both sides treat it as no lower
  bound; same for `amountMax: 'abc'` and both invalid simultaneously.
- A payee value **containing `%`** (e.g. `'100% Coffee'`) matched by `filters.payee: '100%'` — proves
  the chosen `%`-handling path (Mode B JS match or literal Prisma `contains`, whichever the probe
  landed on) still agrees with `matchesTransactionFilters`'s plain JS `.includes()` — this is where a
  wrong LIKE-escaping assumption would actually surface as a parity mismatch, short of a live DB.
- `from`/`to` day-boundary rows: a row at exactly `to`'s day `23:59:59.999Z` must be included by both
  (inclusive-day semantics); a row at `to + 1 day` `00:00:00.000Z` must be excluded by both — this is
  the day-plus-one-exclusive-bound the architecture table implements, and an off-by-one here is
  exactly the kind of bug a hand-derived `lte`/`lt` choice produces.
- A non-UTC-midnight timestamp row (e.g. `2026-06-15T18:30:00.000Z`) against `from: '2026-06-15'` —
  both sides must include it (client compares `date.slice(0,10)` string equality against the day
  boundary; server compares real `Date` instants against UTC-midnight boundaries — these are only
  equivalent because the fixture's date happens to fall inside the UTC day, which is exactly the
  assumption worth pinning with a test rather than leaving implicit).
- Combined filters (AND across 3+ filter types at once, mirroring the existing
  `matchesTransactionFilters` "combines multiple active filters with AND" case) — at least 2 such
  combination cases, with fixture rows that pass all-but-one clause to prove it's a true AND on both
  sides (a row failing only the amount clause, a row failing only the category clause).
- **`period`** (server-only concept — `matchesTransactionFilters` doesn't know about it) is _not_
  part of this parity suite's oracle comparison (the client applies it separately, per "Current
  behavior"); instead add one standalone unit test on `buildTransactionWhere` confirming `period`
  produces the same `date.gte`/`date.lt` clause shape as `from`/`to` does, so the interpreter's date
  logic is exercised by construction, without needing a second oracle.
- `hideTransfers`+`hidePayments`+`uncategorizedOnly` all active together, against rows that satisfy
  0, 1, 2, and all 3 — proves independence of the three boolean flags on both sides.

**What this suite does _not_ attempt**: mobile's `quickFilter`/`mobileSearch` server clauses have no
client oracle to diff against (today's mobile filtering is a _different_, undocumented pipeline
layered client-side — see "Current behavior" §1 — not a spec `matchesTransactionFilters` claims to
match). Cover `quickFilter`/`mobileSearch` correctness directly in part 1's `buildTransactionWhere`
and Mode B tests instead; don't force them into the parity suite against an oracle that was never
designed to describe them.

### 3. e2e regression plan

**Seeding.** Both existing transaction specs create rows one at a time through the UI drawer against
the shared dev DB (`dev@example.com`) — workable for a handful of rows, **not** for the ≥51-row
seeding this plan's Load-more/pagination assertions need. Do not add a Prisma-seeding fixture (no
direct-DB-write fixture exists in `tests/e2e/fixtures/` today, and introducing test-only DB access
from Playwright is a bigger change than this phase's scope). Instead:

- Seed via authenticated API calls: after `login(page)`, use `page.request.post('/api/transactions',
{...})` (the browser context already carries the session cookie from login, so `page.request`
  calls are authenticated the same way UI actions are) in a loop, inside `test.beforeAll` within a
  `test.describe.serial(...)` block — not per-`test.beforeEach` — so the ≥51 rows are created once
  per spec file, not once per test.
- **Isolation for count assertions.** The dev DB has pre-existing data from other specs/manual runs,
  so any assertion like "exactly 50 rows shown" or "`totalCount` is 51" is flaky unless scoped to
  data this spec alone owns. Create a **dedicated account** for the spec (via `POST /api/accounts`)
  in `beforeAll`, seed all transactions against that `accountId`, and drive every page visit at
  `/transactions?accountIds=<thatAccountId>` — this both isolates counts and exercises the
  `accountIds` filter for free. Stamp the account name with `Date.now()` (matching the existing
  payee-stamping convention) so parallel spec runs don't collide.

**Mechanism split — SSR vs. client fetch.** Page 1 is server-rendered (architecture §7's "SSR
payload is consumed once"), so there is **no network request to intercept on first paint**. The
"initial load is bounded" assertion must be a **rendered-row-count** check (`page.locator('.ledger-row')`,
the same locator the existing specs use), not a `page.waitForResponse` intercept — an intercept
written for this case would simply never fire and the test would pass vacuously without asserting
anything. `page.waitForResponse(/\/api\/transactions\?.*paginated=1/)` **does** apply to: Load-more
clicks, filter/period/search changes after first paint, and the mutation-refetch case below — use it
there.

**Cases, one per bullet, each naming its assertion:**

1. **Initial load is bounded.** With 55 seeded rows on the dedicated account, visit
   `/transactions?accountIds=<id>`. Assert `page.locator('.ledger-row')` has count `50` (not `55`) —
   rendered-row-count mechanism, no intercept.
2. **Load more appends the remaining rows.** From the state in (1), click the `Load more` button
   (`page.getByRole('button', { name: 'Load more' })`); `await page.waitForResponse(...paginated=1...cursor=...)`;
   assert `.ledger-row` count becomes `55` and the button is no longer present (`toHaveCount(0)`) —
   covers the Idle → Loading → Exhausted transition and the "exactly-50-multiple" edge case from
   UI-Design §2/§6 in one pass (adjust the seeded count to a non-round number like 55, not exactly
   50 or 100, specifically so the exhausted-after-one-click path is exercised without ambiguity).
3. **Load more idle/loading visual state.** Immediately after the click in (2), before the response
   resolves (throttle the route via `page.route(...).continue` with an artificial delay, or assert
   synchronously in the same tick if Playwright's auto-waiting makes the loading frame observable),
   assert the button is `disabled` and its accessible name still reads `Load more` (per the exact
   copy string table in UI-Design §2 — the spinner replaces the icon slot, not the text).
4. **Every filter type narrows correctly**, extending `transaction-filters-dialog.spec.ts`'s existing
   coverage rather than duplicating it: keep that spec's payee/type/amountMin cases, but change its
   payee-search assertion (see item 9 below) and add explicit narrow-then-widen cases for
   `accountIds`, `categoryIds`, `from`/`to`, `hideTransfers`, `hidePayments`, `uncategorizedOnly` —
   each asserting the expected row is `toBeVisible()` and the excluded row is `toBeHidden()` after
   the debounced/applied request resolves (`await page.waitForResponse(...)` before asserting, since
   these are no longer synchronous).
5. **Period switching (month).** Seed two transactions in different calendar months on the dedicated
   account; select "By month" in the Period Picker; assert only the current month's row is visible;
   click "previous period" (existing `PeriodPicker` control); assert the other month's row becomes
   visible and the first is hidden — asserts period semantics are unchanged and that a period change
   is treated as a `requestKey` change (full `pages` reset per UI-Design §4, not an append).
6. **Period switching (by statement)**, gated the same way the UI gates it: requires a single
   selected account of `type: 'CREDIT_CARD'` with a `statementDay` set. Create such an account via
   the API, seed a transaction just before and just after a statement close date, select that single
   account plus "By statement," and assert the statement-period boundary (from `lib/statement.ts`)
   places each transaction in the correct period — this is the one case that needs a
   credit-card-with-statementDay account, which the existing specs don't currently set up; the
   account-creation API call must include `statementDay` (check `POST /api/accounts`'s validator for
   the exact field name/shape before writing this).
7. **Running balance correctness across a Load-more boundary.** With the 55-row dedicated-account
   seed sorted by known amounts (e.g. seed with predictable amounts summing cleanly, like 55 rows of
   $10.00 EXPENSE each), assert the running-balance value rendered next to the 50th (last-on-page-1)
   row and the 51st (first-on-page-2, post-Load-more) row are consistent with an unbroken cumulative
   sum across the boundary — i.e., the 51st row's balance equals the 50th row's balance minus that
   row's own signed amount (or whatever the exact continuity relationship is, hand-computed from the
   seeded amounts) — this is the concrete way to prove `runningBalanceStart` on page 2 was computed
   correctly rather than restarting from 0.
8. **Summary bar and excluded-bucket chips.** Seed one `isPayment: true` row, one `isTransfer: true`
   row, one reimbursement-income-linked row (via whatever existing flow creates
   `reimbursementIncomeLinks` — check `reimbursements.ts`/the transaction form for the exact create
   path), and confirm: the "Payments (excluded)"/"Transfers (excluded)"/"Reimbursement income
   (excluded)" chips each render with the correct dollar figure, and a row that is both `isPayment`
   and `isTransfer` counts toward "Payments (excluded)" only, matching the bucket-precedence unit
   test in part 1 — this is the one case worth asserting end-to-end, not just in the service unit
   test, since it's the flagship "we didn't just move the bug, we preserved the bucket precedence"
   proof point named repeatedly across the doc.
9. **Day-group totals correct across a page boundary.** Seed enough same-day transactions that the
   50-row page boundary falls **inside** that day's group (e.g. 55 rows all dated the same day) —
   assert the day header's total reflects **all 55** rows' signed sum even when only 50 have rendered
   (before Load-more), then assert it's unchanged (not doubled, not recomputed) after Load-more
   appends the remaining 5 under the **same** header, not a duplicate second header for that date —
   directly exercises UI-Design §1's explicitly-flagged "must not create a duplicate day-group
   header" risk.
10. **Load-more button states (idle/loading/exhausted) per the UI spec's exact copy.** Covered by
    (2)/(3) for idle/loading/exhausted; add the **failure** state separately: intercept
    `**/api/transactions*paginated=1*cursor=*` with `page.route(...)` to `abort()` or return a 500 for
    one click, assert the button's accessible name becomes `Try again` and a `role="alert"` element
    reads exactly `Couldn't load more transactions. Try again.` (copy string from UI-Design §2); then
    unroute and click `Try again`, asserting it succeeds and appends rows (loaded rows must remain
    visible throughout — assert `.ledger-row` count never drops during the failed attempt).
11. **Search debounce/pending-state behavior.** Instrument a request counter before typing —
    `let requestCount = 0; await page.route(/\/api\/transactions\?.*paginated=1/, (route) => {
requestCount++; route.continue(); });` — since "the previous rows are still visible" does **not**
    prove no request fired (a request that returns the same set would look identical); the counter is
    the only way to actually assert the debounce's absence-of-request property. Type into the desktop
    payee search box; wait ~250ms (`page.waitForTimeout(250)`) and assert `requestCount === 0`; then
    wait past the 300ms mark (or `await page.waitForResponse(...paginated=1...)`) and assert
    `requestCount === 1` and the correct rows are shown once it resolves; also
    assert the search input's icon swaps from the search glyph to a spinner during the in-flight
    window if a stable selector for that is available (e.g. an `aria-busy` or `data-` attribute named
    in the eventual implementation — flag to the developer that the UI-Design doc doesn't name a
    concrete test selector for this swap, so the review pass should confirm one exists; don't invent
    a brittle icon-class selector here).
12. **Filter/period change resets loaded pages.** From the Load-more'd state in (2) (55 rows loaded
    across 2 pages), change a filter (e.g. toggle `hideTransfers`); assert the row count drops back
    to a fresh page-1 window (≤50, matching the new filter's result set) rather than staying at 55 —
    proves `pages` resets unconditionally on `requestKey` change rather than the new results being
    appended to the stale set.
13. **Focus behavior on Load-more per the UI design's a11y spec.** After clicking Load more while
    more pages remain, assert `page.locator('button', { hasText: 'Load more' })` (or its precise
    accessible-name locator) `toBeFocused()` once the response resolves (covers "focus stays on the
    button through the loading state"). After the click that exhausts the last page, assert focus
    moved to the status element (`tabindex="-1"`, per UI-Design §5) rather than `document.body` —
    check `document.activeElement`'s tag/attributes via `page.evaluate`, since Playwright's
    `toBeFocused()` needs a concrete locator and the status element's selector isn't named in the
    spec yet (flag to the developer that a stable `data-testid` or `aria-label` on that status
    element would make this assertion far less brittle than deriving a locator from its `sr-only`
    text).
14. **Mutation triggers a `reloadNonce` refetch, not a stale list.** While on `/transactions` with
    the dedicated-account filter active, add a new transaction via the "Add transaction" drawer
    (reuse `addTransaction()` from `add-transaction-sidebar.spec.ts`'s pattern) targeting the same
    account; assert the new row appears in the list **without a manual page reload** — this proves
    the architecture §7 "mutations bump `reloadNonce` to refetch the list" contract actually replaces
    what `router.refresh()` used to provide, and is not currently covered by any existing spec (both
    existing transaction specs only assert the _creating_ action's own drawer interaction, not that
    the underlying list view picks it up without a reload).
15. **`app/(protected)/import/history/[id]/page.tsx` still works unpaginated** (must-not-break, not
    new coverage): run `import-history.spec.ts` unmodified and confirm it still passes — this
    already exists and exercises `listTransactions(userId, { batchId })`; no new spec needed, just
    confirm it's included in the regression run and its assertions weren't loosened to accommodate
    this change.
16. **The existing 15 `tests/unit/lib/transaction-filters.test.ts` cases pass unmodified** — run
    `npm run test -- transaction-filters.test.ts` (or the equivalent Vitest filter) and diff the file
    against `git diff` to confirm zero lines changed; per the architecture doc, this file is
    deliberately retained as the parity oracle and any edit to it during implementation is a signal
    the contract drifted, not a fix to apply.

**Spec expected to require modification — not silently pass or silently loosen:**
`tests/e2e/transaction-filters-dialog.spec.ts` currently asserts, with the comment "filters as-you-
type, with no 'Apply' step," that typing into the payee box synchronously hides/shows rows with no
`await` between the `.fill()` and the visibility assertion. Architecture §7 rule 2 explicitly changes
this to a 300ms-debounced network round trip. This spec **will fail as written** once the
implementation lands. The fix is **not** to delete the assertion or replace it with a longer timeout
blindly — Playwright's web-first `expect(...).toBeVisible()`/`toBeHidden()` already retries with its
own timeout, so simply keeping the same assertions but ensuring the test awaits
`page.waitForResponse(...paginated=1...)` (or relies on the auto-retrying assertion's default
timeout, which comfortably exceeds 300ms) should suffice — but the developer must **update this
spec's comment** ("filters as-you-type, with no 'Apply' step") since it will no longer be accurate,
and must not weaken the assertion itself (still narrows to exactly the expected rows). Treat a red
run of this spec after implementation as expected and requiring this fix, not as a regression to
investigate elsewhere.

**Must-not-break regression surface (run, don't modify unless named above):**
`transaction-batch-indicator.spec.ts`, `add-transaction-sidebar.spec.ts`, `mobile-add-transaction.spec.ts`,
`mobile-transaction-filters.spec.ts`, `import-history.spec.ts`. `mobile-transaction-filters.spec.ts`
in particular exercises the mobile Filters dialog + URL round-trip (Decision 1 moves mobile filters
server-side) — read it fully at implementation/review time since it's the mobile-specific analog of
`transaction-filters-dialog.spec.ts` and may need the same debounce-awareness fix if it makes similar
synchronous assumptions.

### 4. What NOT to test (out of scope, per the product doc's non-goals)

- **No visual/layout regression testing** of the filter dialog, period picker, row markup, or day-
  group header markup — non-goal #1. Don't add screenshot/visual-diff tests for this feature.
- **No test asserting a specific running-balance _convention_ changes** (starting point, sign,
  inclusion of payments/transfers/reimbursement income) — non-goal #2. Tests should assert the
  _existing_ convention is preserved (payments/transfers/reimbursement income still included), not
  propose a "cleaner" balance definition.
- **No new filter types or quick-filter categories** — non-goal #3. Don't add test cases for filter
  combinations that don't exist today (e.g. no "hide reimbursement income" toggle).
- **No fix, and therefore no test, for the "transfers excluded" mobile copy bug** — Decision 10
  explicitly leaves it alone this pass. Do not add a test asserting `mobileFiltered` actually
  excludes transfers; that would encode the _wrong_ (currently-buggy) behavior as a new fixed
  contract prematurely, or block the PR on an out-of-scope fix. If a reviewer notices the bug is
  still present, that's expected, not a finding.
- **No index/performance benchmarking** — schema impact §9 explicitly defers any index addition;
  don't write a test asserting query plan shape or timing thresholds against Mode B's full-scope
  scan ("perf watch item" is accepted, not gated).
- **No coverage of a `match-transfers-dialog.spec.ts`** — see the Discrepancy note at the top of this
  section; that spec doesn't exist today and creating one is outside this phase's scope unless
  separately requested.
- **No live-Postgres LIKE-escaping integration test** — the `%`/`_` escaping question (architecture
  §4) is resolved by a manual probe recorded in this doc per the implementation checklist, not by an
  automated test; the unit suite covers only the code paths _downstream_ of that finding (part 1's
  last bullet), not Prisma's own SQL compilation.
- **No test of `GET /api/transactions` without `paginated=1`** beyond confirming
  `listTransactionsQuerySchema`/`listTransactions` are untouched — `tests/unit/services/transactions.test.ts`
  already covers that function; don't duplicate its cases under a new file.

## Test Review

Tester review pass (CLAUDE.md Agent Workflow step 6), independent of the senior-developer's own
verification in `### 11. Implementation notes`. Ran `npm run format:fix && npm run lint`,
`npx tsc --noEmit`, `npm run test`, and e2e from a scratch Playwright config
(`baseURL`/`webServer` on port 3103, `NEXTAUTH_URL` overridden to match — the checked-in
`playwright.config.ts` was never touched and the scratch file was deleted after the run).

### Confirmed good

- `npm run format:fix && npm run lint`: clean. `npx tsc --noEmit`: clean. `npm run test`:
  57 files / 867 tests passed, matching the implementer's report exactly.
- `tests/e2e/transactions-pagination.spec.ts`: 21/21 pass, run fresh (not reusing the
  implementer's run) from a scratch config.
- `listTransactions` is genuinely untouched. `git diff main -- lib/services/transactions.ts`
  shows only `toFrontend`/`include` gaining `export` — no logic change. `app/(protected)/import/history/[id]/page.tsx`
  and `tests/unit/lib/transaction-filters.test.ts` are byte-identical to `main` (`git diff main --
...` empty for both). `tests/unit/services/transactions.test.ts` is also unmodified. All pass.
- **Judgment call #2 (SSR-refresh relaxation).** Read `TransactionsView`'s `ssrSeen` adoption
  logic and the `reloadNonce` bump sites directly (not just the prose): a same-key SSR re-render
  whose serialized content differs bumps `reloadNonce` and refetches; an identical re-render is a
  no-op; delete, match-transfers, and the edit-drawer's `onDone` all bump `reloadNonce` explicitly.
  Confirmed the drawer's Cancel button is wired to the _same_ `onDone` prop as a successful save
  (`components/transactions/transaction-form.tsx`: `onClick={onDone}` on Cancel, `if (ok) onDone()`
  on save) — so the stated cost ("Cancel also resets the list to page 1") is real, not
  overstated, and matches exactly what's documented. No worse than described.
- **Judgment call #7 (payee debounce race fix).** Read the `pendingPayeePushes` queue and
  `payeeUrlTargetRef` logic directly. e2e case 11b (`tests/e2e/transactions-pagination.spec.ts:330`)
  holds RSC navigations in flight, types two settled searches back-to-back so two pushes are
  in-flight simultaneously, asserts the second doesn't get clobbered by the first's late echo,
  then clears the search and asserts (via `page.reload()`) that the URL genuinely has no stale
  `payee=` param left over — this is a real exercise of the race (two in-flight pushes), not a
  happy-path rename. No new race spotted in the queue logic.
- **Money as cent-exact strings (judgment call #1).** Confirmed applied consistently:
  `TransactionSummary.*`, `runningBalanceStart`, `DayTotal.total` are all `fromCents(...)` /
  `toFixed(2)` strings in `lib/services/transactionsPage.ts`, both in Mode A and Mode B. The
  component consumes them via `Number(...)` for comparisons/formatting and walks the running
  balance in integer cents (`toCents` at the top of `transactions-view.tsx`) — no string
  concatenation or silent `NaN` found in the paths read.
- **Two-phase amount-substring search (Mode B) and the `%`/`_` probe.** The probe's own conclusion
  ("Prisma 6.19.3's `contains` does NOT escape `%`/`_`") is independently exercised live against
  Postgres by `tests/e2e/transactions-pagination.spec.ts`'s `a literal % in the payee never
wildcard-matches (probe consequence, live)` case, which passed. Hand-checked a few Mode B JS-fallback
  cases in `getPageModeB`/`matchesDeferredPayee` against `matchesTransactionFilters`' semantics
  (case-insensitive `String.includes` on payee, `Number(amount).toFixed(2).includes(term)` on
  amount) and they line up.
- **Reimbursement clamping (judgment call #6).** Traced the actual reachability, not just read the
  comment: `summarize()`'s `reimb` groupBy is `{ AND: [where, { reimbursementIncomeLinks: { some: {} } }] }`
  — a **strict subset** of the same `(type, isPayment, isTransfer)` cell the `all` groupBy sums,
  and `amount` is validated `.positive()` everywhere (`lib/validators/transactions.ts`). A
  non-negative subset sum can never exceed the full-set sum for the same partition, so
  `reimb > all` for one cell cannot occur via any real Prisma query result — only via the unit
  test's artificial mock (`tests/unit/services/transactionsPage.test.ts:514`, which hand-sets
  `summaryReimb` to 35 against `summary` of 20, a combination Prisma itself could never produce
  from this query shape). Confirmed the write path also independently forecloses the _other_
  invariant violation the code comment mentions (an EXPENSE transaction accumulating income
  links): `updateTransaction` in `lib/services/transactions.ts` throws `ReimbursementConflictError`
  if you try to change type away from `INCOME` while `incomeLinkedCents > 0`, and `reimbursements.ts`
  only allows creating a link when `income.type` — checked at creation — is `INCOME`. **Conclusion:
  the clamp is genuine defensive code, not a mask over a reachable data-integrity bug.** It's safe
  as written; flagging only because the plan's own language ("the code can reach it") overstates
  reachability — worth a one-line correction if the doc is revisited, not a blocker.
- **Abort-superseded-request logic.** Read `transactions-view.tsx`'s page-1 fetch effect directly:
  it creates an `AbortController` per `requestKey` change, aborts it in the effect cleanup, and the
  `.then` callback checks `controller.signal.aborted` before calling any `setState` — so even
  though the underlying `fetch` may not always cancel at the network layer, a stale response can
  never clobber newer state. `loadMore` uses a `pagesKeyRef` comparison (not abort) for the same
  purpose, which is adequate for an append-only, non-destructive path. Confirmed correct by
  reading the code, not by trusting the report.
- Boundary cases: `getTransactionsPage` unit tests cover the exact-`limit` (no `hasMore`) case
  (`transactionsPage.test.ts:336`), the empty-result short-circuit for both an empty desktop scope
  and empty full scope (`:401`, `:823`), and a malformed-cursor 400 before any query runs (`:392`).
  The e2e suite exercises a live malformed-cursor 400 against Postgres too (case "a malformed
  cursor is a 400, not a silent restart").

### Real bugs found

None. No functional bug was found in `lib/services/transactionsPage.ts`,
`lib/transactions/transaction-scope.ts`, `lib/transactions/transactions-page-query.ts`, the
validator, the route, or the client fetch/state logic in `transactions-view.tsx` during this pass.

### Open concerns requiring a decision from the orchestrating session

1. ~~Login rate limit makes the e2e suite unrunnable in one pass~~ — **fixed.** Added
   `E2E_DISABLE_RATE_LIMIT=1`, checked in `lib/auth/config.ts`'s `authorize()` and
   `lib/auth/actions.ts`'s `signUpAction` before either rate-limit check runs; wired into
   `playwright.config.ts`'s `webServer` env only (same shape as the `AI_*_BASE_URL`/`BREVO_*`
   test-only overrides — server-only env var, read once at module load, never request input, not
   settable from anywhere a real deployment would set it). Documented in `.env.example`. Verified:
   cleared leftover `RateLimitBucket` login rows, then ran
   `transactions-pagination.spec.ts` + `transaction-filters-dialog.spec.ts` +
   `transaction-batch-indicator.spec.ts` + `import-undo.spec.ts` together in one pass (27 tests,
   the same combination that previously tripped the limiter) — 27/27 passed, no rate-limit
   failures.
2. **Plan-doc wording overstates the reimbursement-clamp's reachability** ("the code can reach
   it") — see "Confirmed good" above. Not a code bug; a one-line doc-accuracy nit, not blocking.
   Left as-is (cosmetic, not worth a doc edit on its own).

### Verification commands run

- `npm run format:fix && npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm run test` — 57 files / 867 tests passed.
- `npx playwright test --config=<scratch, port 3103> tests/e2e/transactions-pagination.spec.ts` —
  21/21 passed.
- `npx playwright test --config=<scratch, port 3103> tests/e2e/transaction-filters-dialog.spec.ts
tests/e2e/transaction-batch-indicator.spec.ts tests/e2e/import-undo.spec.ts` — 6 failures, all
  login-rate-limit lockouts (see Open concern #1); not a regression in the code under review.
  `RateLimitBucket` rows were cleared afterward (local dev data only, same as the implementer's own
  prior workaround) and the scratch Playwright config was deleted; `playwright.config.ts` untouched.
