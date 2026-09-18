# Manual "Match transfers" date-range picker

Manual transfer matching (`app/api/transactions/match-transfers/route.ts` →
`lib/services/transfers.ts:matchTransfers`) currently always table-scans the user's
full history when triggered from the Transactions page button (the service already
accepts an optional `{ from, to }` bound — see
`docs/feature-plans/bound-csv-import-and-transfer-match-queries.md` — but the button
never supplies it). Ask the user for a range before running, defaulting to the last
month.

## Scope

- Presets: **Week** (last 7 days), **Month** (last 1 month, default), **6 months**
  (last 6 months), **Custom range** (two date inputs, from ≤ to).
- All presets anchor to "today" and are inclusive of it.
- No schema change; `matchTransfers` already supports the bound. Only the route needs
  to accept and validate the range, and the button needs a small picker dialog.

## Plan

- [x] `lib/validators/transfers.ts`: `matchTransfersRequestSchema` — optional
      `from`/`to` (`z.coerce.date()`), both-or-neither, `from <= to`.
- [x] `app/api/transactions/match-transfers/route.ts`: parse the JSON body (empty body
      → no range, preserved for any non-UI callers) against the schema, pass the range
      through to `matchTransfers`.
- [x] `components/transactions/match-transfers-dialog.tsx`: pill options
      Week/Month/6 months/Custom (Month selected by default), custom shows two date
      inputs; computes `{ from, to }` and calls `onConfirm`.
- [x] `transactions-view.tsx`: "Match transfers" button opens the dialog instead of
      calling the API directly; dialog's confirm sends the computed range as the
      POST body.
- [x] Unit tests: validator (both-or-neither, from <= to).
- [x] `npm run format:fix && npm run lint` and `npm run test`.
