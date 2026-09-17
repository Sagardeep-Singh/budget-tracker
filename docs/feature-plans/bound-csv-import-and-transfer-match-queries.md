# Bound CSV import dedupe + transfer-match queries by date

Source: `docs/reviews/2026-09-17-codebase-review.md`, findings #2 (Medium) and #3 (Low)
under Performance. Finding #1 (`listTransactions` pagination) is **not** addressed here —
PR #60 built the transactions page's search/filter/period/running-balance/summary logic
entirely client-side over the full `initialTransactions` array, so bounding that query is
now a server-side-aggregation feature, not a query-shape fix. Flagged separately.

## Problem

- `loadExistingKeys` (`lib/services/csvImport.ts`) loads the user's _entire_ transaction
  history to build a dedupe `Set`, once in `previewImport` and again in `commitImport`.
  Dedupe key is `accountId|date(day)|amount|payee` — a duplicate can only exist on a date
  present in the submitted CSV rows, so the query can be bound to that date range.
- `matchTransfers` (`lib/services/transfers.ts`) table-scans the user's full
  `isTransfer: false` history on every CSV commit. Matches only occur within
  `MATCH_WINDOW_DAYS` (5) of a candidate's date, so it can be bound the same way when a
  date range is known (CSV commit path). The manual "Match transfers" button
  (`app/api/transactions/match-transfers/route.ts`) has no date range to bound by — keep
  it unbounded there (no regression, just no speedup).
- `matchTransfers`'s final loop runs `2N` sequential `$transaction` calls (one per pair)
  instead of batching.

## Plan

- [x] Confirm `duplicateKey` includes `date` (day-granularity) — windowing is
      behavior-preserving, not a dedupe semantics change.
- [x] Confirm `matchTransfers` call sites: CSV commit (has a date range) and the manual
      button route (does not).
- [x] `loadExistingKeys(userId, dateFrom, dateTo)`: bound `where.date` to
      `[dateFrom - 1 day, dateTo + 1 day]` (1-day pad for TZ safety); update both call
      sites in `previewImport`/`commitImport` to compute the range from `input.rows`
      up front and pass it through.
- [x] `matchTransfers(userId, dateRange?)`: accept an optional `{ from, to }`; when
      given, bound the query to `[from - MATCH_WINDOW_DAYS, to + MATCH_WINDOW_DAYS]`.
      CSV commit passes the imported batch's date range; the manual route passes
      nothing (unbounded, unchanged behavior).
- [x] Batch `matchTransfers`'s per-pair updates into a single `prisma.$transaction([...])`
      call instead of `N` sequential ones.
- [x] Add/update unit tests for `loadExistingKeys` windowing and `matchTransfers`
      date-bounded + unbounded paths.
- [x] `npm run format:fix && npm run lint` and `npm run test`.
