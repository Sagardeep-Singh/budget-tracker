# Transaction totals layout

Show period totals on the mobile Transactions screen and give the desktop totals card more breathing room.

## Changes

- Shared `TransactionTotals` card (`components/transactions/transaction-totals.tsx`) used on both desktop and mobile.
- Credit, Debit and Net each get their own column with a label above the amount; Net is emphasized.
- Amounts kept out of the totals (card payments, transfers, reimbursement income) move to a quieter "Not in totals" footer that only appears when non-zero.
- Mobile totals follow the search box, so they always match the visible list.
- Summary math extracted to `summarizeTransactions` in `lib/transactions/transaction-summary.ts`.

## Checklist

- [x] Extract `summarizeTransactions` with unit tests
- [x] Build `TransactionTotals` component
- [x] Use it on desktop and mobile in `transactions-view.tsx`
- [x] Verify layout at 1280px and 402px widths
