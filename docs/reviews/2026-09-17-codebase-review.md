# Codebase Review — 2026-09-17

Scope: `main` @ `8da1e28` (post PR #57, PWA + push reminders merged). Full read-through of `app/`, `components/`, `lib/`, `prisma/schema.prisma`, auth config, and CI. Covers design, architecture, performance, security, and code duplication. No code changes made — findings only.

## Summary

Overall the codebase is disciplined and consistent: every service scopes by `userId`, Zod validates every request boundary, money is handled in cents to avoid float drift, and the service layer never leaks raw Prisma models. The issues below are mostly about **scale** (a few queries that load a user's *entire* history instead of a bounded window) and **repetition** (the same small pieces of logic re-typed in multiple services/components instead of shared). No critical vulnerabilities found.

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 4 |
| Low | 7 |

---

## 1. Architecture & Design

**Good:**
- Clean layering is actually followed: route handler → Zod validator → service → Prisma singleton (`lib/db/prisma.ts`). No business logic found leaking into route handlers.
- Services consistently return `Frontend*` shaped DTOs, never raw Prisma rows (`lib/services/transactions.ts:toFrontend`, similarly in `reimbursements.ts`, `budgets.ts`, etc.).
- Cross-field validation is split correctly: self-contained rules live in Zod refinements (`lib/validators/transactions.ts:refineReimbursable`), state-dependent rules live in the service (`lib/services/transactions.ts:updateTransaction`). This is a good, deliberate split and it's applied consistently.
- Reimbursement status/money math is centralized in `lib/services/reimbursements.ts` (`toCents`/`fromCents`/`deriveReimbursementStatus`) and reused by `transactions.ts` rather than re-derived — this one is done right.

**Findings:**

- **[Low] No middleware-level auth gate — relies on per-route/per-layout discipline.** There's no `middleware.ts`; `app/(protected)/layout.tsx` redirects unauthenticated users, and each of the 29 API routes independently calls `getServerAuthSession()` and checks `session?.user`. Today this is consistently applied (verified — every route except the NextAuth handler and the bearer-token-gated cron route checks it), but the pattern has no structural enforcement: a new route that forgets the check will silently ship. Consider a small `requireSession()` helper (see duplication section) that at least makes the omission a visible one-liner to review, if not a route-level middleware matcher.

- **[Low] `RemindersSection`'s availability gate is a footgun for anyone adding a feature behind an env flag.** `app/(protected)/settings/page.tsx` passes `remindersAvailable={Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)}` — this is fine, but it's exactly the pattern that broke CI for PR #57 (the e2e job didn't set the var, so the gated UI silently didn't render, and 4 tests timed out waiting for it). Worth a one-line comment at the flag's definition pointing at what env vars gate it, so the next optional-feature flag doesn't repeat the CI gap.

---

## 2. Security

**Good:**
- Every service method takes `userId` as its first argument and scopes every Prisma query by it; ownership is also re-checked server-side on update/delete (`assertOwnedRefs` in `transactions.ts`, `findFirst({ id, userId })` pattern used everywhere) rather than trusting a client-supplied ID.
- Password hashing uses bcrypt at 12 rounds (`lib/services/password.ts:BCRYPT_ROUNDS`); change-password requires the current password and rejects a same-as-current new password.
- The cron endpoint (`app/api/cron/reminders/route.ts`) uses a constant-time `timingSafeEqual` comparison (hashed first, so lengths never leak) and fails **closed** (500) if `CRON_SECRET` is unset — good default.
- No raw SQL (`$queryRaw`/`$executeRaw`) anywhere — all Prisma. No `eval`/`new Function`. The only `dangerouslySetInnerHTML` (`app/layout.tsx`) injects a static string literal, not user input — not exploitable.
- CSV import row counts are capped (`max(2000)` in `lib/validators/csv-import.ts`), so a huge-payload DoS via that endpoint is bounded.

**Findings:**

- **[Medium] No rate limiting anywhere, including login and signup.** `signInAction`/`signUpAction` (`lib/auth/actions.ts`) and the Credentials `authorize()` (`lib/auth/config.ts`) have no throttling. This is a self-hosted free multi-user app with public signup, so credential-stuffing / brute-force against `/login` and account-enumeration via signup ("email already exists" — worth checking that error message doesn't leak more than necessary) are both unmitigated. Recommend a lightweight IP+email based limiter (even an in-memory/Upstash-Redis token bucket) in front of the credentials provider and signup action.

- **[Low] No security headers configured.** `next.config.ts` only sets cache headers for `/sw.js`. There's no `X-Frame-Options`/`frame-ancestors` CSP, `X-Content-Type-Options: nosniff`, or `Referrer-Policy`. Vercel's platform defaults cover some of this, but for a finance app it's worth being explicit — clickjacking protection in particular (a transparent iframe over the login/settings pages) costs one `headers()` entry.

- **[Low] `NEXTAUTH_SECRET`/session cookie hardening not verified in code.** JWT strategy is used (`session: { strategy: 'jwt' }` in `lib/auth/config.ts`) with no explicit `maxAge`, meaning it falls back to NextAuth's default (30 days) with no idle timeout. For a budget-tracking app with real financial data, a shorter session lifetime or activity-based expiry is worth considering — currently a stolen JWT is valid for a month regardless of inactivity.

- **[Low] Signup has no email verification.** `createUser` (referenced from `lib/auth/actions.ts`) creates and immediately signs in a user off an unverified email. Low severity for a free personal-use app, but means the app will happily create accounts for emails the signer doesn't own — worth a conscious accept-the-risk note if not already decided.

---

## 3. Performance

- **[Medium] `listTransactions` has no pagination and is called unbounded on the main Transactions page.** `app/(protected)/transactions/page.tsx:12` calls `listTransactions(userId, {})` — no `from`/`to`, and `lib/services/transactions.ts:listTransactions` has no `take`/`skip`/cursor. Every visit to `/transactions` loads **every transaction the user has ever logged**, each with 5 relations included (`account`, `category`, `importBatch`, both link sets). For a multi-year user this will get slow and memory-heavy on every page load. Needs either default date-bounding (e.g. last 3 months) with explicit "load more"/pagination, or a `take` cap with cursor-based paging.

- **[Medium] CSV import loads the user's entire transaction history into memory for dedupe, on every preview *and* every commit.** `lib/services/csvImport.ts:loadExistingKeys` runs `prisma.transaction.findMany({ where: { userId }, select: {...} })` with no date bound, building an in-memory `Set` from the full history — called once in `previewImport` and again in `commitImport`. This scales linearly with account age and runs twice per import. A `date`-windowed query (e.g. ±30 days around the CSV's min/max date) would cut this by orders of magnitude for established accounts, since duplicates can only exist near the import's own date range anyway.

- **[Low] `matchTransfers` also table-scans the user's full unmatched-transaction history** (`lib/services/transfers.ts:matchTransfers`, `findMany({ where: { userId, isTransfer: false, ... } })`, no date bound) and runs automatically after every CSV commit. Same fix shape as above — bound by the imported rows' date range ± the match window.

- **[Low] `matchTransfers` updates run as N sequential `$transaction` calls instead of one.** The final loop (`lib/services/transfers.ts`, `for (const [expenseId, incomeId] of pairs) { await prisma.$transaction([...]) }`) does one DB round-trip pair at a time. For a large import with many transfer pairs this serializes unnecessarily — collecting all updates into a single `prisma.$transaction([...])` call (or `Promise.all` of independent transactions) would cut round-trips from `2N` sequential awaits to one batch.

- **[Low] `Budget.findMany` pulls every budget row ever created, not just the ones through the requested month.** `lib/services/budgets.ts:listBudgets` uses `month: { lte: month }` with no lower bound, relying on in-memory "keep the most recent per category" logic. Given budgets are one row per category per month, this is much smaller than the transactions cases above and likely fine in practice, but it's the same unbounded-query shape — flagging for consistency in case category count grows.

---

## 4. Code Duplication

- **[Low] The `if (!session?.user) return 401` guard is hand-copied into all ~29 API route handlers.** (e.g. `app/api/accounts/route.ts`, `app/api/transactions/route.ts`, `app/api/rules/route.ts`, ...) Every handler repeats:
  ```ts
  const session = await getServerAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  ```
  A small `requireUserId(): Promise<string | NextResponse>` (or a route-wrapping HOF) in `lib/auth/session.ts` would remove ~60 duplicated lines and — more importantly — make the auth check impossible to typo or forget silently, addressing the architecture finding above at the same time.

- **[Low] Month-key (`YYYYMM`) decomposition (`Math.floor(month / 100)`, `month % 100 - 1`) is reimplemented independently in four services**: `lib/services/budgets.ts:monthRange`, `lib/services/overview.ts:monthRange`, `lib/services/trends.ts` (two separate inline spots), and `lib/services/categorize.ts:getUncategorizedMonthSummary`. All four compute the same `{ start, end }` UTC date range from a `YYYYMM` int, with two subtly different return shapes (one also returns `daysInMonth`). Worth extracting to `lib/date.ts` (or similar) as a single `monthRange(month)` + optional `daysInMonth(month)`, since a UTC-boundary bug fixed in one copy (there's already careful UTC handling here) won't propagate to the other three.

- **[Low] Every client component hand-rolls its own `fetch` + JSON + error-handling boilerplate.** 13 components (`budgets-view.tsx`, `rules-view.tsx`, `reminders-section.tsx`, `accounts-view.tsx`, `change-password-form.tsx`, `reimbursement-link-picker.tsx`, `reimbursement-panel.tsx`, `transactions-view.tsx`, `categories-view.tsx`, ...) each write their own `fetch('/api/...', { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(...) })` and then separately check `res.ok`. None of it is complex, but a tiny shared `lib/api-client.ts` (`postJSON`, `patchJSON`, `deleteJSON`) would remove the repeated header/stringify boilerplate and centralize error handling (e.g. consistent parsing of a service's `{ error: string }` response body, which today each component does slightly differently).

- **[Low] `compileRuleMatcher`/matcher-compilation is correctly *not* duplicated** — worth noting as a positive: `categorize.ts`, `csvImport.ts`, and `reimbursements.ts` all import the same `compileRuleMatcher` rather than re-implementing substring matching. Called out so it isn't mistaken for a gap during triage.

---

## Suggested priority order

1. Bound `listTransactions` (pagination/date default) — user-facing perf, grows with every user's account age.
2. Bound `loadExistingKeys` / `matchTransfers` by date window — same root cause, compounds on every CSV import.
3. Add basic rate limiting to login/signup.
4. Extract `requireUserId()` helper — cheap, removes 29x duplication, closes the "forgot the auth check" risk.
5. Extract shared `monthRange()` — cheap, removes a 4x duplicated date-math foot-gun.
6. Security headers (CSP/X-Frame-Options) — cheap, defense in depth.
7. Shared `fetch` client helper — nice-to-have, lowest risk/impact of the list.
