# Large demo dataset + periodic reseed on Vercel

## Goal

A realistic, large dataset for manual QA and demoing, refreshed on a
schedule on the live deployment — without any risk to real users' data.

## Decision

Seeded into **one fixed demo user** on the live deployment (not a separate
staging DB/project) — user's explicit choice. Every write in the generator
is scoped by that user's own `userId`; there is no global `deleteMany`
anywhere in this path (unlike `prisma/seed.ts`, which is destructive and
stays local-dev-only, unchanged).

Demo mode is controlled by a **Vercel-managed feature flag** (`enable-demo`,
via the `flags` package + `@flags-sdk/vercel`), not an env var — toggle it
from the Vercel dashboard with no redeploy and no env var to edit. One flag
gates both surfaces (the login-page callout and whether the cron actually
reseeds), so they can't drift out of sync.

## What was built

- `prisma/demo-seed.ts` — exports `seedDemoData()`. Upserts a demo user
  (`DEMO_EMAIL`, default `demo@ledger.app`), wipes only that user's own
  transactions/budgets/rules/categories/accounts, then regenerates:
  - 3 accounts (Checking, Savings, Rewards Card with a statement day)
  - default categories + rules (reuses `provisionDefaultsForUser`)
  - 6 months of transactions: paychecks, ~25 categorized expenses/month
    (payees built from the real rule match-text so "Applied" counts on
    the Rules screen are non-zero), ~6 uncategorized/month (half already
    skipped, so the categorize queue looks lived-in), a monthly
    Checking→Savings transfer, and a monthly credit-card statement
    payment pair (Checking EXPENSE + card `isPayment` INCOME, same
    amount) — same pairing the account-aware CSV import and credit-card
    statement-cycle features already handle.
  - budgets on 3 categories set at two different months each, to exercise
    carry-forward-until-changed.
  - Deterministic: seeded PRNG (`mulberry32`), same dataset every run.
- `prisma/run-demo-seed.ts` — thin CLI entry point (`npm run
prisma:seed:demo`), kept separate from `demo-seed.ts` so the importable
  function has no run-on-import side effect (needed because the same
  module is also imported by the API route and the login page).
- `lib/flags.ts` — `enableDemoFlag`, a `flag<boolean>()` from `flags/next`
  using the `@flags-sdk/vercel` adapter, keyed `enable-demo`. Evaluates
  server-side wherever it's `await`ed; no client bundle exposure.
- `app/api/admin/reseed-demo/route.ts` — `GET`, calls `seedDemoData()`.
  Auth: compares the `Authorization` header to `Bearer ${CRON_SECRET}`.
  Vercel Cron only issues GET requests, and automatically attaches that
  exact header when `CRON_SECRET` is set as a project env var — this is
  the only auth this route needs; no custom secret plumbing. Additionally
  gated on `enableDemoFlag()`: with a valid secret but the flag off, the
  route returns `200 { ok: false, skipped: true }` instead of reseeding,
  so the cron keeps firing on schedule and demo mode can be switched off
  purely from the dashboard.
- `vercel.json` — daily cron (`0 6 * * *`) hitting that route.
- `app/(auth)/login/page.tsx` — when `enableDemoFlag()` resolves true,
  shows the demo account's email/password (from `DEMO_EMAIL`/
  `DEMO_PASSWORD`, same source as the seed script) in a callout above the
  sign-in form. Same server-only-evaluation pattern as the existing
  `googleConfigured` check on that page.

## Deploying this

1. Create the flag once: `vercel flags create enable-demo` (or via the
   Vercel dashboard's Flags Explorer). Leave it off by default; turn it on
   when you want demo mode live.
2. Set project env vars: `CRON_SECRET` (any long random value — `openssl
rand -hex 32`), and optionally `DEMO_EMAIL`/`DEMO_PASSWORD` to override
   the seed script's defaults.
3. Vercel picks up `vercel.json` crons automatically on deploy — Cron Jobs
   require a Pro/Enterprise plan (Hobby is limited to daily-or-slower
   schedules on one cron; the configured daily schedule qualifies either
   way).
4. Toggle `enable-demo` on from the dashboard. First reseed happens on the
   next cron firing, or trigger it manually: `curl -H "Authorization:
Bearer $CRON_SECRET" https://<deployment>/api/admin/reseed-demo`.
5. To turn demo mode off: flip `enable-demo` off in the dashboard — no
   redeploy, no env var to touch. The login callout disappears and the
   cron starts no-opping on its next run.
6. Local dev: `vercelAdapter()` needs Vercel's project credentials to
   evaluate the flag outside the Vercel runtime — run `vercel env pull`
   once so the Flags SDK can authenticate, or just accept the flag
   defaulting to false locally.

## Checklist

- [x] `prisma/demo-seed.ts` + `prisma/run-demo-seed.ts`, `npm run
  prisma:seed:demo`
- [x] Verified locally against the dev Postgres: 216 transactions, 3
      accounts, 7 categories, 33 rules, 6 budgets, re-run is idempotent
      (deletes-then-regenerates the same demo user, doesn't accumulate)
- [x] `lib/flags.ts` — `enable-demo` Vercel feature flag
- [x] `app/api/admin/reseed-demo/route.ts`, gated on `CRON_SECRET` +
      the flag
- [x] `vercel.json` cron entry
- [x] Login page shows demo credentials when the flag is on
- [x] `npm run format:fix && npm run lint`, `npx tsc --noEmit`, `npm run
  test` all clean

## Known follow-ups

- Once `feature/transfer-auto-matching` (#41) and
  `feature/import-batch-tracking` (#43) merge, extend the generator to
  also produce `isTransfer`-linked pairs and a couple of `ImportBatch`
  rows, so those features have demo data too — deliberately not done
  here to avoid depending on unmerged branches.
- Not verified: an actual Vercel Cron invocation, or the flag actually
  evaluating true against a live deployment (needs the flag created and
  toggled on a real Vercel project) — only the route/page logic and a
  manual curl trigger are exercisable locally, and locally the flag isn't
  authenticated so it defaults to false.
