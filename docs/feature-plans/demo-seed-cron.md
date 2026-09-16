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

A single `DEMO_ENABLED` flag controls both surfaces (the login-page
callout and whether the cron actually reseeds) — one on/off switch, not
two things that can drift out of sync.

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
- `app/api/admin/reseed-demo/route.ts` — `GET`, calls `seedDemoData()`.
  Auth: compares the `Authorization` header to `Bearer ${CRON_SECRET}`.
  Vercel Cron only issues GET requests, and automatically attaches that
  exact header when `CRON_SECRET` is set as a project env var — this is
  the only auth this route needs; no custom secret plumbing. Additionally
  gated on `DEMO_ENABLED=true`: with a valid secret but `DEMO_ENABLED`
  unset/false, the route returns `200 { ok: false, skipped: true }`
  instead of reseeding, so the cron keeps firing on schedule and demo mode
  can be switched off without touching `vercel.json` or `CRON_SECRET`.
- `vercel.json` — daily cron (`0 6 * * *`) hitting that route.
- `app/(auth)/login/page.tsx` — when `DEMO_ENABLED=true`, shows the demo
  account's email/password (from `DEMO_EMAIL`/`DEMO_PASSWORD`, same
  source as the seed script) in a callout above the sign-in form.
  Server-rendered, same pattern as the existing `googleConfigured` check
  on the same page — no client-side env exposure, no `NEXT_PUBLIC_`
  prefix needed.

## Deploying this

1. Set project env vars on Vercel: `DEMO_ENABLED="true"`, `CRON_SECRET`
   (any long random value — `openssl rand -hex 32`), and optionally
   `DEMO_EMAIL`/`DEMO_PASSWORD` to override the defaults.
2. Vercel picks up `vercel.json` crons automatically on deploy — Cron Jobs
   require a Pro/Enterprise plan (Hobby is limited to daily-or-slower
   schedules on one cron; the configured daily schedule qualifies either
   way).
3. First deploy creates the demo user on its first cron firing (or
   trigger it manually — see the curl command in the PR description /
   README).
4. To turn demo mode off without undoing any of the above: unset
   `DEMO_ENABLED` (or set it to anything other than `"true"`) — the login
   page stops showing the callout and the cron starts no-opping.

## Checklist

- [x] `prisma/demo-seed.ts` + `prisma/run-demo-seed.ts`, `npm run
  prisma:seed:demo`
- [x] Verified locally against the dev Postgres: 216 transactions, 3
      accounts, 7 categories, 33 rules, 6 budgets, re-run is idempotent
      (deletes-then-regenerates the same demo user, doesn't accumulate)
- [x] `app/api/admin/reseed-demo/route.ts`, gated on `CRON_SECRET` +
      `DEMO_ENABLED`
- [x] `vercel.json` cron entry
- [x] Login page shows demo credentials when `DEMO_ENABLED=true`
- [x] `npm run format:fix && npm run lint`, `npx tsc --noEmit`, `npm run
  test` all clean

## Known follow-ups

- Once `feature/transfer-auto-matching` (#41) and
  `feature/import-batch-tracking` (#43) merge, extend the generator to
  also produce `isTransfer`-linked pairs and a couple of `ImportBatch`
  rows, so those features have demo data too — deliberately not done
  here to avoid depending on unmerged branches.
- Not verified: an actual Vercel Cron invocation (needs a real deployment
  with `CRON_SECRET`/`DEMO_ENABLED` set) — only the route logic and a
  manual curl trigger are exercisable locally.
