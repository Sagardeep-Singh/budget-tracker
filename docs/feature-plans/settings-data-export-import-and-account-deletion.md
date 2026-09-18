# Settings: data export / import and account deletion

Two Settings features on one shared foundation (every `userId`-scoped table, one
atomic write path):

1. **Export my data** — one versioned JSON file containing all 7 user-scoped models.
2. **Import my data** — full-replace restore from that same file.
3. **Delete my account** — hard, atomic, re-authenticated deletion of the user and all their rows.

Scope, decisions, and invariants come from the product-manager brief. This document
resolves the 6 open questions it left open and is the execution spec.

## Non-goals

- Theme/palette preferences — localStorage-only, no server rows, out of scope.
- NextAuth `Account`/`Session` tables — do not exist (JWT strategy, no adapter). Nothing to export or delete.
- Merge/append import, partial import, per-model import, empty-account-only restriction.
- Soft delete, anonymize, grace period, "export before delete" bundling.
- Any change to the CSV import/dedupe pipeline. Restored `ImportBatch` rows are inert historical records; they are **not** replayed through `lib/services/csvImport.ts`.
- Rate limiting on password re-entry for deletion.

---

## Decisions (PM's 6 open questions, resolved)

### 1. Imported records get **new ids**, with a consistent old→new remap

Regenerate. Ids are the global primary key of each table, not per-user — keeping the
file's original ids means a second user importing the same export file (or the same
user re-importing after a partial restore elsewhere) hits a primary-key collision and
the import fails for a reason the user cannot act on. Regeneration also removes any
path where a crafted file writes a row carrying another user's existing id.

Ids are generated with `randomUUID()` from `node:crypto`. No new dependency, and the
repo already mints ids this way (`lib/services/transfers.ts` uses `randomUUID()` for
`transferMatchId`). Consequence to accept knowingly: after an import, a user's tables
contain a mix of Prisma-generated cuids (pre-existing rows elsewhere in the DB) and
UUID strings. The columns are `String @id` with no format validation anywhere in the
codebase, so nothing breaks; this is a deliberate tradeoff, not an oversight.

`transferMatchId` gets its **own** map, separate from the transaction id map.
Verified in `lib/services/transfers.ts`: `transferMatchId` is an independently minted
`randomUUID()`, not a copy of either leg's transaction id. It must be remapped as its
own namespace (`oldMatchId → newMatchId`), applied identically to both legs, or
transfer pairs silently decouple.

### 2. `Category.isDefault` rows are wiped too; the file is the whole truth

Full-replace wipes every category including `isDefault: true` ones, then writes
exactly what the file contains, preserving each row's `isDefault` value verbatim.
No re-provisioning. Direct evidence: `provisionDefaultsForUser` in
`lib/services/defaults.ts` documents itself as "Used only by the dev seed script —
real sign-ups (credentials and Google) intentionally start with no prepopulated
data." There is no product expectation that a user always has default categories, so
there is nothing to re-seed.

### 3. File size cap: **10 MB** request body, plus a **50,000-row** total record cap

Two independent guards, both enforced before any parsing/writing:

- **Byte cap (10 MB).** Reject on `Content-Length` when present, and re-check the
  actual byte length of `await request.text()` before `JSON.parse` (a client can lie
  about or omit `Content-Length`). Note: `await request.json()` parses before you can
  measure, so the route must read `text()` first. There is no framework-level body
  limit to rely on here — Next's documented `bodySizeLimit` (1 MB default) applies to
  **Server Actions only**, not Route Handlers (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`).
- **Record cap (50,000).** Sum of rows across all 7 arrays, checked by the Zod schema.
  Bounds worst-case validation and transaction time independently of JSON verbosity.

10 MB comfortably holds well past 50k transactions of this shape; the record cap is
the binding constraint in practice, and the byte cap is the cheap DoS guard.

### 4. **Synchronous** request for both export and import

Confirmed. Personal-scale app, single user's data, no job runner/queue infrastructure
exists and introducing one for this is disproportionate. Export is a single
`GET` returning the file with `Content-Disposition: attachment`. Import is a single
`POST` that validates then writes in one `$transaction`. Both routes set
`export const maxDuration = 60` (route segment config) so the platform does not cut
long imports short. Route Handlers are not cached by default, and both handlers call
`auth()` (request-time API), so no caching opt-out is needed.

### 5. Account deletion uses **explicit ordered deletes in one `$transaction`** — no schema change

Confirmed, taking PM's recommendation. **`prisma/schema.prisma` is NOT modified by
this feature and no migration is created.** Changing `ReimbursementLink.expense` /
`.income` from `onDelete: Restrict` to `Cascade` would be a schema change requiring
explicit task authorization per CLAUDE.md, and it would weaken a guard that exists on
purpose: the `Restrict` is what makes `lib/services/reimbursements.ts` able to refuse
deleting a linked transaction. Ordered deletes get the same result with no schema
risk and no migration.

Ordering rationale (checked against the schema):

1. `reimbursementLink.deleteMany({ where: { userId } })` — first, so the `Restrict`
   FKs onto `Transaction` are gone before transactions are touched.
2. `budget.deleteMany({ where: { userId } })` and `categoryRule.deleteMany({ where: { userId } })` — before categories (both Cascade off `Category`; deleting explicitly keeps the sequence deterministic).
3. `transaction.deleteMany({ where: { userId } })` — after links, before `ImportBatch`, so the `SetNull` on `importBatchId` never has rows to rewrite.
4. `importBatch.deleteMany({ where: { userId } })` — before `Account` (its `accountId` FK is Cascade).
5. `category.deleteMany({ where: { userId } })`
6. `account.deleteMany({ where: { userId } })`
7. `user.delete({ where: { id: userId } })` — deletion only; the import wipe stops after step 6.

The same steps 1–6 are the wipe half of a full-replace import; they live in one
shared internal helper so the two paths cannot drift.

`$transaction` options: `{ timeout: 30_000, maxWait: 10_000 }` for deletion and
`{ timeout: 60_000, maxWait: 10_000 }` for wipe+import. Prisma's defaults (5s timeout
/ 2s maxWait) will not survive a few thousand rows.

### 6. Stale JWT for a deleted user is handled in the **`jwt` callback** in `lib/auth/config.ts`

There is no `middleware.ts` in this repo (verified) and no shared route wrapper —
every API route independently does `const session = await getServerAuthSession(); if (!session?.user) return 401`,
and `app/(protected)/layout.tsx` does `if (!session?.user) redirect('/login')`. So the
one place that is already upstream of all of them is the `jwt` callback.

`@auth/core` types the `jwt` callback as `Awaitable<JWT | null>` and
`node_modules/@auth/core/lib/actions/session.js` branches on `if (token !== null)` —
returning `null` skips building the session and pushes `sessionStore.clean()`. The
cookie clear applies on the route-handler / server-action path; inside a Server
Component (the protected layout) `auth()` cannot mutate cookies, so the clear is
best-effort there and the **null session** is what enforces the redirect — expected,
not a bug. Result: `auth()` resolves to `null`, every existing
`if (!session?.user)` guard fires, pages redirect and API routes return 401. **Zero
churn on ~20 existing route handlers.**

Placement: **after** the existing `if (user) { ... }` block, guarded on `token.userId`
being set — sign-in/sign-up already just loaded or created the user, so it must not
pay a second lookup; only subsequent reads do. The lookup is
`prisma.user.findUnique({ where: { id: token.userId }, select: { id: true } })`;
return `null` when it misses.

Explicitly **no** `checkedAt` throttle. Caching the existence check for e.g. 60s would
mean a deleted user's other devices keep working for up to a minute, which
contradicts the atomic hard-delete guarantee that is the point of the feature. One
indexed primary-key lookup per `auth()` call is the accepted cost.

### 7. A Google-only account needs its own live re-authentication factor for deletion — type-to-confirm alone is not enough

Gap in the original spec, closed here: decision 5's step 3 treated `passwordHash ===
null` (Google-only) as "skip; type-to-confirm is the sole factor." That is not an
authentication factor at all — the confirm-email input's own label reads `Type
{email} to confirm` (§ UI spec below), so the value being "verified" is printed right
next to the field. For a credentials user, `currentPassword` is live proof they still
hold the secret, independent of the browser session being authenticated. A Google-only
user has no equivalent: anyone at an unlocked, already-signed-in browser tab can delete
the account with zero secret knowledge. This is asymmetric in a way that matters most
precisely for the most destructive action in the app.

**Fix: reuse the identity provider as the second factor.** Google-only deletion
requires a **fresh, interactive Google OAuth round-trip** completed immediately before
the delete request — the same shape of guarantee `currentPassword` gives credentials
users ("prove it again, right now"), just via the provider that already vouches for
this account instead of a password that was never set.

**Mechanism:**

- `signIn('google', { redirectTo: '/settings' }, { prompt: 'login' })` — the third
  argument is NextAuth v5's `authorizationParams` (`node_modules/next-auth/index.d.ts`
  confirms `signIn` accepts `authorizationParams?: string[][] | Record<string, string>
| string | URLSearchParams` as a third positional argument). `prompt: 'login'` forces
  Google to re-show its authentication screen even when Google's own IdP session
  cookie is still active — `select_account` alone would not do this, since it only
  offers an account picker and can silently reuse an existing Google session with no
  credential re-entry. `prompt: 'login'` is the minimum that makes this a real "prove
  you still control this account" step rather than a no-op redirect.
- The existing `jwt` callback in `lib/auth/config.ts` already branches on
  `account?.provider === 'google'` on every completed Google sign-in (verified: this
  runs regardless of whether the user already existed, since `account` is populated by
  NextAuth whenever an OAuth handshake just completed — not only on first-ever
  sign-in). Add one line there: `token.reauthenticatedAt = Date.now()` inside that
  branch. No new callback, no new branch condition — just one extra assignment on a
  code path that already runs on every Google sign-in, including this re-auth one.
- Expose it to the server: add `session.user.reauthenticatedAt = (token.reauthenticatedAt as number | undefined) ?? null`
  in the `session` callback.
- **The window is 5 minutes**, matching the general "prove it again, recently"
  convention (e.g. GitHub's sudo-mode-style re-auth windows) and long enough to cover
  the OAuth redirect round-trip plus the user reading the confirm copy and typing their
  email, without staying valid long enough to become a standing bypass.
- **The server, never the client, is the authority on freshness.** The DELETE route
  reads `session.user.reauthenticatedAt` from the request's own session — not from
  anything the client POSTs — and re-checks the 5-minute window at request time. A
  client-supplied "I reauthenticated" flag would be trivially spoofable; deriving it
  from the signed JWT is not.
- Scope note: `reauthenticatedAt` is a narrow claim read by exactly one check (account
  deletion for a passwordless user). It is not a general "sudo mode" — no other route
  reads it in this pass, and extending it to gate other destructive actions later is a
  separate, explicitly-scoped task.

---

## Export / import envelope

Export output **is** the import input: a file produced by export and fed straight
back to import must restore an equivalent state (ids differ, everything else matches).
That round-trip is a stated acceptance criterion.

### Envelope

| field           | type                | notes                                                                                                  |
| --------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| `formatVersion` | number, literal `1` | version gate; import rejects anything else with "This file was made by a different version of Ledger." |
| `exportedAt`    | ISO-8601 UTC string | metadata only, ignored on import                                                                       |
| `user.email`    | string              | read-only metadata, ignored on import                                                                  |
| `user.name`     | string or null      | read-only metadata, ignored on import                                                                  |
| `data`          | object              | the 7 model arrays below                                                                               |

`passwordHash` is never exported. **No model array carries `userId`** — it is
meaningless in the file (import always writes the session's `userId`) and its presence
invites a writer bug that scopes restored rows to a foreign user. The Zod schema
uses strict object shapes so a `userId` key in a hand-edited file is rejected rather
than silently honoured.

Serialization rules:

- `Decimal` → string with exactly 2 decimal places (e.g. `"1234.50"`). Lossless, no float rounding. Import parses back with Prisma's `Decimal`/string input. **`Account.startingBalance` may be negative** and serializes with a leading `-` (`/^-?\d+\.\d{2}$/`); `lib/validators/accounts.ts` accepts any finite number there (`z.coerce.number().finite()`) and a card with a balance owed is the normal case. `amount`, `limitAmount`, and `reimbursementExpectedAmount` are non-negative (`/^\d+\.\d{2}$/`).
- `DateTime` → ISO-8601 UTC string (`toISOString()`). Nullable date fields serialize as `null`.
- `Budget.month` stays the `Int` `YYYYMM` it already is — not reformatted into a date.
- Enums serialize as their string member (`CHECKING`, `INCOME`, `ACTIVE`, …).

### `data` arrays (field-for-field, minus `userId`)

- **`accounts`** — `id`, `name`, `type` (AccountType enum), `startingBalance` (decimal string), `statementDay` (int 1–28 or null), `createdAt`.
- **`categories`** — `id`, `name`, `isDefault`, `createdAt`.
- **`importBatches`** — `id`, `accountId`, `filename`, `filenameNormalized`, `status` (enum), `rowCount`, `importedCount`, `skippedDuplicates`, `dateFrom`, `dateTo`, `createdAt`, `undoneAt` (nullable).
- **`transactions`** — `id`, `accountId`, `categoryId` (nullable), `amount` (decimal string), `type` (enum), `date`, `payee` (nullable), `note` (nullable), `importBatchId` (nullable), `isPayment`, `isTransfer`, `transferMatchId` (nullable), `isReimbursable`, `reimbursementExpectedAmount` (decimal string or null), `reimbursementCompletedAt` (nullable), `skippedAt` (nullable), `createdAt`.
- **`budgets`** — `id`, `categoryId`, `month` (int), `limitAmount` (decimal string).
- **`categoryRules`** — `id`, `categoryId`, `matchText`, `priority`.
- **`reimbursementLinks`** — `id`, `expenseTransactionId`, `incomeTransactionId`, `amount` (decimal string), `createdAt`.

### Validation (all of it runs **before** the `$transaction` opens)

Structural/type-level (Zod, `lib/validators/user-data.ts`):

- `formatVersion === 1`; every array present (may be empty); strict objects (`z.strictObject()` — Zod 4 syntax, the repo is on `zod ^4.5.4`; there is no `.strict()` method); enum membership; int ranges; ISO-8601 parse for every date; decimal strings match the per-field patterns above.
- Total records across all arrays ≤ 50,000.
- `amount` and `limitAmount` are **non-negative** — sign lives in `type`; `lib/services/csvImport.ts` stores `Math.abs(amount)`, so a negative amount in a file would corrupt every aggregate.
- `Budget.month` is a plausible `YYYYMM` (`1900_01`–`9999_12`, month part 01–12).
- `statementDay` 1–28 when present, and only meaningful (not required) for `CREDIT_CARD`.

Cross-reference (a `.superRefine` or a separate service-level pass — one place, run before writes):

- Every `accountId`, `categoryId`, `importBatchId`, `expenseTransactionId`, `incomeTransactionId`, and every `Budget`/`CategoryRule` `categoryId` resolves to an `id` present in the file. Full internal referential integrity; no dangling references.
- Ids are unique within each array.

Domain invariants:

- `isReimbursable === true` ⟺ `reimbursementExpectedAmount !== null`.
- `reimbursementExpectedAmount <= amount`.
- `isReimbursable` mutually exclusive with `isTransfer` and `isPayment`.
- `reimbursementCompletedAt` only set when `isReimbursable`.
- Link endpoints: the expense leg must be a transaction with `type: EXPENSE` **and** `isReimbursable: true`; the income leg must be `type: INCOME`. (Safe to enforce: `updateTransaction` already refuses to un-mark `isReimbursable` while expense links exist, and refuses type changes on linked transactions — see `lib/services/transactions.ts`.)
- Sum of `ReimbursementLink.amount` per expense ≤ that expense's `reimbursementExpectedAmount`.
- `transferMatchId`, when set, is shared by **at most two** transactions — reject 3+, allow 1. A single-leg match id is legitimate existing data: `deleteTransaction` in `lib/services/transactions.ts` deletes one leg without clearing the partner's `transferMatchId`, and `updateTransaction` clears the id only on the row being edited (`transferMatchId: input.isTransfer === false ? null : undefined`). Do **not** couple this to `isTransfer: true` for the same reason.

Uniqueness (these mirror DB composite constraints — without them a crafted or
hand-edited file fails mid-transaction with a raw `P2002` instead of the promised
"validate everything, write nothing"):

- `Category` — no duplicate `name` within the file (mirrors `@@unique([userId, name])`).
- `Budget` — no duplicate `(categoryId, month)` pair (mirrors `@@unique([userId, categoryId, month])`).
- `ReimbursementLink` — no duplicate `(expenseTransactionId, incomeTransactionId)` pair.

Because every check above runs outside the transaction, and the transaction contains
writes only, "any validation failure writes nothing" is structural rather than
incidental.

**Governing principle: the import validator must never be stricter than the write
paths that produce the data.** A rule the services can violate turns a user's own
legitimate export into a rejected import — the worst failure mode this feature has.
Where a proposed invariant and real DB state could diverge, the DB wins; every rule
above was checked against the service that writes the field.

### Id remap algorithm

1. Build four `Map<string, string>`: `accountIds`, `categoryIds`, `importBatchIds`, `transactionIds`. For each row in each array, `map.set(row.id, randomUUID())`.
2. Build a fifth map `transferMatchIds`: for each distinct non-null `transactionsRow.transferMatchId`, `set(old, randomUUID())`. Separate namespace — it is not a transaction id (see decision 1).
3. `Budget`, `CategoryRule`, and `ReimbursementLink` ids are regenerated inline (nothing references them).
4. Write in dependency order, substituting mapped ids on every FK:
   `accounts` → `categories` → `importBatches` (`accountId`) → `transactions` (`accountId`, `categoryId`, `importBatchId`, `transferMatchId`) → `budgets` + `categoryRules` (`categoryId`) → `reimbursementLinks` (`expenseTransactionId`, `incomeTransactionId`).
5. Every written row gets `userId` from the session — never from the file.
6. Use `createMany` per model (explicit ids supplied, so no read-back is needed, unlike the pattern in `lib/services/categoryRules.ts`). Chunk each `createMany` at 5,000 rows to keep individual statements bounded.

Known, correct side effect to record now so it is not filed as a bug later: restored
`ImportBatch` rows with `status: ACTIVE` are visible to `findActiveBatchByFilename`
(`lib/services/importBatches.ts`), so re-importing a CSV with a filename that appears
in restored history will raise the duplicate-filename warning. That is the user's real
history and the correct behavior.

---

## Files

### New

| Path                                          | Purpose                                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/validators/user-data.ts`                 | `userDataFileSchema` (envelope + 7 model arrays + cross-reference/uniqueness/invariant refinements), `MAX_IMPORT_BYTES`, `MAX_IMPORT_RECORDS`, `USER_DATA_FORMAT_VERSION`, exported `UserDataFile` type.                                                                                  |
| `lib/validators/account-deletion.ts`          | `deleteAccountSchema`: `confirmEmail` (required, non-empty) + `currentPassword` (optional string).                                                                                                                                                                                        |
| `lib/services/userData.ts`                    | `exportUserData`, `importUserData`, and the shared internal `wipeUserData(tx, userId)` helper used by both import and deletion.                                                                                                                                                           |
| `lib/services/accountDeletion.ts`             | `deleteUserAccount` — re-auth checks then ordered deletes + `user.delete`.                                                                                                                                                                                                                |
| `app/api/settings/export/route.ts`            | `GET`, returns the file as an attachment.                                                                                                                                                                                                                                                 |
| `app/api/settings/import/route.ts`            | `POST`, byte cap → parse → validate → import.                                                                                                                                                                                                                                             |
| `app/api/settings/account/route.ts`           | `DELETE`, re-auth → delete.                                                                                                                                                                                                                                                               |
| `components/settings/export-data-card.tsx`    | Client card: description + download button. **Fetch + blob download** (not a plain `<a href>`), with loading/error/success states — see "UI component spec" § 1 below; that section is the authority on the exact mechanism, not this row.                                                |
| `components/settings/import-data-card.tsx`    | Client card: file picker, client-side size precheck, destructive confirm via the existing `components/ui/confirm-dialog.tsx`, upload, error/success banner. See "UI component spec" § 2.                                                                                                  |
| `components/settings/delete-account-card.tsx` | Client card: type-to-confirm email field, password field when `hasPassword`, destructive confirm, then calls the **`signOutAfterAccountDeletion()` server action** (not client-side `next-auth/react` `signOut()`) on success — see "UI component spec" § 3, which is the authority here. |
| `tests/unit/services/userData.test.ts`        | Export shape, round-trip, remap correctness (incl. transfer pairs), wipe ordering.                                                                                                                                                                                                        |
| `tests/unit/services/accountDeletion.test.ts` | Re-auth failures, ordered delete, atomicity.                                                                                                                                                                                                                                              |
| `tests/unit/validators/user-data.test.ts`     | Envelope/version, every invariant, every uniqueness rule, caps.                                                                                                                                                                                                                           |
| `tests/e2e/settings-data-management.spec.ts`  | Export download, import happy path + rejection, delete-account flow + post-delete 401/redirect.                                                                                                                                                                                           |

### Modified

| Path                                        | Change                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/auth/config.ts`                        | `jwt` callback: after the `if (user)` block, when `token.userId` is set, verify the user still exists; return `null` if not (decision 6). Also, inside the existing `account?.provider === 'google'` branch, set `token.reauthenticatedAt = Date.now()` (decision 7). `session` callback: expose it as `session.user.reauthenticatedAt`.    |
| `lib/auth/actions.ts`                       | Add `signOutAfterAccountDeletion` (mirrors `signOutAfterPasswordChange`: `await signOut({ redirectTo: '/login?accountDeleted=1' })`, used after a 200 from `DELETE /api/settings/account`) and `reauthenticateWithGoogleAction` (`await signIn('google', { redirectTo: '/settings' }, { prompt: 'login' })`, decision 7's re-auth trigger). |
| `components/settings/settings-view.tsx`     | Render the three new cards. The deletion card needs `hasPassword`, `email`, and `googleReauthenticatedAt`; pass them through.                                                                                                                                                                                                               |
| `app/(protected)/settings/page.tsx`         | Also read `session.user.reauthenticatedAt` and pass it to `SettingsView`/`delete-account-card.tsx` as `googleReauthenticatedAt: number \| null`, alongside the existing `email`/`hasPassword` props (decision 7).                                                                                                                           |
| `lib/services/common.ts`                    | Add `GoogleReauthRequiredError extends Error` (decision 7) — distinct from `ServiceValidationError` so the route maps it to its own status/body and the client can render "Confirm with Google" instead of a generic field error.                                                                                                           |
| `components/auth/google-sign-in-button.tsx` | Accept an optional `action` prop (defaulting to `signInWithGoogleAction`) so `delete-account-card.tsx` can reuse the existing button/glyph markup with `reauthenticateWithGoogleAction` instead of duplicating it. Label stays a prop, unchanged for existing call sites.                                                                   |

**`prisma/schema.prisma`: unchanged. No migration.** Decision 5 exists specifically to
avoid one. If a future reviewer prefers the `Cascade` route, that is a separate,
explicitly authorized schema task.

---

## Service contracts

All signatures are exported arrow functions with explicit return types, take `userId`
as the first argument, scope every Prisma query with `where: { userId, ... }`, and
return plain objects (never raw Prisma models). Failures throw
`ServiceValidationError` from `lib/services/common.ts` — same pattern as
`lib/services/password.ts`'s `changePassword`, so routes map it to a 400 with the
message rendered verbatim, exactly as `app/api/settings/password/route.ts` already does.

**`lib/services/userData.ts`**

- `exportUserData(userId: string): Promise<UserDataFile>` — seven `findMany` calls scoped `where: { userId }`, each with an explicit `select` that omits `userId`, ordered deterministically by `createdAt`/`id` (deterministic output makes the round-trip test meaningful). Serializes decimals to 2dp strings and dates to ISO. Also reads `user.email`/`user.name` for the metadata block. Never selects `passwordHash`.
- `importUserData(userId: string, file: UserDataFile): Promise<{ counts: Record<ModelName, number> }>` — assumes `file` already passed `userDataFileSchema` (route validates). Builds the remap maps, then one `prisma.$transaction(async (tx) => { await wipeUserData(tx, userId); ...createMany in dependency order }, { timeout: 60_000, maxWait: 10_000 })`. Returns per-model inserted counts for the success banner.
- `wipeUserData(tx, userId): Promise<void>` — internal (not exported from the module's public surface unless a test needs it), the ordered `deleteMany` sequence from decision 5 steps 1–6.

**`lib/services/accountDeletion.ts`**

- `deleteUserAccount(userId: string, input: DeleteAccountInput, googleReauthenticatedAt: number | null): Promise<{ ok: true }>` — the third parameter is read by the route from `session.user.reauthenticatedAt` (decision 7), never from the request body.
  1. Load `{ email, passwordHash }` for `userId`; missing user → `ServiceValidationError('Your session is no longer valid. Sign in again.')` (matches `changePassword`'s wording).
  2. `input.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()` → `ServiceValidationError('The email you typed does not match your account email.')`. Universal, both auth types.
  3. When `passwordHash !== null`: require `input.currentPassword` and `bcrypt.compare` it → `ServiceValidationError('Password is incorrect.')` on mismatch. Reuse the `changePassword` bcrypt-verify shape.
     When `passwordHash === null` (Google-only): require `googleReauthenticatedAt !== null && Date.now() - googleReauthenticatedAt <= GOOGLE_REAUTH_WINDOW_MS` (5 minutes) → `GoogleReauthRequiredError('Confirm your identity with Google again, then retry.')` when stale or missing. A distinct error type (not `ServiceValidationError`) so the route/UI can tell "type the email again" apart from "click the Google button again" — see route contract.
  4. One `prisma.$transaction(async (tx) => { await wipeUserData(tx, userId); await tx.user.delete({ where: { id: userId } }); }, { timeout: 30_000, maxWait: 10_000 })`.

## Route contracts

- **`GET /api/settings/export`** — 401 when unauthenticated. 200 with `Content-Type: application/json`, `Content-Disposition: attachment; filename="ledger-data-<YYYY-MM-DD>.json"`, body `JSON.stringify(file, null, 2)`. Modeled on the existing `app/api/rules/export/route.ts`. `export const maxDuration = 60`.
- **`POST /api/settings/import`** — 401 when unauthenticated. Read `Content-Length`; if present and > `MAX_IMPORT_BYTES` → 413. `const text = await request.text()`; re-check byte length → 413. `JSON.parse` in a try/catch → 400 "That file isn't valid JSON." `userDataFileSchema.safeParse` → 400 with `parsed.error.issues[0].message` (single string, matching the password route's comment and the client's verbatim rendering). Then `importUserData`; `ServiceValidationError` → 400, otherwise rethrow. 200 `{ ok: true, counts }`. `export const maxDuration = 60`.
- **`DELETE /api/settings/account`** — 401 when unauthenticated. `deleteAccountSchema.safeParse(await request.json())` → 400. Read `session.user.reauthenticatedAt` from the session (never from the request body — decision 7) and pass it as `deleteUserAccount`'s third argument. `deleteUserAccount` → 200 `{ ok: true }`; `ServiceValidationError` → 400; `GoogleReauthRequiredError` → 428 (Precondition Required — the closest standard status for "prove your identity again before I'll process this") with `{ error: string, requiresGoogleReauth: true }` so the client branches on `requiresGoogleReauth` rather than string-matching the message. No business logic in the handler.

---

## UI component spec

Scope: `components/settings/export-data-card.tsx`, `components/settings/import-data-card.tsx`,
`components/settings/delete-account-card.tsx`, appended (in that order) to
`components/settings/settings-view.tsx` after the existing "Change password" card. The
delete card is last and visually distinguished as destructive.

**Reused as-is, no new visual primitives:** `Button` (`components/ui/button.tsx`),
`Input`/`Label` (`components/ui/field.tsx`), `ConfirmDialog`/`Modal`
(`components/ui/confirm-dialog.tsx`, `components/ui/modal.tsx`). Card chrome follows
`settings-view.tsx`'s existing hand-rolled convention — `border-line bg-paper-raised
rounded-2xl border p-5` divs with a `font-display text-[15px] font-semibold` `<h2>` —
not `components/ui/card.tsx`, which none of the sibling cards use. No new component
library pattern is introduced anywhere below.

**Established status-banner idiom (verified in the codebase, used verbatim):**

- Error: `<p role="alert" className="bg-rose-soft text-rose rounded-lg px-3 py-2 text-sm">` — exact classes from `change-password-form.tsx:95`. `role="alert"` (`aria-live="assertive"`) reliably announces even when it mounts with content already inside it (as `change-password-form.tsx` does) — no extra wiring needed.
- Success / in-progress status: `<p role="status" className="bg-sky-soft text-sky rounded-lg px-4 py-3 text-sm">` — exact classes from `rules-view.tsx:240`. `role="status"` is `aria-live="polite"`. **Unlike `role="alert"`, a `polite` live region is not reliably announced if it is mounted for the first time already containing its message** — most assistive tech needs the region to already exist in the DOM (even empty, or `hidden`) before its text content changes, to fire the announcement. So: render this element unconditionally (e.g. always in the tree, empty string when there is nothing to say, `aria-hidden={!message}` when empty so it doesn't confuse tab order/AT with a blank status region), and only swap its text content on success — don't conditionally mount/unmount it.

There is no `moss`/`brick`/`teal` token in `app/globals.css` — checked directly. The
real palette is `--iris` (accent), `--sky` (informational/success), `--rose`
(destructive/error), each with a `-soft` background pair, plus `--paper`/`--ink`/`--line`.
Everything below uses only these.

**Copy note on the 10 MB figure:** both the import card's client precheck and its
413-mapping below hardcode "10 MB" in user-facing copy while the actual check compares
against the imported `MAX_IMPORT_BYTES` constant. Keep the two in sync deliberately
(e.g. derive the display string from `MAX_IMPORT_BYTES / (1024 * 1024)` rather than a
second hardcoded literal) so the copy can't drift if the cap ever changes.

### 1. `export-data-card.tsx`

**Component tree:** one card div → `<h2>` "Export data" → description `<p>` → `Button`
(icon `Download` from `lucide-react`) → an always-mounted `role="status"` region for
success → a `role="alert"` region for errors (empty/absent until an error exists).

**Props:** none. Self-contained; no server data needed beyond the session cookie the
browser already sends.

**State (local, `useState`):**

```ts
type ExportStatus = 'idle' | 'loading' | 'error';
const [status, setStatus] = useState<ExportStatus>('idle');
const [error, setError] = useState<string | null>(null);
const [successMessage, setSuccessMessage] = useState<string | null>(null);
```

`idle` is also the "empty" state for this card (nothing to show before the first
click). `successMessage` is transient screen-reader-only feedback (see below) — it is
not a persistent visible banner, since the browser's own download UI is the visible
confirmation for sighted users.

**Mechanism — fetch + blob, not a plain `<a href>`:** a plain anchor gets the
`Content-Disposition` filename for free but cannot signal `401`/`500`/network failure
in-page, so the loading/error states the brief requires would be fake. Use `fetch`:

1. `onClick`: `setStatus('loading'); setError(null); setSuccessMessage(null)`.
2. `fetch('/api/settings/export')`. Network throw → `setStatus('error'); setError('Could not reach the server. Check your connection and try again.')`.
3. `!res.ok` → `setStatus('error'); setError('Could not export your data. Try again.')` (generic — an authenticated GET against your own data has no user-actionable failure mode short of the session having gone stale, in which case the page-level 401 redirect already fires).
4. Success: read filename from the `Content-Disposition` response header (parse the `filename="..."` value); if absent, fall back to `ledger-data-<YYYY-MM-DD>.json` built client-side from `new Date()`. `const blob = await res.blob()`, create `URL.createObjectURL(blob)`, create a detached `<a>` with that `href` and the resolved `download` filename, `.click()` it, then `URL.revokeObjectURL(url)`, `setStatus('idle')`, and `setSuccessMessage('Export downloaded.')` — a screen-reader-only announcement (sighted users already see the browser's download indicator, so this text is not also shown as a visible banner).

**Interaction states:**

- Idle: `Button` enabled, no banner.
- Loading: `Button` `loading` prop true (spinner, auto-disabled per `Button`'s own `disabled={disabled || loading}`).
- Error: `role="alert"` banner per the idiom above; `Button` re-enabled so the user can retry immediately.
- Success: no visible banner — the browser's download UI is the sighted confirmation — but the sr-only `role="status"` region announces "Export downloaded." for assistive tech, since the blob-click has no other AT-visible signal.

**Accessibility:** no new dialog, so no new focus-management surface. `Button`
already carries `focus-visible:outline-iris`. The sr-only success region
(`className="sr-only" role="status" aria-live="polite"`, matching the precedent at
`components/transactions/log-a-spend-mobile.tsx:160`) is mounted unconditionally so its
`polite` announcement fires reliably per the live-region note above.

### 2. `import-data-card.tsx`

**Component tree:** card div → `<h2>` "Import data" → description `<p>` (states plainly
that import replaces everything) → native `<input type="file" accept=".json,application/json">`
wrapped with a `Label` (baseline: the plain native file input, not a hidden-input +
styled-label substitute — reuse before inventing a new pattern; if a later polish pass
wants the hidden-input/visible-`Button`-label pattern, it must add `focus-within:` to
the visible label element, since `field.tsx`'s `fieldClass` only defines
`focus:border-iris` with no `focus-within` variant, and that is out of scope for this
first pass) → filename readout once a file is chosen → `Button` "Import" (`variant="danger"`,
icon `Upload`) → `ConfirmDialog` → an always-mounted `role="status"` region for success
→ a `role="alert"` region for errors.

**Props:** none.

**State:**

```ts
type ImportStatus = 'idle' | 'uploading' | 'success' | 'error';
const [file, setFile] = useState<File | null>(null); // null = "empty" state
const [confirmOpen, setConfirmOpen] = useState(false);
const [status, setStatus] = useState<ImportStatus>('idle');
const [message, setMessage] = useState<string | null>(null); // error or success copy
```

**Flow:**

1. **Empty state:** no file chosen. "Import" button absent/disabled; only the file input is interactive.
2. `onChange` on the file input: clear `message`/`status` back to `idle`. If `file.size > MAX_IMPORT_BYTES` (imported from `lib/validators/user-data.ts` — a plain exported constant, safe to import client-side since the module has no server-only imports), reset the input value, keep `file` at `null`, and set `status: 'error'`, `message: "This file is larger than 10 MB and can't be imported."` (10 MB here must read from `MAX_IMPORT_BYTES`, not a second literal — see the copy note above). This is a fast client-side precheck only, not a security control — the route re-checks the real byte length server-side regardless.
3. Valid file selected → `file` set, filename shown, "Import" button enabled.
4. Click "Import" → `setConfirmOpen(true)`. This does **not** upload yet — the `ConfirmDialog` is the destructive gate.
5. `ConfirmDialog` props: `open={confirmOpen}`, `title="Replace all your data?"`, `description={`Importing will permanently delete all your current accounts, transactions, categories, budgets, rules, import history, and reimbursement links, then replace them with the contents of "${file.name}". This cannot be undone.`}`, `confirmLabel="Replace data"`, `danger`, `pending={status === 'uploading'}`, `onCancel={() => setConfirmOpen(false)}` (no-op otherwise — `file` stays selected).

   **Constraint on `ConfirmDialog`:** it accepts `description: string`, not `children` — there is nowhere inside it to render additional form fields. The file is already chosen before the dialog opens; nothing more is collected inside it. Do not extend `ConfirmDialog` with a `children` prop to fit more UI in — it is a shared primitive with four other call sites (`transactions-view.tsx`, `categories-view.tsx`, `accounts-view.tsx`, and the pending `rules-view.tsx`/`budgets-view.tsx` migrations per `docs/feature-plans/confirm-dialogs.md`). No `dialogKey`/`key` remount is needed here either — `ConfirmDialog` holds no internal state of its own to reset between opens.

6. `onConfirm`: `setStatus('uploading')`. `const text = await file.text()`; `fetch('/api/settings/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text })`.
7. Network throw → `setConfirmOpen(false); setStatus('error'); setMessage('Could not reach the server. Check your connection and try again.')`.
8. Non-OK response → `setConfirmOpen(false)`, then branch on status, since a `413` may arrive without a JSON body while `400` always carries `{ error: string }` per the route contract:
   - `413` → `` `That file is larger than the ${MAX_IMPORT_BYTES / (1024 * 1024)} MB import limit.` `` (derived from the constant, not a hardcoded "10").
   - `400` → parse body, `typeof body?.error === 'string' ? body.error : "That file couldn't be imported. Check that it's an unedited Ledger export and try again."` (the `body.error` string is service/validator-owned — e.g. `"This file was made by a different version of Ledger."` or a Zod issue message — render it verbatim, do not restate or rephrase it client-side).
   - anything else (`500`) → `'Something went wrong on our end. Try again.'`
     `setStatus('error')`, keep `file` selected (so the user doesn't have to re-pick to retry the same file after fixing something server-side, though in practice a rejected file usually needs editing outside the app).
9. `200 { ok: true, counts }` → `setConfirmOpen(false); setStatus('success')`, build the message from `counts`, e.g. `"Import complete — replaced your data with 12 accounts, 340 transactions, 8 categories, 5 budgets, 3 rules, 2 import batches, 1 reimbursement link."` Reset the file input (`inputRef.current.value = ''`, `setFile(null)`) so a stale selection can't be re-submitted. **Call `router.refresh()`** (from `next/navigation`, already the codebase's post-mutation pattern — see `docs/feature-plans/confirm-dialogs.md`'s call-site description) so every other server-rendered surface (dashboard, accounts, transactions, budgets — all now showing deleted-then-replaced data) picks up the new state on next navigation. This is not optional: full-replace invalidates the whole app's server-rendered data, not just this card.

**Interaction states:**

- Empty: no file chosen, file input only.
- File selected (idle): filename shown, "Import" enabled.
- Confirming: `ConfirmDialog` open, card behind it inert (native `<dialog>`'s modal semantics).
- Uploading: dialog `pending` (buttons disabled, confirm shows spinner).
- Success: `role="status"` region text set to the counts summary; file input reset to empty. Per the live-region note above, this region must already be present in the DOM (not freshly mounted) for its `polite` announcement to fire — mount it unconditionally alongside the error region.
- Error: `role="alert"` banner with the mapped message; file selection preserved (except the size-precheck case, which clears it since that file can never be valid).

**Accessibility:**

- Focus management for the confirm step is handled by `Modal`: native `<dialog>` +
  `showModal()` gives a browser-implemented focus trap, `Escape` closes it
  (`onCancel={onClose}` is already wired), and focus returns to the invoking "Import"
  button when the dialog closes (`dialog.close()`'s native behavior). **Known gaps in
  the shared `Modal` primitive, flagged here but not fixed as part of this feature**
  (it is used by four other screens; fixing it is a separate, cross-cutting task):
  - The `<dialog>` element has no `aria-labelledby` pointing at its `<h2>` title, so it currently has no accessible name exposed to assistive tech beyond whatever the browser infers.
  - `backdrop:bg-transparent` means there is no dimming behind the dialog — weak visual separation for a destructive confirm specifically, since dimming is one of the cues that this is a blocking, high-stakes prompt.
- The banner (success or error) renders after `ConfirmDialog` has already closed and focus has returned to the "Import" button, so a screen reader user is positioned correctly to have the `role="status"`/`role="alert"` region announced next.
- File input keeps native semantics (`<input type="file">` is fully keyboard-operable — Enter/Space opens the OS picker when focused); no custom keyboard handling needed at the baseline.

### 3. `delete-account-card.tsx`

**Component tree:** card div, `border-rose/40` instead of `border-line` and an
`<h2>` in `text-rose` (reusing `Button`'s own danger-variant tokens — `border-rose/40
text-rose` — rather than inventing a new destructive-card token) → description `<p>`
naming what gets deleted → `Label`+`Input` "Type `{email}` to confirm" → **either**
(`hasPassword`) `Label`+`Input type="password"` "Password" **or** (`!hasPassword`, decision 7) a `GoogleSignInButton`-derived "Confirm identity with Google" button plus a
freshness line → `Button` "Delete account" (`variant="danger"`, icon `Trash2`) →
`ConfirmDialog` → `role="alert"` error region.

**Props:**

```ts
{
  email: string;
  hasPassword: boolean;
  googleReauthenticatedAt: number | null;
}
```

All three already flow from `app/(protected)/settings/page.tsx` → `SettingsView` →
this card; no new data fetch. `googleReauthenticatedAt` is only meaningful when
`!hasPassword` — ignored otherwise.

**State:**

```ts
type DeleteStatus = 'idle' | 'submitting' | 'error';
const GOOGLE_REAUTH_WINDOW_MS = 5 * 60 * 1000; // mirrors the server's window (decision 7)

const [confirmEmailInput, setConfirmEmailInput] = useState('');
const [password, setPassword] = useState('');
const [confirmOpen, setConfirmOpen] = useState(false);
const [status, setStatus] = useState<DeleteStatus>('idle');
const [error, setError] = useState<string | null>(null);

const emailMatches = confirmEmailInput.trim().toLowerCase() === email.toLowerCase();
const googleReauthFresh =
  !hasPassword &&
  googleReauthenticatedAt !== null &&
  Date.now() - googleReauthenticatedAt < GOOGLE_REAUTH_WINDOW_MS;
const canSubmit = emailMatches && (hasPassword ? password.length > 0 : googleReauthFresh);
```

The `.trim().toLowerCase()` compare mirrors the server-side check in
`deleteUserAccount` exactly (same normalization on both sides) — the client gate is a
UX convenience, the server is the actual authority. Likewise `googleReauthFresh` is a
UX convenience only: the server independently re-derives and re-checks freshness from
the session at request time (decision 7), so a stale client-side clock can only ever
make the button _too_ conservative, never too permissive.

**Flow:**

1. **Empty/idle:** confirm-email field empty; for `hasPassword` the password field is
   also empty; for `!hasPassword` the Google button is shown, unclicked or its last
   click has aged out. "Delete account" disabled (`disabled={!canSubmit}`).
2. Typing in the confirm-email (and, when present, password) field updates `canSubmit`
   live; no submit is possible until it's `true`. Wrap the fields in a `<form
onSubmit>` that calls `event.preventDefault()` and re-checks `canSubmit` before
   opening the dialog — defense-in-depth against a browser's implicit-submit-on-Enter
   path, on top of the disabled button.
   2a. **`!hasPassword` only — the Google re-auth sub-step:** render the "Confirm identity
   with Google" button (a `<form action={reauthenticateWithGoogleAction}>` wrapping the
   shared glyph/button, matching `GoogleSignInButton`'s existing markup) whenever
   `!googleReauthFresh`. Clicking it navigates away to Google and back — this is a full
   page round-trip via the server action, not a fetch, so there is no local pending
   state to manage here; the component simply re-renders with a fresh
   `googleReauthenticatedAt` prop after the server redirects back to `/settings`. Once
   `googleReauthFresh` is true, replace the button with a short confirmation line
   ("Confirmed with Google — you have 5 minutes to finish deleting your account.") and
   keep it available to re-trigger (still rendered, not hidden) in case the window
   lapses before the user finishes the rest of the form.
3. Click "Delete account" (enabled) → `setConfirmOpen(true)`. This is the **second**
   gate, on top of type-to-confirm/Google-confirm — matches the plan's "Destructive
   confirm, then..." sequencing; do not skip straight to the request.
4. `ConfirmDialog`: `title="Delete your account?"`, `description="This permanently
deletes your account, accounts, transactions, budgets, categories, rules, and
reimbursement history. This cannot be undone."`, `confirmLabel="Delete account"`,
   `danger`, `pending={status === 'submitting'}`, `onCancel={() =>
setConfirmOpen(false)}`.
5. `onConfirm`: `setStatus('submitting')`. `fetch('/api/settings/account', { method:
'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
confirmEmail: confirmEmailInput, currentPassword: hasPassword ? password :
undefined }) })`. No Google-reauth field is sent — the server reads
   `session.user.reauthenticatedAt` itself (decision 7); the request body only ever
   carries what the _user_ typed.
6. Network throw → `setConfirmOpen(false); setStatus('error'); setError('Could not
reach the server. Check your connection and try again.')`.
7. Non-200 → `setConfirmOpen(false)`, parse body:
   - **`428` with `{ error, requiresGoogleReauth: true }`** (the Google-reauth window
     lapsed between page load and submit — the one failure mode unique to the
     passwordless path): render `body.error` and, since the button already re-renders
     on `googleReauthFresh` alone, no separate handling is needed beyond showing the
     message — the "Confirm identity with Google" button is already back in view
     because `googleReauthFresh` is now false.
   - Otherwise render `body.error` **verbatim** (these are the exact, final strings from
     `deleteUserAccount` — do not paraphrase client-side):
     - `"The email you typed does not match your account email."` — user-actionable: re-type the email exactly.
     - `"Password is incorrect."` — user-actionable: clear the password field (`setPassword('')`) so they retype rather than resubmit a wrong value; keep `confirmEmailInput` as-is.
     - `"Your session is no longer valid. Sign in again."` — not actionable in-place; this means the session/user record is already gone. Show it in the same banner; the next navigation will hit the `jwt`-callback guard and redirect to `/login` on its own, no extra client redirect logic needed.
       `setStatus('error')`.
8. `200 { ok: true }` → do **not** touch local state further (the page is about to
   navigate away). Call the server action **`signOutAfterAccountDeletion()`** (added to
   `lib/auth/actions.ts`, mirroring `signOutAfterPasswordChange`: `await signOut({
redirectTo: '/login?accountDeleted=1' })`). Await it **outside any try/catch** — same
   reason as `change-password-form.tsx`'s existing comment: it's a redirect-throwing
   server action, and catching it would swallow the redirect and strand the user on a
   page whose account no longer exists. This reuses the real established pattern in
   this codebase; it deliberately does **not** use `next-auth/react`'s client-side
   `signOut()`, which has zero precedent anywhere in this repo — the server action
   already satisfies the underlying reason ("drop the cookie without waiting on the
   `jwt`-callback check") because server actions, unlike Server Components, can mutate
   cookies directly.

**Interaction states:**

- Idle/empty: confirm-email (and, for `hasPassword`, password) unfilled; for
  `!hasPassword`, Google not yet confirmed or confirmation aged out. Submit disabled.
- Google-confirming (`!hasPassword` only): user is off on the Google redirect —
  no in-card pending UI, since it's a full navigation, not a fetch.
- Partially filled: `canSubmit` false until both conditions hold; no banner.
- Ready: `canSubmit` true, "Delete account" enabled.
- Confirming: `ConfirmDialog` open.
- Submitting: dialog `pending`.
- Error: `role="alert"` banner with the exact server message; fields retained per point
  7 above (password cleared only on a wrong-password error; for `!hasPassword`, a `428`
  simply leaves the now-unfresh Google button visible again).
- Success: no local success state rendered — the redirect (via the server action) fires
  before any success banner would be seen.

**Accessibility:**

- Type-to-confirm gating must be perceivable to screen reader users independent of the button's `disabled` attribute (which is not reliably announced as "why" on every AT). Add a visually-hidden live hint tied to the input via `aria-describedby`, mounted unconditionally so its `polite` text changes are announced (same live-region caveat as the export/import success regions above):
  ```tsx
  <Input id="confirmEmail" aria-describedby="confirmEmail-hint" ... />
  <p id="confirmEmail-hint" className="sr-only" aria-live="polite">
    {emailMatches ? 'Email confirmed.' : `Type ${email} exactly to enable account deletion.`}
  </p>
  ```
- The password field (when rendered) uses `autoComplete="current-password"`, matching `change-password-form.tsx`'s existing convention.
- The `!hasPassword` Google-confirmation line uses the same `aria-live="polite"`,
  always-mounted idiom as the confirm-email hint above, so its text change (button →
  "Confirmed with Google…") is announced without needing the element to freshly mount.
- `ConfirmDialog`/`Modal` focus trap, Escape-to-cancel, and focus-return-to-invoker behavior apply here exactly as described in the import card's section above, including the same two flagged, unfixed `Modal` gaps (missing `aria-labelledby`, transparent backdrop) — not re-litigated per-component, they're a property of the shared primitive.
- Keyboard: `Input`s, the Google button, and the "Delete account" `Button` are all natively tab-reachable and operable; the `<form onSubmit>` guard (point 2 above) means Enter in either field cannot fire a request before `canSubmit` is true, closing the one implicit-submission gap native HTML forms have around disabled buttons.

---

## Checklist

- [x] Add `lib/validators/user-data.ts`: envelope (`formatVersion` literal 1, `exportedAt`, `user`, `data`), 7 `z.strictObject` per-model schemas without `userId`, decimal-string patterns (signed for `startingBalance`, unsigned elsewhere) and ISO-date refinements, `MAX_IMPORT_BYTES = 10 * 1024 * 1024`, `MAX_IMPORT_RECORDS = 50_000`.
- [x] Add the cross-reference, domain-invariant, and uniqueness refinements to `userDataFileSchema` (full list above), all resolving before any write.
- [x] Add `lib/validators/account-deletion.ts` with `deleteAccountSchema` and `DeleteAccountInput`.
- [x] Add `lib/services/userData.ts` with `exportUserData` (deterministic ordering, explicit `select`, no `passwordHash`, no `userId` in output).
- [x] Add the internal `wipeUserData(tx, userId)` ordered-delete helper in `lib/services/userData.ts` (links → budgets/rules → transactions → importBatches → categories → accounts).
- [x] Add `importUserData` with the five-map remap (incl. the separate `transferMatchId` map) and dependency-ordered chunked `createMany` inside one `$transaction({ timeout: 60_000, maxWait: 10_000 })`.
- [x] Add `lib/services/accountDeletion.ts` with `deleteUserAccount(userId, input, googleReauthenticatedAt)` (email type-to-confirm always; bcrypt verify when `hasPassword`; when `!hasPassword`, check `googleReauthenticatedAt` against a 5-minute window and throw `GoogleReauthRequiredError` if stale/missing; then `wipeUserData` + `user.delete` in one `$transaction({ timeout: 30_000, maxWait: 10_000 })`).
- [x] Add `app/api/settings/export/route.ts` (GET, attachment headers, `maxDuration = 60`).
- [x] Add `app/api/settings/import/route.ts` (POST, `Content-Length` + `text()` byte cap → 413, JSON parse guard, Zod, service, `maxDuration = 60`).
- [x] Add `app/api/settings/account/route.ts` (DELETE, Zod, read `session.user.reauthenticatedAt` and pass it to the service, map `GoogleReauthRequiredError` → 428 `{ error, requiresGoogleReauth: true }`).
- [x] Update `lib/auth/config.ts`: `jwt` callback — after the `if (user)` block and guarded on `token.userId`, look up the user and `return null` when missing (decision 6); inside the existing `account?.provider === 'google'` branch, set `token.reauthenticatedAt = Date.now()` (decision 7). `session` callback — expose `session.user.reauthenticatedAt`.
- [x] Add `GoogleReauthRequiredError` to `lib/services/common.ts` (decision 7).
- [x] Add `signOutAfterAccountDeletion` and `reauthenticateWithGoogleAction` to `lib/auth/actions.ts` (mirrors `signOutAfterPasswordChange`, `redirectTo: '/login?accountDeleted=1'`; and `signIn('google', { redirectTo: '/settings' }, { prompt: 'login' })` respectively).
- [x] Add an optional `action` prop to `components/auth/google-sign-in-button.tsx` (defaults to `signInWithGoogleAction`) so the delete-account card can reuse it with `reauthenticateWithGoogleAction`.
- [x] Add `components/settings/export-data-card.tsx` (fetch+blob download, loading/error states plus an sr-only "Export downloaded." success announcement, per the UI spec).
- [x] Add `components/settings/import-data-card.tsx` (file picker, size precheck derived from `MAX_IMPORT_BYTES`, `ConfirmDialog`, status-keyed error mapping, always-mounted success/error live regions, `router.refresh()` on success).
- [x] Add `components/settings/delete-account-card.tsx` (email type-to-confirm with `aria-describedby` live hint; conditional password field **or** Google re-auth button + freshness line per `hasPassword`; `428`/`requiresGoogleReauth` handling; `ConfirmDialog`; `signOutAfterAccountDeletion()` on success).
- [x] Update `app/(protected)/settings/page.tsx` to also read and pass `session.user.reauthenticatedAt` as `googleReauthenticatedAt`.
- [x] Wire the three cards into `components/settings/settings-view.tsx`, passing `email`, `hasPassword`, and `googleReauthenticatedAt` through.
- [x] Add `tests/unit/validators/user-data.test.ts` — version mismatch, each domain invariant, each uniqueness rule, dangling FKs, record cap, negative amounts, unknown keys.
- [x] Add `tests/unit/services/userData.test.ts` — export omits `passwordHash`/`userId`; export→import round-trip equivalence; remap keeps transfer pairs sharing one new `transferMatchId`; reimbursement links land on the remapped transactions; wipe order; failure writes nothing. **Round-trip comparison must not be positional**: ids are regenerated, and `Budget`/`CategoryRule` have no `createdAt` to sort by, so export→import→export reorders those arrays by new UUID. Compare as multisets, or sort by natural key first — `Budget` by `(resolved category name, month)`, `CategoryRule` by `(priority, matchText)`, `Transaction` by `(date, amount, payee)`.
- [x] Add `tests/unit/services/accountDeletion.test.ts` — wrong email, wrong password, Google-only path with a fresh `googleReauthenticatedAt` (succeeds, no password required), Google-only path with a stale/`null` `googleReauthenticatedAt` (throws `GoogleReauthRequiredError`, nothing written), reimbursement-link `Restrict` does not block, all 7 tables empty after a successful delete, user row gone.
- [x] Add a `jwt`/`session` callback unit or integration check that `reauthenticatedAt` is set only inside the `account?.provider === 'google'` branch (not on every token refresh) and correctly exposed on `session.user`.
- [x] Add `tests/e2e/settings-data-management.spec.ts` — export download, import confirm + success, import rejection on a bad file, delete flow for a credentials user, and a protected route returning 401/redirect for a since-deleted user's still-valid cookie. **Google-only deletion is not e2e-testable here**: there is no real Google IdP in CI (the existing `signup.spec.ts` precedent only asserts the Google button is _hidden_ when `AUTH_GOOGLE_ID` is unset — no test drives a real Google OAuth round-trip anywhere in this repo). The `googleReauthenticatedAt` window logic is covered at the unit level above instead; note this gap explicitly rather than attempting to fake it end-to-end.
- [x] Run `npm run format:fix && npm run lint`, `npm run test`, `npm run test:e2e`.
</content>
