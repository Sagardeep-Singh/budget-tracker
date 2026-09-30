# CSV import: separate credit and debit columns

## Goal

Import bank exports that put money in and money out in two columns (Credit /
Debit, Deposits / Withdrawals) instead of one signed Amount column.

## Behaviour

- Import mapping gets an "Amounts" choice: one amount column (existing) or
  separate credit and debit columns.
- Split layout: a credit cell becomes INCOME (a payment or refund on a card), a
  debit cell becomes EXPENSE. Cells are read as magnitudes, so a debit written
  as a negative still imports as spending. No sign convention or "Flip signs".
- A row with neither value (balance/pending lines) is dropped. A row with both
  imports the net.
- Headers are guessed (credit/deposit, debit/withdrawal). The split layout is
  picked automatically only when there's no Amount column and both are found.
- Amount cells in both layouts now accept "$1,234.56" and "(45.00)".
- Client-side only: the preview/commit API still receives one amount + type
  per row, so no validator, service or schema change.

## Checklist

- [x] `lib/import.ts`: `parseCsvAmount`, `resolveSplitColumnAmount`, `guessSplitColumns`
- [x] `components/import/import-view.tsx`: layout picker, credit/debit selects
- [x] Unit tests in `tests/unit/lib/import.test.ts`
- [x] e2e: `tests/e2e/import-split-columns.spec.ts`
- [x] `npm run format:fix && npm run lint`, `npm run test`
