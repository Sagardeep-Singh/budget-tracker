# Overview drill-downs to transactions

## Goal

Every figure on Overview that sums transactions links to `/transactions`
filtered to the transactions behind it, the same way Budgets and Trends
already do. Rows in the selected-day panel open that transaction.

## Links

All links carry the Overview month as `from`/`to`. Helpers live in
`lib/dashboard/drilldown.ts` and mirror `getOverviewData`'s math.

| Figure                  | Filters                                              |
| ----------------------- | ---------------------------------------------------- |
| In                      | `type=INCOME`, hide transfers, hide payments         |
| Out                     | `type=EXPENSE`, hide transfers                       |
| Net                     | hide transfers, hide payments                        |
| Budget ring / bar       | category, `type=EXPENSE`, hide transfers             |
| Pie slice / legend row  | slice's categories (none = uncategorized only), same |
| Day panel row           | that day, plus `tx=<id>` to open its drawer          |
| Day panel "View in ..." | that day                                             |

Known gaps, filters can't express them: income linked as a reimbursement
still lists under In/Net, expenses show gross rather than net of
reimbursements, and uncategorized spend folded into "Other" is left out of
that slice's link.

## Day rows: navigate, not a local drawer

The edit drawer (form, delete, reimbursement panel) lives in
`TransactionsView` and needs the full transaction plus accounts and
categories. Overview only has a summary row, so a row links to Transactions
scoped to that day with `?tx=<id>`, which opens the existing drawer on
arrival. Closing the drawer drops `tx` from the URL.

## Checklist

- [x] Expose `categoryId` on budget rings and `categoryIds` on expense slices
- [x] Add `lib/dashboard/drilldown.ts` href helpers
- [x] Link In/Out/Net (desktop hero, mobile cash flow)
- [x] Link budget rings (desktop) and budget bars (mobile)
- [x] Link pie arcs and legend rows
- [x] Day panel rows open the transaction; add "View in Transactions"
- [x] `TransactionsView` opens the drawer from `?tx=`
- [x] Unit tests for the helpers and the service fields
