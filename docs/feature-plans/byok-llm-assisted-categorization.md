# BYOK LLM-assisted transaction categorization

Bring-your-own-key AI suggestion for the Categorize queue. One active provider
(Anthropic **or** OpenAI) per user, key stored encrypted at rest, used only for
an explicit, per-row, on-demand "Suggest with AI" action on rows where **no rule
matched**.

Scope comes from the product-manager brief; this document resolves the three open
questions it left and is the execution spec. **This pass is backend-only**: it
defines the schema, crypto, provider transport, services, validators and HTTP
contracts. The Settings BYOK panel and the Categorize queue button are the
ui-designer's next pass, built against the contracts below.

## Non-goals (v1)

- Bulk / batch / "suggest for all" — explicitly out. Server-enforced via the
  per-request single-`transactionId` contract and the daily rate limit.
- Automatic suggestion on import or on queue load. Strictly user-initiated.
- Auto-creating a `Category` or a `CategoryRule` from an AI answer.
- Learning/feedback loop, accept-rate stats, model choice per request.
- Both providers configured simultaneously. Saving a provider replaces the key.
- Any change to rule-based categorization (`lib/services/categorize.ts` matching
  logic is untouched; only new exports are added alongside it).
- Streaming, caching of suggestions, or storing the model's raw response.

---

## Decisions (PM's 3 open questions, resolved)

### Q1. Live validation on save — **yes, but outage-tolerant**

`saveAiProviderKey` makes one minimal, cheap probe call to the provider before
persisting, and splits on the failure taxonomy we already have to build:

| Probe outcome                 | Behaviour                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------ |
| 200                           | persist, `verifiedAt = now()`                                                  |
| 401 / 403                     | **refuse to persist**, throw `AiProviderAuthError`                             |
| 429 / 5xx / network / timeout | **persist anyway**, `verifiedAt = null`, return `{ verified: false, warning }` |

Rationale: a typo'd key is the overwhelmingly common failure and must be caught
at the point of entry, where the user still has the key on their clipboard. A
provider outage is not the user's fault and must not block saving a good key.
`verifiedAt === null` lets the UI show "saved, not yet verified".

The probe is `listModels()` on the provider adapter — a GET, no tokens billed, no
user data sent. See "Provider abstraction".

### Q2. Suggestion provenance on `Transaction` — **explicitly deferred**

Not added. The reason is repo mechanics, not taste: any new `Transaction` column
ripples into `exportUserData`'s explicit `select`, `importUserData`'s
`createMany`, the `transactions` shape in `lib/validators/user-data.ts`, and a
`USER_DATA_FORMAT_VERSION` bump plus back-compat handling for v1 files. That is
not a cheap forward-compatible column; it is a data-format change. v1's UI does
not consume it. When a feature actually needs provenance (accept-rate metrics, a
"review AI picks" view), add it then, together with the format bump it requires.

### Q3. Note/amount opt-in toggles — **columns on the new per-user table**

They live beside the key on `UserAiSettings`, following the
`NotificationPreference` precedent exactly: `userId String @unique`, optional 1-1
on `User`, **absence of a row means BYOK is not configured**, which is the state
of every existing and new user, so no backfill migration is needed. The toggles
are meaningless without a key, so a separate table or a JSON preferences blob
would only add a join and a second write path.

---

## 1. Schema impact

> **⚠️ Requires explicit authorization.** CLAUDE.md forbids touching
> `prisma/schema.prisma` or migrations unless the task requires it. This feature
> does require it, but the migration must be **reviewed and approved by the user
> before `npm run prisma:migrate` is run**. The architect pass does not edit the
> schema file. The developer must get a go-ahead on the exact model below first.

One new enum and one new model. No changes to any existing model except the
`User` back-relation line.

```prisma
enum AiProvider {
  ANTHROPIC
  OPENAI
}

/// per-user BYOK settings for AI-assisted categorization. A row exists only
/// once the user saves a key from Settings — absence of a row means the
/// feature is off, which is the default for every existing and new user, so
/// no backfill migration is needed. Deliberately excluded from data export
/// (see lib/services/userData.ts) and preserved across data import.
model UserAiSettings {
  id     String     @id @default(cuid())
  userId String     @unique
  provider AiProvider
  /// AES-256-GCM ciphertext of the provider API key, packed as
  /// "v1:<iv-b64>:<tag-b64>:<ciphertext-b64>" by lib/crypto/secrets.ts.
  /// Never returned by any service, never logged, never exported.
  encryptedApiKey String
  /// last 4 chars of the plaintext key, stored separately so Settings can
  /// render "sk-…a1b2" without ever decrypting. Display-only.
  keyLast4        String
  /// set when a probe call to the provider last succeeded. null means the key
  /// was persisted during a provider outage and is unverified (see Q1).
  verifiedAt      DateTime?
  /// opt-in: include Transaction.note in the prompt. Default off per PM.
  sendNote        Boolean  @default(false)
  /// opt-in: include Transaction.amount in the prompt. Default off per PM.
  sendAmount      Boolean  @default(false)
  /// set the first time the user acknowledges the data-disclosure panel;
  /// the suggest endpoint refuses to run while null.
  disclosureAcceptedAt DateTime?
  /// UTC calendar date (YYYYMMDD int, same idiom as Budget.month) the
  /// suggest counter belongs to; rolls the counter over without a cron job
  suggestCountDate Int?
  /// suggest calls made on suggestCountDate. DB-backed because Vercel
  /// serverless is multi-instance: an in-memory limiter would not limit.
  suggestCount     Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

On `User`, add one line: `aiSettings UserAiSettings?`

**Migration name:** `add_user_ai_settings`. Additive only — one new table, one
new enum, no column changes, no backfill, no data loss. Safe to `prisma migrate
deploy` on an existing database.

### Deletion / export / import interactions

- **Account deletion:** `onDelete: Cascade` on the `user` relation means
  `tx.user.delete()` in `lib/services/accountDeletion.ts` already wipes the row.
  No change to `accountDeletion.ts`.
- **Data export:** `exportUserData` builds an explicit `select` per model and
  never touches models it doesn't list. So the exclusion is **by omission** —
  the same mechanism that already keeps `passwordHash` out. **No change to the
  export path**, plus a regression test asserting the export payload contains no
  `provider` / `encryptedApiKey` / `keyLast4` key anywhere.
- **Data import (`wipeUserData`) — the trap:** `wipeUserData` is shared by
  account deletion _and_ full-replace restore. `UserAiSettings` must **not** be
  added to it. If it were, restoring a backup would silently destroy the user's
  key — and because the key is excluded from export, it could never come back.
  Decision: `wipeUserData` is unchanged; restore preserves AI settings. Locked
  in by a unit test named "restore-from-backup preserves AI provider settings".

---

## 2. Encryption at rest

New directory `lib/crypto/`, mirroring the `lib/push/` precedent: transport- and
crypto-level concerns live outside `lib/services/` so the business-logic layer
depends on a small pure interface and stays unit-testable.

**File: `lib/crypto/secrets.ts`**

- Algorithm: **AES-256-GCM**, `node:crypto`, 12-byte random IV per encryption,
  16-byte auth tag.
- Master key: `SECRET_ENCRYPTION_KEY` env var, 32 bytes base64-encoded
  (`openssl rand -base64 32`). Server-only — never `NEXT_PUBLIC_`.
- **AAD = the `userId`.** A ciphertext blob copied into another user's row fails
  authentication instead of decrypting. This is what makes a DB-write-primitive
  non-exploitable for key theft.
- **Packing:** `v1:<iv-b64>:<tag-b64>:<ct-b64>` in one column. The `v1` prefix is
  what makes the rotation runbook writable — a v2 key can be introduced and old
  blobs read by prefix during migration.
- **Configuration idiom:** mirrors `isPushConfigured()` / `AUTH_GOOGLE_ID`.
  Unset env var must not crash at import time; it makes the feature invisible.

```ts
export const isSecretEncryptionConfigured = (): boolean =>
  Boolean(process.env.SECRET_ENCRYPTION_KEY);

/** throws SecretEncryptionUnavailableError when unconfigured or key is malformed */
export const encryptSecret = (plaintext: string, aad: string): string;
export const decryptSecret = (packed: string, aad: string): string;
export const maskLast4 = (plaintext: string): string;
```

`encryptSecret`/`decryptSecret` are **pure and synchronous** — no Prisma, no
`lib/db`. They sit below the service layer and are imported by
`lib/services/aiSettings.ts` only. Nothing in `app/` imports them directly.

**Runtime:** `node:crypto` is not edge-safe. Every route handler that reaches
this path declares `export const runtime = 'nodejs'`.

**Rotation — documented manual runbook, no tooling built.** Add a
`docs/runbooks/rotate-secret-encryption-key.md` section covering: (a) generate a
new key, (b) set `SECRET_ENCRYPTION_KEY_NEXT`, (c) run a one-off `tsx` script
that decrypts each `UserAiSettings.encryptedApiKey` with the old key and
re-encrypts with the new, writing a `v2:` prefix, (d) promote `NEXT` to primary.
Simpler fallback if that is too much for a hobby deploy, and the one to document
first: **rotation = every user re-enters their key**. `DELETE FROM
"UserAiSettings"` and let users re-save; the feature is opt-in, non-destructive
to financial data, and the blast radius is a settings panel.

---

## 3. Provider abstraction

New directory `lib/ai/`, same rationale as `lib/push/`.

**Decision: hand-rolled `fetch`, no SDK.** Neither `@anthropic-ai/sdk` nor
`openai` is currently a dependency (verified in `package.json`). Each provider
needs exactly one POST endpoint and one GET probe. The discriminating constraint
is the hard outbound timeout from the security checklist: `fetch` +
`AbortSignal.timeout(ms)` gives it directly and unconditionally, where SDK
timeout/retry/backoff behaviour is another surface to configure, mock and audit.
Alternative considered: official SDKs, for typed request/response and built-in
retries. Rejected — two added dependencies plus their transitive trees in a
public repo, for two endpoints, and their auto-retry actively fights our
per-user rate limit. Revisit if we ever need streaming or tool-use loops.

**File: `lib/ai/types.ts`** — the SDK-free boundary. Nothing below leaks a
provider-specific type to a service or a route.

```ts
export type AiSuggestionRequest = {
  payee: string;
  type: 'INCOME' | 'EXPENSE';
  categories: Array<{ id: string; name: string }>;
  note?: string; // present only when sendNote
  amount?: string; // present only when sendAmount, "123.45"
};

export type AiSuggestionResult = { outcome: 'match'; categoryId: string } | { outcome: 'none' };

export type AiProviderClient = {
  readonly provider: 'ANTHROPIC' | 'OPENAI';
  /** cheap GET used by save-time validation; sends no user data */
  listModels: (apiKey: string, signal: AbortSignal) => Promise<void>;
  suggestCategory: (
    apiKey: string,
    request: AiSuggestionRequest,
    signal: AbortSignal,
  ) => Promise<AiSuggestionResult>;
};
```

- `lib/ai/anthropic.ts` — `POST https://api.anthropic.com/v1/messages`,
  headers `x-api-key`, `anthropic-version: 2023-06-01`. Probe:
  `GET /v1/models`. Response constrained via **forced tool use**
  (`tool_choice: { type: 'tool', name: 'pick_category' }`).
- `lib/ai/openai.ts` — `POST https://api.openai.com/v1/chat/completions`,
  header `Authorization: Bearer`. Probe: `GET /v1/models`. Response constrained
  via **structured outputs** (`response_format: { type: 'json_schema',
json_schema: { strict: true, ... } }`).
- `lib/ai/index.ts` — `getAiProviderClient(provider): AiProviderClient`, the
  only thing services import. Swapping in a third provider is one file plus one
  enum value.
- `lib/ai/errors.ts` — the typed error taxonomy (section 6).
- `lib/ai/prompt.ts` — shared prompt/payload builder (section 4).

Model ids are pinned as exactly one exported constant per provider in
`lib/ai/index.ts` (`ANTHROPIC_MODEL`, `OPENAI_MODEL`) — cheapest current tier of
each, since this is one short classification per call and the user pays. The
literal ids must be **verified against each provider's current docs at
implementation time**, not copied from this document; a stale id surfaces as the
catch-all non-2xx row in section 6.

A single `AI_TIMEOUT_MS = 10_000` constant is applied by the service
via `AbortSignal.timeout`, not by each adapter.

---

## 4. Prompt / request design

**File: `lib/ai/prompt.ts`** — one builder shared by both adapters _and_ by the
disclosure preview, so the disclosure can never drift from what is actually sent.

```ts
export const AI_SYSTEM_PROMPT: string;
export const buildSuggestionPayload = (
  request: AiSuggestionRequest,
): { system: string; user: string; categoryIds: string[] };
```

System prompt (fixed, no user data):

> You categorize a single personal-finance transaction. You will be given a
> merchant/payee name, the transaction type, and the complete list of the
> user's existing categories. Choose the single best-fitting category from that
> list. You must pick from the list — never invent a category. If no category is
> a confident fit, return "none". Answer only by calling the provided tool.

User message: the payee, the type, optionally note and amount, then the category
list rendered as one `id<TAB>name` line per category. Ids are sent so the model
returns an id directly, removing a name→id lookup and its ambiguity.

**Response constraint — two layers, belt and braces:**

1. **Provider-side:** the tool/JSON schema is `{ categoryId: string }` where
   `categoryId` is an `enum` of the user's **actual category ids plus the
   literal `"none"`**. The schema is built per request from the same
   `categoryIds` the payload builder emitted.
2. **Server-side:** the raw response is parsed with a Zod schema built from that
   same id list: `z.object({ categoryId: z.enum([...ids, 'none']) })`. A parse
   failure — model ignored the enum, returned prose, or named an id that isn't
   the user's — is exactly the "response names a nonexistent category" case and
   raises `AiInvalidResponseError`.

`"none"` maps to `{ outcome: 'none' }`; anything else to `{ outcome: 'match',
categoryId }`. A sentinel value inside the constrained enum is what lets "no
confident match" be a _valid_ structured answer rather than an error, which is
the whole point of not free-text parsing.

**Edge case:** a user with zero categories. The enum would be `['none']` only —
short-circuit before any network call and return `{ outcome: 'none' }` with the
"no confident match" message. Costs the user nothing.

---

## 5. Validators, services, routes

### Validators

**`lib/validators/ai-settings.ts`** (new)

```ts
export const AI_PROVIDERS = ['ANTHROPIC', 'OPENAI'] as const;
export const aiProviderSchema = z.enum(AI_PROVIDERS, {
  message: 'Pick a provider of Anthropic or OpenAI',
});

/** Full-object PUT, following updateReminderPreferenceSchema: provider and key
 * are one user-visible setting and a partial write would leave the server
 * guessing which provider a new key belongs to. */
export const saveAiSettingsSchema = z.object({
  provider: aiProviderSchema,
  apiKey: z.string().trim().min(20, 'That does not look like an API key').max(400),
  sendNote: z.boolean(),
  sendAmount: z.boolean(),
});

/** toggles only — no key round-trip, so flipping a toggle can never
 * re-submit or overwrite the stored key */
export const updateAiTogglesSchema = z.object({
  sendNote: z.boolean(),
  sendAmount: z.boolean(),
});

export type SaveAiSettingsInput = z.infer<typeof saveAiSettingsSchema>;
export type UpdateAiTogglesInput = z.infer<typeof updateAiTogglesSchema>;
```

**`lib/validators/categorize-ai.ts`** (new)

```ts
export const suggestWithAiSchema = z.object({ transactionId: z.string().min(1) });
```

**Deliberately just an id.** The client sends no payee, no note, no amount, no
category list. The server re-reads the transaction scoped by `userId`, re-derives
the category list, re-checks queue eligibility and re-checks that no rule
matched. If the client supplied any of that, the note/amount opt-in and the
"only unmatched rows" rule would be client-enforced — i.e. not enforced.

### Services

**`lib/services/aiSettings.ts`** (new) — owns the key lifecycle. The only module
in the app that imports `lib/crypto/secrets.ts`.

```ts
/** write-only by construction: no field here can reconstruct the key */
export type FrontendAiSettings = {
  configured: boolean;
  provider: AiProvider | null;
  maskedKey: string | null;   // "••••••••a1b2"
  verified: boolean;
  sendNote: boolean;
  sendAmount: boolean;
  disclosureAccepted: boolean;
  available: boolean;         // isSecretEncryptionConfigured()
};

export const getAiSettings = (userId: string): Promise<FrontendAiSettings>;

export const saveAiSettings = (
  userId: string,
  input: SaveAiSettingsInput,
): Promise<FrontendAiSettings & { warning: string | null }>;

export const updateAiToggles = (
  userId: string,
  input: UpdateAiTogglesInput,
): Promise<FrontendAiSettings>;

export const acceptAiDisclosure = (userId: string): Promise<FrontendAiSettings>;

export const removeAiSettings = (userId: string): Promise<{ ok: true }>;

/** internal, not exported to routes: decrypts for the suggest path only */
const loadDecryptedKey = (userId: string): Promise<{ provider: AiProvider; apiKey: string; sendNote: boolean; sendAmount: boolean } | null>;
```

All Prisma access scoped: `prisma.userAiSettings.findUnique({ where: { userId } })`,
`upsert({ where: { userId }, ... })`, `deleteMany({ where: { userId } })`.
`deleteMany` rather than `delete` so removing a non-existent row is idempotent.

**`lib/services/aiCategorize.ts`** (new) — orchestration, no HTTP, no crypto
primitives. Extends rather than duplicates: it calls the existing
`matchCategoryRule` from `lib/services/categorize.ts` for the "did a rule already
match?" gate instead of reimplementing matching.

```ts
export type AiSuggestion =
  | { outcome: 'match'; categoryId: string; categoryName: string }
  | { outcome: 'none' };

export const suggestCategoryWithAi = (
  userId: string,
  transactionId: string,
): Promise<AiSuggestion>;

export type AiDisclosurePreview = {
  fields: Array<{ label: string; value: string }>;
  categoryCount: number;
  exampleFromRealTransaction: boolean;
};

export const getAiDisclosurePreview = (userId: string): Promise<AiDisclosurePreview>;
```

`suggestCategoryWithAi` sequence:

1. `isSecretEncryptionConfigured()` → else `AiUnavailableError` (503).
2. `loadDecryptedKey(userId)` → null → `ServiceValidationError` "Add an API key
   in Settings first."
3. `disclosureAcceptedAt === null` → `AiDisclosureRequiredError` (409).
4. Rate limit check + increment (below).
5. `prisma.transaction.findFirst({ where: { id: transactionId, userId, categoryId: null, skippedAt: null, isTransfer: false, isPayment: false } })` —
   **exactly the `getCategorizeQueue` where-clause plus the id**, so eligibility
   is one definition. Miss → `ServiceValidationError` "That transaction is no
   longer in the categorize queue."
6. Re-run `matchCategoryRule` over the user's rules; a hit → refuse with
   "A rule already categorizes this transaction." (PM: AI is only for unmatched
   rows, and this must be server-enforced).
7. `prisma.category.findMany({ where: { userId }, select: { id, name }, orderBy: { name: 'asc' } })`.
8. Build request — `note`/`amount` included **only** when the stored toggles say
   so; the client cannot influence this.
9. `getAiProviderClient(provider).suggestCategory(apiKey, request, AbortSignal.timeout(AI_TIMEOUT_MS))`.
10. Map result; for a match, resolve the name from the already-loaded list (a
    second defence against an id outside the user's set) and return a plain
    object. **Nothing is written to the transaction** — applying the suggestion
    is the user's existing category-set action.

`getAiDisclosurePreview` builds its example by running the _same_
`buildSuggestionPayload` over one real queue row (most recent uncategorized,
unmatched row; synthetic placeholder row if the queue is empty, flagged by
`exampleFromRealTransaction: false`). This is what makes the disclosure provably
accurate rather than hand-written UI copy.

**Rate limiting (DB-backed, two atomic statements, no transaction).**
`vercel.json` confirms a serverless, multi-instance deploy, so an in-memory
`Map` would silently not limit. Today is a UTC `YYYYMMDD` int (the `Budget.month`
idiom). In `suggestCategoryWithAi`, before any network call:

```ts
// 1. roll the counter over if it belongs to a previous day
await prisma.userAiSettings.updateMany({
  where: { userId, suggestCountDate: { not: today } },
  data: { suggestCountDate: today, suggestCount: 0 },
});
// 2. claim one slot; count === 0 IS the rate-limited branch
const claimed = await prisma.userAiSettings.updateMany({
  where: { userId, suggestCountDate: today, suggestCount: { lt: AI_DAILY_SUGGEST_LIMIT } },
  data: { suggestCount: { increment: 1 } },
});
if (claimed.count === 0) throw new AiRateLimitedError(/* local cap message */);
```

Deliberately **not** wrapped in `prisma.$transaction`, and the provider `fetch`
is never inside a DB transaction — a 10s hung request must not hold a Postgres
connection open. The conditional `updateMany` is atomic at the row level, which
is what makes the cap a real server-enforced property under concurrent requests
rather than a read-check-increment race. The slot is consumed **before** the
outbound call, so a hung or failing provider still spends quota: the limiter
protects the user's provider spend, not our latency. This is also what makes "no
bulk suggestions" server-enforced rather than a UI choice.

### Routes

All declare `export const runtime = 'nodejs'`. All follow the house shape:
session check → `safeParse` → service → `NextResponse.json`, no business logic.

| File                                            | Method   | Body                    | Response                                  |
| ----------------------------------------------- | -------- | ----------------------- | ----------------------------------------- |
| `app/api/settings/ai/route.ts` (new)            | `GET`    | —                       | `FrontendAiSettings`                      |
|                                                 | `PUT`    | `saveAiSettingsSchema`  | `FrontendAiSettings & { warning }`        |
|                                                 | `DELETE` | —                       | `{ ok: true }`                            |
| `app/api/settings/ai/toggles/route.ts` (new)    | `PATCH`  | `updateAiTogglesSchema` | `FrontendAiSettings`                      |
| `app/api/settings/ai/disclosure/route.ts` (new) | `GET`    | —                       | `AiDisclosurePreview`                     |
|                                                 | `POST`   | —                       | `FrontendAiSettings` (records acceptance) |
| `app/api/categorize/suggest-ai/route.ts` (new)  | `POST`   | `suggestWithAiSchema`   | `AiSuggestion`                            |

`suggest-ai` is a **new path under the existing `app/api/categorize/`**, not a
change to `app/api/categorize/route.ts` — that handler's `{ text } →
{ categoryId }` contract (rule matching) stays exactly as it is.

The error→status mapping lives in **`lib/ai/errors.ts`** as an exported
`aiErrorToResponse(error: unknown): { status: number; message: string } | null`
(null = not one of ours, rethrow). No `app/api/_lib/` directory exists in this
repo and none is introduced; the mapper belongs with the taxonomy it maps.

---

## 6. Failure handling map

**File: `lib/ai/errors.ts`.** Follows the `lib/services/common.ts` pattern:
named `Error` subclasses with a `name`, carrying a user-safe message. Where a
route needs a distinct status, the class is standalone (like
`GoogleReauthRequiredError`); where a generic 400 is right, it subclasses
`ServiceValidationError` (like `ReimbursementConflictError`) so existing
`instanceof ServiceValidationError` checks still fire.

| Provider condition                                                      | Typed error                  | HTTP | User-facing message                                                                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 401 / 403                                                               | `AiProviderAuthError`        | 400  | "Your {Provider} API key was rejected. Check it in Settings and save it again."                                                                        |
| 429 (provider)                                                          | `AiRateLimitedError`         | 429  | "{Provider} is rate-limiting your key right now. Wait a minute and try again."                                                                         |
| Local daily cap                                                         | `AiRateLimitedError`         | 429  | "You've hit today's limit of {N} AI suggestions. Try again tomorrow."                                                                                  |
| 5xx                                                                     | `AiProviderUnavailableError` | 502  | "{Provider} is having trouble right now. Try again in a few minutes."                                                                                  |
| Network error / `AbortError` timeout                                    | `AiProviderUnavailableError` | 502  | "The request to {Provider} timed out. Try again in a few minutes."                                                                                     |
| Response fails the Zod enum parse, or names an id not in the user's set | `AiInvalidResponseError`     | 200  | **Not an error to the user** — returned as `{ outcome: 'none' }` with "No confident match — pick a category yourself." Logged server-side as a signal. |
| Model returns the `"none"` sentinel                                     | — (success)                  | 200  | "No confident match — pick a category yourself."                                                                                                       |
| Any other non-2xx (e.g. 404 from a retired/invalid model id)            | `AiProviderUnavailableError` | 502  | "{Provider} couldn't handle that request. Try again in a few minutes."                                                                                 |
| `SECRET_ENCRYPTION_KEY` unset                                           | `AiUnavailableError`         | 503  | "AI suggestions aren't available on this deployment."                                                                                                  |
| Disclosure not yet accepted                                             | `AiDisclosureRequiredError`  | 409  | "Review what gets sent to {Provider}, then try again."                                                                                                 |
| No key configured                                                       | `ServiceValidationError`     | 400  | "Add an API key in Settings first."                                                                                                                    |
| Row no longer eligible / rule already matched                           | `ServiceValidationError`     | 400  | "That transaction is no longer in the categorize queue." / "A rule already categorizes this transaction."                                              |

Per PM, "names a nonexistent category" is treated the same as no match — so it
resolves to a successful `{ outcome: 'none' }` response rather than an error
status. The distinct typed error still exists so it is distinguishable in logs.

The status classifier is exhaustive by construction — `401|403`, `429`, `>=500`,
then **everything else non-2xx** falls to `AiProviderUnavailableError`. No status
can fall through unclassified.

**`AiInvalidResponseError` never reaches a route handler.** It is thrown by the
adapter, caught inside `suggestCategoryWithAi`, logged server-side (status and
error name only), and converted there into a successful `{ outcome: 'none' }`.
Routes see a resolved promise, not an error.

**Provider response bodies are never forwarded.** Classification is by status
code and error `name` only; the provider's own message may echo request content.

---

## 7. File-by-file breakdown

### New

| Path                                                  | Purpose                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| `prisma/schema.prisma` _(edit — needs authorization)_ | `AiProvider` enum, `UserAiSettings` model, `User.aiSettings` back-relation |
| `prisma/migrations/<ts>_add_user_ai_settings/`        | generated; additive only                                                   |
| `lib/crypto/secrets.ts`                               | AES-256-GCM encrypt/decrypt/mask, `isSecretEncryptionConfigured`           |
| `lib/ai/types.ts`                                     | SDK-free request/result/client types                                       |
| `lib/ai/errors.ts`                                    | typed error taxonomy                                                       |
| `lib/ai/prompt.ts`                                    | system prompt + `buildSuggestionPayload` (shared with disclosure)          |
| `lib/ai/anthropic.ts`                                 | fetch adapter, forced tool use                                             |
| `lib/ai/openai.ts`                                    | fetch adapter, strict json_schema                                          |
| `lib/ai/index.ts`                                     | `getAiProviderClient`, `AI_TIMEOUT_MS`, model constants                    |
| `lib/validators/ai-settings.ts`                       | save / toggles schemas                                                     |
| `lib/validators/categorize-ai.ts`                     | `{ transactionId }` schema                                                 |
| `lib/services/aiSettings.ts`                          | key lifecycle, masking, probe-on-save                                      |
| `lib/services/aiCategorize.ts`                        | suggest orchestration, rate limit, disclosure preview                      |
| `app/api/settings/ai/route.ts`                        | GET / PUT / DELETE                                                         |
| `app/api/settings/ai/toggles/route.ts`                | PATCH                                                                      |
| `app/api/settings/ai/disclosure/route.ts`             | GET preview / POST accept                                                  |
| `app/api/categorize/suggest-ai/route.ts`              | POST suggest                                                               |
| `tests/unit/services/aiSettings.test.ts`              | save/remove/mask/probe branches                                            |
| `tests/unit/services/aiCategorize.test.ts`            | eligibility, toggles, rate limit, error map                                |
| `tests/unit/lib/secrets.test.ts`                      | round-trip, AAD mismatch, tamper, unconfigured                             |
| `tests/unit/lib/ai-prompt.test.ts`                    | payload shape, note/amount omission, enum build                            |
| `tests/unit/validators/ai-settings.test.ts`           | schema edges                                                               |
| `docs/runbooks/rotate-secret-encryption-key.md`       | manual rotation procedure                                                  |

### Changed

| Path                                   | Change                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `README.md` / `.env.example`           | document `SECRET_ENCRYPTION_KEY`; note the feature is off when unset      |
| `tests/unit/services/userData.test.ts` | add: export contains no AI key fields; restore preserves `UserAiSettings` |

### Explicitly unchanged (assert, don't edit)

- `lib/services/categorize.ts` — new consumers only; matching logic untouched.
- `lib/services/csvImport.ts` — no bulk path is involved; nothing to extend.
- `lib/services/userData.ts` — export excludes by omission; `wipeUserData` must
  **not** gain a `userAiSettings.deleteMany`.
- `lib/services/accountDeletion.ts` — cascade handles it.
- `app/api/categorize/route.ts` — existing rule-suggest contract preserved.

### UI (next pass — ui-designer, not this one)

`components/settings/ai-provider-card.tsx` and a "Suggest with AI" affordance in
`components/categorize/categorize-view.tsx`, plus a mount in
`components/settings/settings-view.tsx`. This document defines only the data
contracts they consume: `FrontendAiSettings`, `AiDisclosurePreview`,
`AiSuggestion`, and the error/status table in section 6.

---

## 8. Security checklist (feature-specific)

- [x] Raw key is never logged — no `console.log`/`console.error` of the input,
      the decrypted value, or any object containing it. Verify by review of both
      services and both adapters.
- [x] Raw key never appears in a thrown `Error` message, a `cause`, or a stack —
      adapters classify by status code and throw the typed errors from
      `lib/ai/errors.ts`, never `throw new Error(responseBody)`.
- [x] Provider response bodies are never forwarded to the client verbatim.
- [x] `GET /api/settings/ai` returns only `maskedKey` from `keyLast4`. There is
      no endpoint, service function or export path that returns plaintext.
      `loadDecryptedKey` is module-private to `lib/services/aiSettings.ts`.
- [x] `PATCH /toggles` takes no key field, so a toggle flip can never overwrite
      or re-submit the stored key.
- [x] Key excluded from data export (by omission) — asserted by test.
- [x] Key survives data import — asserted by test (the `wipeUserData` trap).
- [x] Key wiped on account deletion via `onDelete: Cascade`. **Not asserted by a
      unit test, deliberately:** a mocked Prisma layer cannot exercise a
      DB-level cascade, and a test asserting "we never called
      `userAiSettings.deleteMany`" would prove nothing about it. Verified by
      reading the two things that actually produce the behaviour —
      `prisma/migrations/20260918083747_add_user_ai_settings/migration.sql`
      (`ON DELETE CASCADE` on `UserAiSettings_userId_fkey`) and
      `lib/services/accountDeletion.ts`'s `tx.user.delete({ where: { id: userId } })`.
- [x] `SECRET_ENCRYPTION_KEY` is server-only, never `NEXT_PUBLIC_`, never sent
      to the client, absent from the export and from any API response.
- [x] GCM AAD is the `userId`, so a blob cannot be replayed into another row.
- [x] Every AI route is session-gated and every query is `where: { userId }`;
      `transactionId` is never trusted without the `userId` scope.
- [x] DB-backed per-user daily cap on `POST /api/categorize/suggest-ai`,
      incremented before the outbound call, so a stolen session cannot burn a
      user's provider quota or fan out into a bulk run.
- [x] Hard `AbortSignal.timeout(AI_TIMEOUT_MS)` on every outbound provider call
      (suggest and probe) so a hung provider cannot pin a serverless function.
- [x] Outbound base URLs default to the real provider APIs and are never a
      user-supplied field anywhere in the validators (no SSRF surface). **Approved
      2026-09-18:** each base URL is overridable via a server-only env var
      (`AI_ANTHROPIC_BASE_URL` / `AI_OPENAI_BASE_URL`, read only at module
      load, never from request input) so e2e tests can point them at a local
      fixture server — see the test plan's "Required new test infrastructure"
      section. This is deploy-config-supplied, not user-supplied; same trust
      level as `DATABASE_URL`/`SECRET_ENCRYPTION_KEY`.
- [x] Only `payee`, `type`, category names/ids, and opt-in `note`/`amount` leave
      the server. Date, account name, balances, other transactions and the
      transfer/payment/skip flags are never in the payload. Asserted two ways,
      neither of them a literal snapshot — the test plan deliberately
      downgraded that to field-presence checks so the prompt copy stays free to
      iterate: `tests/unit/lib/ai-prompt.test.ts` asserts the forbidden tokens
      are absent from the built `{ system, user }`, and e2e case 13 asserts the
      same against the _real_ outbound body captured by the fixture server, so
      a future field added to `AiSuggestionRequest` is caught at the HTTP
      boundary rather than only in the builder.
- [x] Disclosure preview is generated by the same builder as the real request,
      so it cannot drift from reality.
- [x] Suggest endpoint never writes to `Transaction`; applying a suggestion goes
      through the user's existing explicit category-set action.

---

## Execution checklist

- [x] **Get explicit user authorization for the `prisma/schema.prisma` change** before anything else; confirm the exact `UserAiSettings` model and `AiProvider` enum above
- [x] Add `AiProvider` enum, `UserAiSettings` model and `User.aiSettings` back-relation to `prisma/schema.prisma`
- [x] `npm run prisma:migrate -- --name add_user_ai_settings` and `npm run prisma:generate`
- [x] Add `SECRET_ENCRYPTION_KEY` to `.env.example` and README setup docs
- [x] Implement `lib/crypto/secrets.ts` (encrypt/decrypt/mask/`isSecretEncryptionConfigured`, `v1:` packing, userId AAD)
- [x] Unit tests: `tests/unit/lib/secrets.test.ts` — round-trip, wrong-AAD rejection, tampered-tag rejection, unconfigured throw
- [x] Implement `lib/ai/types.ts` and `lib/ai/errors.ts` (taxonomy + `aiErrorToResponse`)
- [x] Implement `lib/ai/prompt.ts` (system prompt, `buildSuggestionPayload`, category-id enum construction)
- [x] Unit tests: `tests/unit/lib/ai-prompt.test.ts` — note/amount omitted unless opted in; no date/account/flags in payload; enum includes `"none"`
- [x] Implement `lib/ai/anthropic.ts` (forced tool use) and `lib/ai/openai.ts` (strict json_schema), both with status→typed-error classification
- [x] Implement `lib/ai/index.ts` (`getAiProviderClient`, `AI_TIMEOUT_MS`, `AI_DAILY_SUGGEST_LIMIT`, `ANTHROPIC_MODEL`/`OPENAI_MODEL`) — verify the current cheapest-tier model id against provider docs before pinning
- [x] Implement `lib/validators/ai-settings.ts` and `lib/validators/categorize-ai.ts` + validator tests
- [x] Implement `lib/services/aiSettings.ts` (get/save-with-probe/toggles/accept-disclosure/remove, private `loadDecryptedKey`)
- [x] Unit tests: `tests/unit/services/aiSettings.test.ts` — 401 refuses to persist; 429/5xx persists unverified with warning; masked-only reads; remove is idempotent
- [x] Implement `lib/services/aiCategorize.ts` (eligibility gate reusing the queue where-clause, `matchCategoryRule` re-check, DB rate limit, provider call, result mapping, disclosure preview)
- [x] Unit tests: `tests/unit/services/aiCategorize.test.ts` — ineligible row rejected; rule-matched row rejected; toggles honoured; daily cap; each failure mode maps to its typed error; invalid category id resolves to `{ outcome: 'none' }`; zero-category short-circuit makes no network call
- [x] Add the two `userData` regression tests: export contains no AI fields; restore preserves `UserAiSettings`
- [x] Implement the four route handlers with `export const runtime = 'nodejs'` and the shared error→status mapping
- [x] Write `docs/runbooks/rotate-secret-encryption-key.md`
- [x] Run `npm run format:fix && npm run lint` and `npm run test`
- [x] Hand the `FrontendAiSettings` / `AiDisclosurePreview` / `AiSuggestion` contracts and the section 6 message table to the ui-designer
- [x] Walk the section 8 security checklist line by line before merge

---

## Addendum — UI pass resolutions (2026-09-18)

**Test plan:** the tester pass (unit + e2e cases, written before this UI addendum's implementation work per `CLAUDE.md`'s workflow) lives in its own file — `docs/feature-plans/byok-llm-assisted-categorization-test-plan.md` — rather than inline here, given its length. Read it alongside this addendum before implementing.

The ui-designer produced component scaffolds for the three new components below (now committed
to the repo, non-functional — real fetch/state wiring is the senior-developer's job). Two
conflicts between the design and the backend design are resolved here so the developer isn't
guessing:

- **Settings component name is `components/settings/ai-categorization-section.tsx`**, not
  `ai-provider-card.tsx` as originally named in §7 of the architecture section above — it matches
  the sibling `reminders-section.tsx` (server-fetched props, one card, own fetch calls) it's
  cloned from. Treat `ai-categorization-section.tsx` as authoritative.

- **Disclosure-accept ordering is save-first, then accept** — inverted from the ui-designer's
  original accept-then-save flow. `UserAiSettings.provider`/`encryptedApiKey` are non-nullable, so
  a row can't exist from an "accept disclosure" call alone before a key is saved. The disclosure
  modal's "Looks good, continue" button now triggers the real `PUT /api/settings/ai` first; only
  on a successful save does it follow with `POST /api/settings/ai/disclosure` to stamp
  acceptance on the now-existing row. If the save fails (key rejected), the accept call never
  fires and the user sees the disclosure again on the next attempt — harmless, since nothing was
  sent to a provider either way. See the header comment in `ai-categorization-section.tsx`.

- **No `amber`/warning color token exists in this codebase's palette** (`app/globals.css` only
  defines `iris`/`sky`/`rose` + soft variants). The "saved, not yet verified" informational state
  (Q1's outage-tolerant persist) renders as ink-muted text on a neutral border instead, `role`
  `"status"` not `"alert"` — it's not an error.

- Two small bugs fixed while porting the scaffolds into the repo: `SuggestAiButton` used
  `Math.random()` for its `aria-describedby` id (unstable across renders, effectively inert) —
  replaced with `useId()`. `AiDisclosureModal` passed a `ref` to `Button`, which doesn't forward
  refs — `autoFocus` alone is sufficient and the ref was removed.

Scaffolds now in the repo (non-functional, correct prop signatures/JSX — fetch calls and real
state are commented inline with exactly what to wire):

- `components/settings/ai-categorization-section.tsx`
- `components/settings/ai-disclosure-modal.tsx`
- `components/categorize/suggest-ai-button.tsx`

Still needed from the developer on the UI side (not yet scaffolded — the ui-designer's report
describes these in prose, see its handback for exact anchor points):

- [x] Wire `AiCategorizationSection` into `components/settings/settings-view.tsx` (after
      `RemindersSection`) and `app/(protected)/settings/page.tsx` (add `getAiSettings` to the
      existing `Promise.all`)
- [x] Add `SuggestAiButton` to all three `categorize-view.tsx` render paths (grouped payee cards,
      desktop table, mobile cards) per the ui-designer's per-site notes — the desktop table's
      `Select` must become controlled (`aiSuggestions` map) to have somewhere for a suggestion to
      land before acceptance; this is a required change to existing behavior, not just an
      addition
- [x] `aiSuggestions`/`suggestingId`/`aiErrors`/`dailyCapHit` state additions in `CategorizeView`
- [x] Inline `role="alert"`/`role="status"` result rendering next to the triggering row/card (not
      `Toast` — matches the `matchResult` precedent in `transactions-view.tsx`), per the section-6
      message table in the architecture section above

---

## Addendum — implementation notes (2026-09-21)

Feature is implemented end to end. 618 unit tests and 18 BYOK e2e specs green.
Four things diverge from, or resolve an ambiguity in, the text above.

1. **`loadDecryptedKey` is exported as `loadAiCredentials`.** §5 places it inside
   `lib/services/aiSettings.ts` as module-private, but `lib/services/aiCategorize.ts`
   genuinely needs the plaintext to make the outbound call, and the test plan
   asserts mechanically that no `loadDecryptedKey` export exists. Both constraints
   hold with the rename: the `lib/crypto/secrets.ts` import stays confined to
   `aiSettings.ts`, nothing under `app/` imports the plaintext path, and no route
   returns it.

2. **Rate-limiter bug in §5's snippet.** The day-rollover `updateMany`'s
   `where: { suggestCountDate: { not: today } }` never matches a row that has
   never been suggested from, because SQL's `NULL <> today` is NULL rather than
   true. The claim statement then matches nothing and rate-limits every user on
   their first suggestion. Implemented as
   `OR: [{ suggestCountDate: null }, { suggestCountDate: { not: today } }]`,
   pinned by a unit test. Caught by e2e, not by the (mocked) unit tests — worth
   remembering the next time a DB predicate is specified in prose.

3. **Model ids are unverified.** `ANTHROPIC_MODEL = 'claude-3-5-haiku-latest'`
   and `OPENAI_MODEL = 'gpt-4o-mini'` were pinned without access to the providers'
   current docs. Both carry a `TODO: reverify` comment. A retired id surfaces as
   the catch-all 404 → `AiProviderUnavailableError`, so this fails visibly rather
   than silently — but reverify before shipping.

4. **`SuggestAiButton` is absent, not disabled, when no key is configured** (§6's
   "No key configured" row still applies server-side). A permanently-inert button
   in every queue row is noise for the majority of users who have not opted into
   BYOK, and it shadowed the first category chip in the existing
   `categorize-dropdown-skip` mobile spec. The daily cap is still rendered as a
   _disabled_ button with a visible reason, since that state is temporary and the
   user needs to know why the button stopped working.

Two small additions the docs did not specify: the desktop table row gains an
**Apply** button that exists only while an unaccepted AI suggestion sits in its
(now controlled) `Select` — re-picking an already-selected option fires no
`change` event, so the row would otherwise have no way to accept a suggestion.
And `app/(protected)/categorize/page.tsx` fetches `getAiSettings` alongside the
queue, so a deployment without `SECRET_ENCRYPTION_KEY` renders without the
affordance in the first HTML rather than after a client-side check.

**Manual verification still owed before merge** (flagged as out of scope by the
test plan): the DB-level concurrency claim for the rate limiter, and the two
model ids above.
