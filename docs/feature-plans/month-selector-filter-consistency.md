# Month selector and filter consistency

## Goal

One period control that looks and behaves the same on Overview, Transactions,
Budgets, Categorize and Trends, quick filters on Transactions that share state
and labels with the Filters dialog, and drill-downs from Budgets and Trends into
a pre-filtered Transactions view.

## Decisions (confirmed with the user)

- The shared `PeriodPopover` is the only date control on Transactions. The date
  range inputs leave the Filters dialog. The credit card statement view stays,
  as a helper that writes the statement's dates into the same `from`/`to`
  params. The redundant "By month" / "All time" pill row goes.
- Only Transactions and Categorize get "All time" and "Custom range". Overview,
  Budgets and Trends stay month-only.
- Categorize defaults to all time (it's a queue).
- Type labels are "Spending" / "Income" in both the mobile pills and the dialog.
- `isPayment` / `isTransfer`: explain only, no schema change in this PR.

## Behaviour

- `PeriodSelector` (client) renders the pill, desktop popover and mobile sheet.
  - `PeriodPopover` (month mode, `?month=`) keeps other params (Trends'
    `range`) and drops Overview's `day`.
  - `DateRangePopover` (range mode, `?from=&to=`) keeps every other filter.
    A range that is exactly one calendar month shows as that month; no range
    shows "All time"; anything else shows "Sep 3 – Sep 20, 2026".
- Transactions quick pills (All / Uncategorized / Spending / Income) write
  `type` / `uncategorizedOnly` to the URL, so they and the dialog are one state.
- Budget card click opens `/transactions` filtered to that month, category,
  Spending, and hide transfers (matches how budget spend is computed).
- Notable movers link the same way for the selected trends range.
- Trends by-category bars: the in-progress month label no longer widens its
  column (asterisk plus footnote, `min-w-0`), fixing the 12-month overflow.

## Checklist

- [x] `lib/period-selection.ts`: selection <-> from/to helpers, label, date parsing
- [x] `lib/statement.ts`: `isStatementPeriod`
- [x] `lib/transactions/transaction-filters.ts`: drop dates from badge count, `transactionsHref`
- [x] `PeriodSelector` / `PeriodPopover` / `DateRangePopover`
- [x] Transactions: selector in header, statement helper, URL-backed quick pills
- [x] Filters dialog: remove date range, Reset keeps the period, Spending/Income labels
- [x] Categorize: `getCategorizeQueue` date range, selector in header
- [x] Budgets: clickable cards
- [x] Trends: movers carry `categoryId` and link, bar label fix
- [x] Unit tests: period-selection, statement, transaction-filters, categorize queue, trends movers
- [x] Update e2e specs for the dialog and badge changes
- [x] `npm run format:fix && npm run lint`, `npm run test`
