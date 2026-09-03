# Credit Card Statement Cycles

## Goal

For credit card accounts, let the user view transactions grouped by billing statement period (not just calendar month), with a configurable statement date per card.

## Assumptions / decisions

- `statementDay` (1–28, to avoid month-length edge cases) is a new field on `Account`, only meaningful/settable when `type === 'CREDIT_CARD'`. Nullable — existing/other-type accounts don't have one.
- **Statement period convention:** a statement closes on `statementDay`. The period covering that close date runs from the day after the _previous_ statement's close date through `statementDay` of the closing month, inclusive. E.g. `statementDay = 15`: the statement closing 2026-03-15 covers 2026-02-16 through 2026-03-15. This is the common convention (matches how most issuers describe "statement period"); flagging as an assumption since the request didn't specify.
- View toggle (Month / Statement) only appears when the transactions list is scoped to a single credit card account. "All accounts" and non-credit-card accounts keep calendar-month-only (statement periods aren't meaningful across accounts or for non-revolving accounts).
- Reuses the existing `from`/`to` date-range filtering already in `listTransactions`/`GET /api/transactions` — no new transaction-listing endpoint needed, just a period-boundary calculator and a picker UI that computes `from`/`to` and refetches.
- Schema change authorized by this task (user explicitly asked for configurable statement date per card, which requires persisting it).

## Data model change

- `Account.statementDay Int?` — new nullable column, migration required.

## Implementation Checklist

- [x] Add `statementDay` to `prisma/schema.prisma`, run migration
- [x] `lib/statement.ts` — pure helper: `getStatementPeriod(statementDay, referenceDate)` → `{ start, end }`, plus prev/next period navigation
- [x] Unit tests for `lib/statement.ts` (month boundaries, Jan/Dec wraparound, statementDay near month-end)
- [x] `lib/validators/accounts.ts` — add `statementDay` (1-28, optional, only valid combined with `type: CREDIT_CARD`)
- [x] `lib/services/accounts.ts` — persist/return `statementDay`; update rejects `statementDay` when the resulting type isn't `CREDIT_CARD`, clears it when type changes away
- [x] Account form UI — show `statementDay` input only when type is Credit card
- [x] Transactions page — account filter drives a Month/Statement toggle + prev/next period nav when a single credit card account is selected. Implemented as **client-side filtering of the already-fetched transaction list** (the page already loads all of a user's transactions for the client-side account/category filters) rather than a round-trip using `from`/`to` — simpler given the data is already in hand, and avoids adding loading states to what's currently a snappy client-only filter interaction.
- [x] Unit tests for accounts service covering `statementDay` persistence (reject on non-card, clear on type change, persist on card)
- [x] Update `docs/feature-plans/budget-tracker-mvp.md` data model sketch to note the new field (non-blocking, just keeping docs in sync)
