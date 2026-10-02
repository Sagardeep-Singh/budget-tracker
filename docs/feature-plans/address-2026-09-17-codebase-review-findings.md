# Address 2026-09-17 codebase review findings

Source: `docs/reviews/2026-09-17-codebase-review.md` (through the 2026-09-23 update). Scope
confirmed with user: mechanical/duplication fixes, `Budget.findMany` bound, login/signup rate
limiting (DB-backed), full email verification flow (Brevo), and `listTransactions`
pagination/server-side aggregation. Email verification and rate limiting both require schema
changes — authorized by user in this session.

## Phase 1 — Mechanical fixes (no schema change, direct implementation)

- [x] `lib/auth/session.ts`: add `requireUserId()` returning `string | NextResponse`; migrate all
      ~37 route handlers off the hand-copied `if (!session?.user)` guard.
- [x] `lib/date.ts`: extract shared `monthRange(month)` / `daysInMonth(month)`; migrate
      `budgets.ts`, `overview.ts`, `trends.ts` (×2), `categorize.ts`.
- [x] `next.config.ts`: add security headers (`X-Frame-Options`/`frame-ancestors`,
      `X-Content-Type-Options: nosniff`, `Referrer-Policy`) for all routes.
- [x] `lib/auth/config.ts`: set explicit session `maxAge` (shorter than NextAuth's 30-day default)
      — chosen 7 days + `updateAge: 1 day` (rolling), documented as a judgment call.
- [x] `lib/api-client.ts`: shared `postJSON`/`patchJSON`/`deleteJSON` (+ `getJSON`) helper;
      migrate the ~19 components doing hand-rolled `fetch`.
- [x] `lib/services/budgets.ts:listBudgets`: bound `month: { lte }` with a lower bound (12 months
      back from the requested month — same margin used elsewhere for "keep most recent").

Phase 1 notes (implementation):

- 36 route handler files migrated to `requireUserId()`; `app/api/settings/account/route.ts` uses
  `requireSession()` because it also reads `session.user.reauthenticatedAt`. `getServerAuthSession`
  stays in use by server pages (redirect, not 401).
- `lib/date.ts` also replaced a fifth copy of `daysInMonth` in
  `components/budgets/budgets-view.tsx`; `trends.ts` keeps its local `monthStart` as a one-line
  alias over `monthRange(...).start` (used for month labels).
- `lib/api-client.ts` is result-based (`{ ok, status, error, body, networkError }`), not
  throw-based, because call sites branch on 409/413/428/429 and on error-body fields. It supplies no
  default error copy — each call site keeps its own message.
  `components/settings/export-data-card.tsx` is intentionally not migrated (it reads `res.blob()`
  for the file download). `lib/transactions/use-transaction-form.ts` and `lib/push/client.ts` also
  hand-roll `fetch` outside `components/` — follow-up, out of this item's stated scope.
- `listBudgets`' 12-month lower bound was lossy on its own (a returning user who last touched
  budgets 13+ months ago got an empty Budgets page and empty dashboard budget block). Resolved:
  the bounded query now falls back to the unbounded one only when the bounded query returns zero
  rows, so the common case stays a bounded scan and the result is never lossy. Covered by a new
  unit test (`falls back to an unbounded lookback when a budget predates the 12-month window`).

## Phase 2 — Login/signup rate limiting (DB-backed)

- [x] Schema: `RateLimitBucket` model, generic (scope/key/windowStart/count), not a login-specific
      table — migration `20260924061229_add_rate_limit_bucket`.
- [x] `lib/services/rateLimit.ts`: generic DB-backed fixed-window counter (`checkRateLimit`),
      mirroring `AI_DAILY_SUGGEST_LIMIT`'s shape in `aiCategorize.ts`; opportunistically prunes
      stale buckets on every call instead of needing a cron job.
- [x] Wire into `authorize()` (`lib/auth/config.ts`: `login:ip` 30/15min + `login:email` 10/15min,
      checked before the user lookup so guessing against a nonexistent email still counts) and
      `signUpAction` (`lib/auth/actions.ts`: `signup:ip` 5/hour, checked before `createUser`).
- [x] `lib/http/clientIp.ts` (new): `x-forwarded-for`/`x-real-ip` extraction, falls back to a
      shared "unknown" bucket rather than throwing when neither header is present.
- [x] `lib/auth/errors.ts` (new): `AuthRateLimitedError extends CredentialsSignin` so
      `signInAction` can show "Too many attempts…" instead of the generic
      "Incorrect email or password." — imports from `@auth/core/errors`, not `next-auth`'s index,
      to avoid a `next/server` resolution break under Vitest.
- [x] Unit tests: `tests/unit/services/rateLimit.test.ts`, `tests/unit/lib/clientIp.test.ts`,
      `tests/unit/lib/auth-actions.test.ts` (signup path). No dedicated `authorize()` unit test —
      it's exercised indirectly by existing e2e signup/login specs; a direct rate-limit e2e test
      would need many real requests inside the 15-min window, not attempted here.

## Phase 3 — Email verification (Brevo) — done

- [x] Schema: `User.emailVerified` (nullable, was missing entirely — the plan's original
      assumption that it already existed was wrong) + new `EmailVerificationToken` model
      (one row per user, replaced not appended on resend). Migration
      `20260924061651_add_email_verification`.
- [x] `lib/email/brevo.ts`: transactional send via Brevo's HTTP API (plain `fetch`, same
      module-constant pattern as `lib/ai/anthropic.ts`), env-gated (`BREVO_API_KEY`/
      `BREVO_SENDER_EMAIL` unset ⇒ feature off, not broken — same convention as reminders/AI).
- [x] `lib/services/emailVerification.ts`: token issue/consume (SHA-256 hashed at rest, 24h TTL),
      60s resend cooldown as a discriminated result (not a throw — same shape as the AI
      provider-outage handling).
- [x] Wired into signup (`signUpAction`): best-effort send — a Brevo outage doesn't fail an
      otherwise-successful signup, since resend is always available from the banner. Google
      sign-up sets `emailVerified` immediately (Google already verified it); an existing
      unverified user who later signs in with Google also gets marked verified.
- [x] `app/api/auth/verify/route.ts` (public, no session — the link is clicked from an email
      client) consumes the token and redirects to `/login?verify=verified|invalid|expired`.
      `app/api/auth/verify/resend/route.ts` (authenticated) for the banner's resend button.
- [x] `components/nav/unverified-email-banner.tsx` in the protected layout, shown only when
      configured and unverified — avoids the env-flag-footgun pattern this review already
      flagged elsewhere (queries the service directly rather than threading a boolean prop).
- [x] Unit tests: `rateLimit`-style coverage for the token service, the Brevo client, and
      `clientIpFromHeaders`/actions wiring reused from Phase 2. e2e:
      `tests/e2e/email-verification.spec.ts` + `tests/e2e/fixtures/brevo-server.ts` (same
      fixture-server pattern as the AI provider specs, since the send happens server-side and
      `page.route()` can't reach it) — signup → banner → resend-cooldown → click verify link →
      banner clears; invalid-token path. All 3 pass; verified locally against a scratch
      Playwright config on a free port, since port 3000 was held by an unrelated project's dev
      server in this environment (not touched) — `playwright.config.ts` itself is unchanged and
      correct for CI/normal local use.
- [x] `.env.example`: `BREVO_API_KEY`/`BREVO_SENDER_EMAIL`/`BREVO_SENDER_NAME`/`BREVO_BASE_URL`
      documented, same accept-the-risk framing as before (unset ⇒ signup still works, just
      unverified with no way to verify).

## Phase 4 — `listTransactions` pagination + server-side aggregation

Implemented. Full plan, acceptance criteria, resolved product decisions, and the implementation
notes live in `docs/feature-plans/transactions-server-side-pagination.md`: see its
`### 11. Implementation notes` under `## Architecture` for every deviation and judgment call.

- [x] Product scoping (`transactions-server-side-pagination.md`)
- [x] Software-architect pass — new `lib/transactions/transaction-scope.ts` +
      `lib/services/transactionsPage.ts` (`getTransactionsPage`, additive alongside
      `listTransactions`), additive `paginated=1` branch on `GET /api/transactions`, keyset
      cursor `{date,id}`, two-phase JS-fallback amount search, no schema change needed. Full
      design in `transactions-server-side-pagination.md`'s `## Architecture` section.
- [x] UI-designer pass (Load More control + any new interaction states)
- [x] Tester: unit + e2e test plan
- [x] Implementation
- [x] Tester: review pass — confirmed good independently (lint/tsc/867 unit tests/21 pagination
      e2e + 3 modified specs re-run from a clean scratch Playwright config); see
      `transactions-server-side-pagination.md`'s `## Test Review` for the full findings. One open
      item (login rate limit made the e2e suite unrunnable in one pass) — **fixed**: see notes
      below.

Phase 4 notes (implementation):

- `/transactions` now server-renders page 1: 50 rows, with 5 relations each. It no longer loads
  the whole history. Filters, period, running balance, summary, per-day totals and counts are all
  computed server-side through one `buildTransactionWhere` predicate. The client appends pages via
  "Load more". `listTransactions` and the import-batch detail page are untouched. Their unit tests
  and `import-history.spec.ts` pass unmodified.
- The probe (recorded in the plan's Architecture §4) showed that Prisma 6.19.3's `contains` does
  **not** escape LIKE `%`/`_`. Any term containing them is therefore matched in JS (Mode B), and
  `buildTransactionWhere` structurally never emits such a term into `contains`.
- **Judgment call — money as strings:** the envelope's money fields are cent-exact `toFixed(2)`
  strings, not the plan's `number`. This follows the repo's "serialize money to strings at the
  service edge, never float" convention.
- **Judgment call — SSR refresh handling:** a server re-render for the _same_ URL scope whose
  page 1 actually _changed_ bumps the list's `reloadNonce` and refetches. Mutations made outside
  the view (the layout's add overlay, the form hook, the reimbursement panel) only call
  `router.refresh()`, so without this their new rows would never show up. This relaxes the plan's
  "SSR payload consumed once" rule. Identical re-renders are ignored, such as opening or closing
  the overlay, so Load-more'd pages don't collapse. The in-view edit drawer bumps explicitly, and
  the side effect is that Cancel there also resets the list to page 1.
- **Bug found and fixed along the way:** the payee search's debounce echo guard (from #64) could
  leave a stale `payee=` in the URL when the box was cleared while the previous push was still in
  flight. The guard is now a queue of pending pushes. New e2e case 11b covers both this race and
  the original #64 race.
- **Consequence for existing e2e specs:** `transaction-batch-indicator.spec.ts` and
  `import-undo.spec.ts` import CSV rows dated 2026-03-01 and looked for them on the _unfiltered_
  list, where they now fall past row 50 of the shared dev history. Both now visit
  `/transactions?payee=<their payee>`, with their assertions unchanged. Without that,
  import-undo's "row is gone" check would have passed vacuously. `transaction-filters-dialog.spec.ts`
  now awaits the debounced request, as the plan expected.
- **Unit tests:** `tests/unit/services/transactionsPage.test.ts` (Mode A/B, the where-builder,
  Decimal handling, bucket precedence, the empty-page short-circuit, userId scoping) and
  `tests/unit/services/transactionsPage.parity.test.ts` (a strict where-interpreter diffed against
  `matchesTransactionFilters`, which throws on unknown clause shapes). Also
  `tests/unit/lib/transactions-page-query.test.ts` and new `transactionsPageQuerySchema` cases in
  `tests/unit/validators/transactions.test.ts`. `tests/unit/lib/transaction-filters.test.ts` is
  unchanged.
- **e2e:** `tests/e2e/transactions-pagination.spec.ts` has 21 tests. They cover plan cases 1–14,
  11b, live Mode B API checks (paging, a literal `%`/`_` that must not wildcard, a malformed cursor
  returning 400), overlay open/close not collapsing pages, and the mobile tree. The spec is serial
  with a single login in `beforeAll` and tears down its accounts, category and reimbursement link
  in `afterAll`. It passes 21/21 against a scratch Playwright config on port 3103, the same pattern
  as Phase 3. The checked-in `playwright.config.ts` is unchanged.
  - Every spec that visits `/transactions` passes, plus the unrelated specs, with two exceptions
    that are environment-only and don't touch this work. `signup`'s Google-hidden test fails because
    the local `.env` sets `AUTH_GOOGLE_ID`. `reminders-settings` fails because the local `.env` has
    no VAPID keys. The full list is in the plan's "Verification status".
- **Finding, then fixed — the full e2e suite no longer fit in one run for the dev user.** Phase 2's
  login limit (10 per email per 15 minutes) tripped partway through a multi-spec run. Fixed with
  `E2E_DISABLE_RATE_LIMIT=1`, checked in both `authorize()` and `signUpAction` before either
  rate-limit call, set only in `playwright.config.ts`'s `webServer` env (same shape as the
  `AI_*_BASE_URL`/`BREVO_*` test-only overrides — server-only, read once at module load, never
  request input; documented in `.env.example`). Verified by clearing leftover `RateLimitBucket`
  rows and re-running the exact combination that tripped it
  (`transactions-pagination` + `transaction-filters-dialog` + `transaction-batch-indicator` +
  `import-undo`, 27 tests) in one pass: 27/27 passed.
- **Not verified:** the mobile safe-area occlusion check the UI spec asks for. It needs a real
  device or emulator.

Env additions: `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` (documented in
`.env.example`).
