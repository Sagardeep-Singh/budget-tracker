# BYOK LLM-assisted categorization — test plan (tester pass)

Written before implementation, per `CLAUDE.md`'s Agent Workflow step 4. This is
the acceptance bar the senior-developer implements against; it does not
contain test code. Companion to `docs/feature-plans/byok-llm-assisted-categorization.md`
(architecture doc + UI addendum) — read that first for the file breakdown,
`FrontendAiSettings`/`AiDisclosurePreview`/`AiSuggestion` contracts, and the
section 6 error/status/message table this plan checks against verbatim.

Kept as its own file rather than a section of the architecture doc: that doc
is already ~700 lines and the test plan below is comprehensive enough (two
new service files, three new lib/ai files, one crypto file, two validators,
three UI render sites, a rate limiter) that inlining it would bury the
architecture decisions it's meant to sit alongside. `pwa-push-reminders.md`
inlines its (much shorter) test plan under a `## Test plan` heading — that
precedent is followed in spirit (same heading style, unit-then-e2e structure)
but not in placement, given the size difference.

---

## Unit test plan

One entry per new file in the architecture doc's §7 file breakdown, plus the
two `userData.ts` regression tests it calls out. Prisma is mocked via
`vi.hoisted` + `vi.mock('@/lib/db/prisma', ...)` per `tests/unit/services/transfers.test.ts`
and `tests/unit/services/csvImport.test.ts`. Provider HTTP calls are mocked at
`global.fetch` (adapters) or at the `lib/ai/index.ts` client boundary
(services) — never a real network call in any unit test.

### `lib/crypto/secrets.ts` → `tests/unit/lib/secrets.test.ts`

Set `process.env.SECRET_ENCRYPTION_KEY` to a valid `openssl rand -base64 32`
value in a `beforeEach`/module-level fixture; restore/delete it in specific
"unconfigured" cases.

| Case                                                  | Expected behavior                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module import with `SECRET_ENCRYPTION_KEY` unset      | Importing `lib/crypto/secrets.ts` does **not** throw. Only calling `encryptSecret`/`decryptSecret` throws. `isSecretEncryptionConfigured()` returns `false`.                                                                                                                                                     |
| `isSecretEncryptionConfigured()` with a valid key set | Returns `true`.                                                                                                                                                                                                                                                                                                  |
| Round trip                                            | `decryptSecret(encryptSecret(plaintext, userId), userId) === plaintext` for a representative API-key-shaped string.                                                                                                                                                                                              |
| Random IV                                             | Calling `encryptSecret` twice with the identical `(plaintext, userId)` produces two **different** packed strings; both independently decrypt back to `plaintext`.                                                                                                                                                |
| Packing format                                        | Packed string matches `/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/` (three base64 segments after the `v1:` prefix).                                                                                                                                                                                   |
| Wrong AAD                                             | `decryptSecret(encryptSecret(plaintext, 'user-a'), 'user-b')` throws. Assert it throws (GCM auth-tag failure), and assert the thrown error's `message` does **not** contain `plaintext`.                                                                                                                         |
| Tampered ciphertext byte                              | Flip one character in the ciphertext (3rd) segment of a valid packed string before decrypting → throws.                                                                                                                                                                                                          |
| Tampered tag byte                                     | Flip one character in the auth-tag (2nd) segment → throws.                                                                                                                                                                                                                                                       |
| Tampered IV byte                                      | Flip one character in the IV (1st) segment → throws (GCM ties the tag to the IV).                                                                                                                                                                                                                                |
| Malformed packed string                               | Missing a segment (e.g. only two `:`-parts), or an unknown prefix (`v2:...`) → throws a typed error (not an unhandled `TypeError`/`RangeError` from a bad `Buffer.from`).                                                                                                                                        |
| Malformed master key                                  | `SECRET_ENCRYPTION_KEY` set to a string that is not valid base64, or that decodes to a length other than 32 bytes → `encryptSecret`/`decryptSecret` throw at call time (not at import time).                                                                                                                     |
| No plaintext/key leakage in errors                    | For every throwing case above, assert `error.message` (and `error.stack` if inspectable) does not include the literal plaintext test key or the raw master key value used in the test.                                                                                                                           |
| `maskLast4`                                           | For a key like `sk-ant-abcdEFGH1234`, returns a string ending in the literal last 4 characters (`1234`) preceded by masking characters, and does **not** contain any of the preceding characters of the input.                                                                                                   |
| `maskLast4` boundary                                  | A 4-character input still returns a maskable result (define and assert one deterministic behavior — e.g. masked-prefix + the same 4 chars — rather than throwing on a short string; the validator's 20-char minimum makes this unreachable via the real save path, but `maskLast4` itself must not crash on it). |

### `lib/ai/prompt.ts` → `tests/unit/lib/ai-prompt.test.ts`

| Case                             | Expected behavior                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minimal request (no note/amount) | `buildSuggestionPayload({ payee, type, categories })` — the `user` string contains the payee and type, one `id\tname` line per category, and does not contain the substring `"note"` or any amount-looking figure.                                                                                                                                                     |
| `note` omitted when not opted in | Request built with `note` absent from the `AiSuggestionRequest` → output `user` string does not contain the transaction's note text (test with a note value that would be obviously detectable, e.g. a unique token).                                                                                                                                                  |
| `note` included when opted in    | Request built with `note: 'unique-note-token'` present → `user` string contains `unique-note-token` verbatim.                                                                                                                                                                                                                                                          |
| `amount` omitted/present         | Same pair of cases for `amount: '123.45'` — absent unless the field is present on the request object.                                                                                                                                                                                                                                                                  |
| No forbidden fields ever         | Given a request object that only has the typed `AiSuggestionRequest` fields, assert the full built `{ system, user }` text contains none of: a date string, an account name, a balance figure, or any of the literal words `isTransfer`/`isPayment`/`skippedAt`. (Guards against a future field being added to the request type and silently flowing into the prompt.) |
| `categoryIds` shape              | Returned `categoryIds` array equals exactly the `id`s of the input `categories`, in the same order, and does **not** itself include the literal `'none'` — the `'none'` sentinel is appended one layer up (by the adapter/schema builder), not baked into the prompt builder's output.                                                                                 |
| Zero categories                  | `categories: []` → does not throw; `categoryIds` is `[]`; the rendered category-list section reflects "no categories" rather than an empty/broken block.                                                                                                                                                                                                               |
| System prompt is static          | `AI_SYSTEM_PROMPT` is a non-empty string and is identical across two calls with different requests (i.e., it's a constant, not built from user data).                                                                                                                                                                                                                  |
| Category list ordering preserved | Categories passed in a specific order render as `id\tname` lines in that exact order (the caller — `aiCategorize.ts` — is responsible for the `orderBy: name asc`; this builder must not silently re-sort).                                                                                                                                                            |

### `lib/ai/anthropic.ts` and `lib/ai/openai.ts` → `tests/unit/lib/ai-anthropic.test.ts`, `tests/unit/lib/ai-openai.test.ts`

Mock `global.fetch`. Repeat the full matrix for both adapters (the two files
should read near-identically; don't let one adapter get a thinner test file
than the other).

| Case                                                                                        | Expected behavior                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listModels` 200                                                                            | Resolves (`undefined`), no throw.                                                                                                                                                                                                                                                                                   |
| `listModels` 401 / 403                                                                      | Throws `AiProviderAuthError`.                                                                                                                                                                                                                                                                                       |
| `listModels` 429                                                                            | Throws `AiRateLimitedError`.                                                                                                                                                                                                                                                                                        |
| `listModels` 5xx                                                                            | Throws `AiProviderUnavailableError`.                                                                                                                                                                                                                                                                                |
| `listModels` network rejection / `AbortError`                                               | Throws `AiProviderUnavailableError` (the timeout-flavored message per the section 6 table).                                                                                                                                                                                                                         |
| `suggestCategory` 200, valid structured response naming a real category id                  | Resolves `{ outcome: 'match', categoryId }`.                                                                                                                                                                                                                                                                        |
| `suggestCategory` 200, response is the `"none"` sentinel                                    | Resolves `{ outcome: 'none' }`.                                                                                                                                                                                                                                                                                     |
| `suggestCategory` 200, malformed/non-JSON/missing tool-call body                            | Throws `AiInvalidResponseError`.                                                                                                                                                                                                                                                                                    |
| `suggestCategory` 200, response names a `categoryId` **not** in the `categoryIds` passed in | Throws `AiInvalidResponseError` (Zod enum parse failure — the server-side second layer of defense from §4).                                                                                                                                                                                                         |
| `suggestCategory` request shape                                                             | The mocked `fetch` is called with the correct URL, method, the provider's auth header (`x-api-key` for Anthropic, `Authorization: Bearer` for OpenAI), the pinned model constant, and the forced-structured-output field (`tool_choice`/`response_format`) built from the same `categoryIds` passed to the adapter. |
| `signal` propagation                                                                        | The `AbortSignal` passed into the adapter is the same one passed to `fetch`'s `init.signal` (proves the hard timeout actually wires through).                                                                                                                                                                       |
| Catch-all status                                                                            | A status not explicitly enumerated (e.g. 404, from a retired model id) → `AiProviderUnavailableError` — the classifier has no fallthrough.                                                                                                                                                                          |
| No key leakage                                                                              | For every thrown-error case, assert `error.message` never contains the fixture `apiKey` value used in the test.                                                                                                                                                                                                     |
| Response body never echoed                                                                  | For the malformed/invalid-response cases, assert the thrown error's message does not include the raw response body text (classification is by status/shape only, per the security checklist).                                                                                                                       |

### `lib/ai/index.ts` (fold into the adapter test files or its own `tests/unit/lib/ai-index.test.ts`)

| Case                               | Expected behavior                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `getAiProviderClient('ANTHROPIC')` | Returns a client with `.provider === 'ANTHROPIC'` whose `listModels`/`suggestCategory` delegate to the Anthropic adapter. |
| `getAiProviderClient('OPENAI')`    | Same, for OpenAI.                                                                                                         |

### `lib/ai/errors.ts` (`aiErrorToResponse`) → `tests/unit/lib/ai-errors.test.ts`

This is the single place the exact strings asserted verbatim by e2e cases
11a–e get produced — test the mapper directly rather than relying on e2e to
be the only thing that would catch a wrong string.

| Case                                                                                                     | Expected behavior                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AiProviderAuthError`                                                                                    | Maps to `{ status: 400, message: "Your {Provider} API key was rejected. Check it in Settings and save it again." }`, with the actual provider name interpolated.                                                                                                                                                                                   |
| `AiRateLimitedError` — provider 429                                                                      | Maps to `{ status: 429, message: "{Provider} is rate-limiting your key right now. Wait a minute and try again." }`.                                                                                                                                                                                                                                |
| `AiRateLimitedError` — local daily cap                                                                   | **Distinct message for the same error class** — maps to `{ status: 429, message: "You've hit today's limit of {N} AI suggestions. Try again tomorrow." }`. Since both cases throw the same `AiRateLimitedError` class, the discriminator must be a field on the error instance (e.g. a `reason: 'provider'                                         | 'cap'`or a pre-built`message` property the class itself carries) — assert the mapper doesn't collapse these two into one string, and construct both flavors of the error in the test to prove it. |
| `AiProviderUnavailableError` — 5xx flavor                                                                | `{ status: 502, message: "{Provider} is having trouble right now. Try again in a few minutes." }`.                                                                                                                                                                                                                                                 |
| `AiProviderUnavailableError` — timeout flavor                                                            | `{ status: 502, message: "The request to {Provider} timed out. Try again in a few minutes." }` — again, same class, different stored message; assert both.                                                                                                                                                                                         |
| `AiProviderUnavailableError` — catch-all non-2xx flavor                                                  | `{ status: 502, message: "{Provider} couldn't handle that request. Try again in a few minutes." }`.                                                                                                                                                                                                                                                |
| `AiUnavailableError`                                                                                     | `{ status: 503, message: "AI suggestions aren't available on this deployment." }`.                                                                                                                                                                                                                                                                 |
| `AiDisclosureRequiredError`                                                                              | `{ status: 409, message: "Review what gets sent to {Provider}, then try again." }`.                                                                                                                                                                                                                                                                |
| Generic `ServiceValidationError` subclass/instance (no key configured, ineligible row, rule-matched row) | `{ status: 400, message: <the error's own message> }` — the mapper doesn't need a bespoke branch per `ServiceValidationError` message, just the `instanceof` check.                                                                                                                                                                                |
| Not one of ours                                                                                          | `aiErrorToResponse(new Error('unrelated'))` returns `null` — the route rethrows rather than swallowing an unrecognized error into a fake 400.                                                                                                                                                                                                      |
| `AiInvalidResponseError` never reaches the mapper                                                        | Not a mapper test per se, but assert-by-absence: this error class has no row in the table above and is never passed to `aiErrorToResponse` in the `aiCategorize.ts` tests — it's caught and converted to `{ outcome: 'none' }` before the route layer ever sees it (cross-reference the `aiCategorize.ts` "match on a nonexistent id" case above). |

### `lib/validators/ai-settings.ts` → `tests/unit/validators/ai-settings.test.ts`

| Case                                                | Expected behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aiProviderSchema` valid values                     | `'ANTHROPIC'` and `'OPENAI'` parse.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `aiProviderSchema` invalid values                   | `'GEMINI'`, `'anthropic'` (wrong case), `''`, `undefined` all fail with the schema's custom message.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `saveAiSettingsSchema` happy path                   | A full valid payload parses; `apiKey` in the parsed output has surrounding whitespace trimmed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apiKey` boundary — 19 vs 20 chars                  | 19-char key rejected with message `"That does not look like an API key"`; exactly 20-char key accepted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apiKey` boundary — 400 vs 401 chars                | 400-char key accepted; 401-char key rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apiKey` all-whitespace                             | A string that trims to under 20 chars (e.g. `'   short   '`) is rejected, not accepted on its untrimmed length.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `sendNote`/`sendAmount` required                    | Omitting either field fails — they are plain `z.boolean()`, not defaulted/optional, so a partial payload can't silently zero out a toggle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Non-boolean toggle value                            | `sendNote: 'true'` (string) fails.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `updateAiTogglesSchema` happy path                  | `{ sendNote: true, sendAmount: false }` parses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `updateAiTogglesSchema` ignores a smuggled `apiKey` | Per §5, this is a plain `z.object({ sendNote, sendAmount })` — a payload with an extra `apiKey` (or `provider`) field parses successfully but the parsed output has no `apiKey` key (Zod's default unknown-key stripping). Follow through to the service test: calling `updateAiToggles` with such a payload leaves the stored `encryptedApiKey` byte-for-byte unchanged — that's the actual security property, not the validator's parse result alone. _(Suggested hardening, needs sign-off, not required by this plan: `.strict()` instead, so the smuggled field causes an outright 400 rather than a silent drop — more debuggable, same closed-by-construction guarantee.)_ |
| `suggestWithAiSchema` happy path                    | `{ transactionId: 'txn-1' }` parses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `suggestWithAiSchema` invalid                       | Missing `transactionId`, empty string, `null`, a number, and an array are all rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### `lib/services/aiSettings.ts` → `tests/unit/services/aiSettings.test.ts`

Mock `@/lib/db/prisma`, `@/lib/crypto/secrets` (`encryptSecret`/`decryptSecret`/`maskLast4`/`isSecretEncryptionConfigured`), and `@/lib/ai/index` (`getAiProviderClient`) via `vi.hoisted`.

| Case                                                     | Expected behavior                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getAiSettings`, no row                                  | Returns `{ configured: false, provider: null, maskedKey: null, verified: false, sendNote: false, sendAmount: false, disclosureAccepted: false, available: <isSecretEncryptionConfigured()> }`.                                                                                    |
| `getAiSettings`, row exists, verified                    | `configured: true`, `verified: true`, `maskedKey` built from `keyLast4` (not decrypted), `disclosureAccepted: true` iff `disclosureAcceptedAt !== null`.                                                                                                                          |
| `getAiSettings` scoping                                  | `prisma.userAiSettings.findUnique` called with exactly `{ where: { userId } }`.                                                                                                                                                                                                   |
| `getAiSettings` when `available: false` but a row exists | Still returns `configured: true` / `maskedKey` populated (masking never needs decryption) — `available: false` only affects whether `suggestCategoryWithAi` can run, not whether Settings can display the saved state.                                                            |
| `saveAiSettings`, probe 200                              | Calls `prisma.userAiSettings.upsert` with: `encryptedApiKey` matching the `v1:` pattern and **not equal** to the raw `apiKey` input; `keyLast4` equal to the last 4 characters of the raw input; `verifiedAt` set (non-null); returns `{ ...FrontendAiSettings, warning: null }`. |
| `saveAiSettings`, probe 401/403                          | Throws `AiProviderAuthError`; `prisma.userAiSettings.upsert` is **never called** — refuse to persist.                                                                                                                                                                             |
| `saveAiSettings`, probe 429                              | `upsert` **is** called, with `verifiedAt: null`; returns `{ ...settings, warning: <non-null> }`.                                                                                                                                                                                  |
| `saveAiSettings`, probe 5xx                              | Same persist-unverified-with-warning behavior as 429.                                                                                                                                                                                                                             |
| `saveAiSettings`, probe network error / timeout          | Same persist-unverified-with-warning behavior.                                                                                                                                                                                                                                    |
| `saveAiSettings`, provider swap                          | Given an existing `ANTHROPIC` row, saving a new `OPENAI` key fully replaces `provider`, `encryptedApiKey`, `keyLast4` on the same row (single `@unique userId` row) — no leftover Anthropic key material.                                                                         |
| No key leakage                                           | Across every branch above, thrown errors' messages never contain the raw `apiKey` fixture value; nothing passed to a `console.*` call (spy on `console.log`/`console.error`/`console.warn` for the duration of the test) contains it either.                                      |
| `updateAiToggles`, row exists                            | Updates only `sendNote`/`sendAmount` via a call scoped `where: { userId }`; does not touch `encryptedApiKey`/`provider`/`verifiedAt` (assert the `data` argument has no such keys).                                                                                               |
| `updateAiToggles`, no row exists                         | Throws (a `ServiceValidationError` — toggles are meaningless without a key) and does **not** create a row.                                                                                                                                                                        |
| `acceptAiDisclosure`, row exists                         | Sets `disclosureAcceptedAt` (scoped by `userId`).                                                                                                                                                                                                                                 |
| `acceptAiDisclosure`, no row exists                      | Throws — nothing to accept for.                                                                                                                                                                                                                                                   |
| `acceptAiDisclosure`, called twice                       | Second call does not throw (idempotent).                                                                                                                                                                                                                                          |
| `removeAiSettings`                                       | Calls `prisma.userAiSettings.deleteMany({ where: { userId } })` — **not** `delete` — and resolves `{ ok: true }` even when no row existed (0 rows affected still resolves, doesn't throw a "record not found" the way `.delete()` would).                                         |
| `removeAiSettings` scoping                               | The `deleteMany` where-clause always includes `userId` — never a bare `deleteMany()` that could delete every user's row.                                                                                                                                                          |
| `loadDecryptedKey` not publicly exported                 | `import * as aiSettingsService from '@/lib/services/aiSettings'` then assert `'loadDecryptedKey' in aiSettingsService` is `false`. This is the direct regression test for the security-checklist line "`loadDecryptedKey` is module-private."                                     |
| `FrontendAiSettings` shape is closed                     | The object returned by `getAiSettings`/`saveAiSettings`/`updateAiToggles` has exactly the `FrontendAiSettings` keys — no `encryptedApiKey`, `apiKey`, or other raw Prisma field leaks through via an accidental object spread of the row.                                         |

### `lib/services/aiCategorize.ts` → `tests/unit/services/aiCategorize.test.ts`

Mock `@/lib/db/prisma`, the internal `loadDecryptedKey`-equivalent path (via mocking `@/lib/services/aiSettings` or reaching in per however the developer structures the private helper — a `vi.mock` of the sibling module is acceptable since it's a different file), `@/lib/services/categorize` (`matchCategoryRule`), `@/lib/ai/index` (`getAiProviderClient`), and `@/lib/crypto/secrets` (`isSecretEncryptionConfigured`).

| Case                                                 | Expected behavior                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isSecretEncryptionConfigured()` false               | Throws `AiUnavailableError` immediately; **no** `prisma.userAiSettings`/`prisma.transaction`/`prisma.category` calls happen (assert zero calls on each).                                                                                                                                                                                                                                                    |
| No settings row / no key                             | Throws `ServiceValidationError` "Add an API key in Settings first." before any rate-limit or provider call.                                                                                                                                                                                                                                                                                                 |
| `disclosureAcceptedAt === null`                      | Throws `AiDisclosureRequiredError`; the rate-limit `updateMany` calls are **never made** — §5's numbered sequence is definitive: unavailable(1) → no key(2) → disclosure(3) → rate limit(4) → eligibility(5) → rule-check(6) → category load(7) → request(8/9). Assert exactly this order, not "either order is acceptable."                                                                                |
| Rate limit — day rollover                            | Given `suggestCountDate` from a prior day, the first `updateMany` call rolls `{ suggestCountDate: today, suggestCount: 0 }`, and the second (claim) `updateMany` then succeeds. Assert both calls' `where`/`data` args and their order.                                                                                                                                                                     |
| Rate limit — cap hit                                 | Claim `updateMany` resolves `{ count: 0 }` → throws `AiRateLimitedError` with the local-cap message; the provider client's `suggestCategory` is **never invoked** — this is the literal "checked before any network call" assertion the task calls out explicitly.                                                                                                                                          |
| Rate limit — Nth vs (N+1)th call                     | Simulate `AI_DAILY_SUGGEST_LIMIT` sequential calls against distinct eligible transactions each succeeding (claim `updateMany` returns `{ count: 1 }` while under the limit), then one more call where the mock now returns `{ count: 0 }` → only that final call throws `AiRateLimitedError`; all prior calls resolved normally.                                                                            |
| Eligibility query shape                              | `prisma.transaction.findFirst` is called with exactly `{ id: transactionId, userId, categoryId: null, skippedAt: null, isTransfer: false, isPayment: false }` — the same predicate as `getCategorizeQueue`.                                                                                                                                                                                                 |
| Ineligible — already categorized                     | `categoryId` set on the row → `findFirst` returns `null` (via the where clause) → `ServiceValidationError` "That transaction is no longer in the categorize queue."                                                                                                                                                                                                                                         |
| Ineligible — skipped                                 | `skippedAt` set → same rejection.                                                                                                                                                                                                                                                                                                                                                                           |
| Ineligible — transfer leg                            | `isTransfer: true` → same rejection.                                                                                                                                                                                                                                                                                                                                                                        |
| Ineligible — card payment                            | `isPayment: true` → same rejection.                                                                                                                                                                                                                                                                                                                                                                         |
| Ineligible — wrong user                              | A transaction id that exists but belongs to a different `userId` → `findFirst` (correctly scoped) returns `null` → same rejection, not a leak of another user's row.                                                                                                                                                                                                                                        |
| Rule already matches                                 | `matchCategoryRule` (mocked) returns a non-null `categoryId` for the transaction's payee/note → throws `ServiceValidationError` "A rule already categorizes this transaction."; the provider client is **never invoked**.                                                                                                                                                                                   |
| Zero categories                                      | `prisma.category.findMany` resolves `[]` → resolves `{ outcome: 'none' }` directly; the provider client's `suggestCategory` is **never invoked** — but the rate-limit slot **is** already consumed at this point in the sequence (assert the claim `updateMany` did happen), since the short-circuit happens after the rate-limit step per the architecture doc's numbered sequence.                        |
| Toggles honored — both off                           | Stored `sendNote: false, sendAmount: false` → the request object passed to `suggestCategory` has no `note`/`amount` keys, even though the transaction row has a note and a non-null amount.                                                                                                                                                                                                                 |
| Toggles honored — note on                            | `sendNote: true` → request's `note` equals the transaction's note text exactly.                                                                                                                                                                                                                                                                                                                             |
| Toggles honored — amount on                          | `sendAmount: true` → request's `amount` equals the transaction's amount formatted as the same `"123.45"`-style string used elsewhere in this service (`Number(amount).toFixed(2)`).                                                                                                                                                                                                                         |
| Amount formatting — zero                             | Transaction `amount: 0` with `sendAmount: true` → request's `amount` is exactly `"0.00"`, not omitted (zero is a legitimate value, not a falsy "no amount").                                                                                                                                                                                                                                                |
| Amount formatting — always positive                  | `Transaction.amount` is validated `.positive()` at write time (`lib/validators/transactions.ts`) — sign lives in `type` (`INCOME`/`EXPENSE`), not the amount itself. No negative-amount case is reachable; skip it rather than fabricate one. Substitute a large realistic value instead (e.g. `9999999999.99`, the `Decimal(12,2)` ceiling) to confirm formatting doesn't break at the type's upper bound. |
| Amount formatting — Decimal with >2 places           | A Prisma `Decimal` amount of `19.999` → request's `amount` is `"20.00"` (rounded, not truncated or passed through with extra precision) — asserts the same rounding rule the rest of the app uses for money display, not a bespoke one for this feature.                                                                                                                                                    |
| Disclosure preview can't drift on money              | For the same transaction and toggle state, `getAiDisclosurePreview`'s `fields[].value` for the amount field and `suggestCategoryWithAi`'s actual outbound `amount` are produced by the identical formatting path and are asserted equal — not just "both look like money," but the literal same string, for the zero and >2-decimal-place cases above too.                                                  |
| Match resolution                                     | Provider resolves `{ outcome: 'match', categoryId }` for an id present in the already-loaded category list → service resolves `{ outcome: 'match', categoryId, categoryName }` with `categoryName` taken from the already-fetched list — `prisma.category.findMany` is called exactly once (no second round trip for the name).                                                                             |
| Match on a nonexistent id (defense in depth)         | Provider (or a corrupted mock) names an id **not** in the loaded category list → resolves `{ outcome: 'none' }`, **never throws to the caller** — the `AiInvalidResponseError` is caught inside this function.                                                                                                                                                                                              |
| Provider errors propagate                            | `AiProviderAuthError`, `AiRateLimitedError` (provider-side 429, distinct from the local-cap case above), and `AiProviderUnavailableError` thrown by the adapter all **reject** `suggestCategoryWithAi`'s promise (they are not converted to `{ outcome: 'none' }` — only `AiInvalidResponseError` is). Assert each with `.rejects.toBeInstanceOf(...)`.                                                     |
| `getAiDisclosurePreview`, queue non-empty            | Preview is built via `buildSuggestionPayload` over the most recent eligible queue row; `exampleFromRealTransaction: true`; `fields` matches what a direct call to `buildSuggestionPayload` with the same inputs would produce (no drift between disclosure and reality).                                                                                                                                    |
| `getAiDisclosurePreview`, queue empty                | Uses a synthetic placeholder row; `exampleFromRealTransaction: false`.                                                                                                                                                                                                                                                                                                                                      |
| `getAiDisclosurePreview` never touches gating/limits | Does not check `disclosureAcceptedAt` and does not call the rate-limit `updateMany`s or the provider client — it must be callable **before** the user has accepted, since it's what they review first.                                                                                                                                                                                                      |
| Every query scoped by `userId`                       | Table-driven assertion: each `prisma.*` call made anywhere in `suggestCategoryWithAi`/`getAiDisclosurePreview` includes `userId` in its `where`.                                                                                                                                                                                                                                                            |

### `tests/unit/services/userData.test.ts` — the two regression additions

| Case                          | Expected behavior                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export excludes AI settings   | Even with a `UserAiSettings`-shaped row available in the mocked Prisma layer, `JSON.stringify(await exportUserData(userId))` contains none of the substrings `"provider"`, `"encryptedApiKey"`, `"keyLast4"`. Guards the "excluded by omission" design against a future accidental `select` addition.                                                                                          |
| Restore preserves AI settings | Whatever function performs a full-replace restore (`wipeUserData`/`importUserData`) never calls any `prisma.userAiSettings.*` method — assert zero calls on that mock namespace across the whole restore flow. This is the literal "`wipeUserData` must not gain a `userAiSettings.deleteMany`" trap called out in the architecture doc, named so a future refactor that adds it fails loudly. |

---

## E2E test plan

Playwright, `tests/e2e/`, following the login-helper + `getByRole`/`getByTestId`
conventions in `tests/e2e/transaction-filters-dialog.spec.ts` and the
viewport-switching convention in `tests/e2e/mobile-add-transaction.spec.ts`.

### Required new test infrastructure — resolved 2026-09-18: approved

This repo has **no existing pattern for mocking an outbound HTTP call from
Playwright**, and `page.route()` cannot help here regardless: the Anthropic/
OpenAI calls happen inside the Next.js server process (API route handlers),
not the browser, so intercepting browser-originated requests never sees them.

**Decision: approved by the user.** This adds a base-URL override to
`lib/ai/anthropic.ts`/`openai.ts`, which reads as an exception to §8's
security checklist line "Outbound base URLs are module constants — no
user-supplied endpoint, base URL or proxy field anywhere" — but the override
is read exclusively from server-side env config (never request input, same
trust level as `SECRET_ENCRYPTION_KEY`), so it doesn't reopen the SSRF
concern that line was guarding against (an authenticated app user pointing
outbound calls at an arbitrary URL). Treat §8's line as "no _user_-supplied
endpoint" — this override is operator/deploy-config-supplied, not
user-supplied, same category as `DATABASE_URL`.

The shape is:

1. A test-only local fixture HTTP server (e.g. `tests/e2e/fixtures/ai-provider-server.ts`)
   that speaks the same two endpoints as the real providers (a probe GET, a
   suggest POST) plus a small control API (`POST /__control/next-response` to
   program the next status/body/delay, `GET /__control/last-request` to
   inspect what was sent).
2. `process.env.AI_ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'` /
   `AI_OPENAI_BASE_URL` read by the two adapters, pointed at the fixture
   server's local port via the e2e `webServer` config.

e2e cases 11a–e, 12, and 13 below are written as specified, against the fixture server.

### A. Settings — `tests/e2e/ai-categorization-settings.spec.ts`

1. **First-time save shows the disclosure, accept saves and masks.** Program
   the fixture probe to 200. Go to `/settings`, fill a fake key
   (`sk-ant-e2e-...`, ≥20 chars), click "Save key". Assert the disclosure
   dialog (`getByRole('dialog', { name: 'Review what gets sent' })`) appears
   with its preview fields populated (wait past the loading skeleton). Click
   "Looks good, continue". Assert: dialog closes; the API key input is
   cleared; a "key saved and verified" message is visible; reloading the page
   still shows the masked/verified state (`configured: true` round-tripped
   through the server).

2. **Second provider swap — no disclosure modal.** Starting from an already-accepted
   state, select the other provider pill, type a new key, click "Save key".
   Assert **no** dialog appears (assert dialog count is 0 immediately, don't
   just wait-and-miss it) and the settings update directly to the new
   provider's "saved and verified" message.

3. **Auth-rejected key refuses to persist.** Program the fixture probe to 401.
   Save a key. Assert an inline `role="alert"` element with the exact text
   "Your {Provider} API key was rejected. Check it in Settings and save it
   again." and that reloading shows the settings **unchanged** from before
   the attempt (not saved).

4. **Outage on save persists unverified with a warning.** Program the fixture
   probe to 500. Save a key. Assert a `role="status"` (not `role="alert"`)
   element with the "saved — not yet verified" copy, and that reloading still
   shows `configured: true, verified: false`.

5. **Remove key disables Suggest app-wide.** With a key configured, visit
   `/categorize` and confirm at least one "Suggest with AI" affordance is
   present for an eligible row. Return to `/settings`, click "Remove key".
   Assert the Settings card returns to its unconfigured display. Reload
   `/categorize` and assert the Suggest affordance is now either fully absent
   or rendered disabled with a visible reason ("Add an API key in Settings
   first.") — accept either, but require it be one of those two, not a
   silently-clickable button that then fails.

6. **Toggles gate on `configured` and persist independently across reload.**
   With no key configured, assert both toggle switches render
   `aria-checked="false"` and disabled, with the "Save an API key to turn
   these on." hint visible. Configure a key. Turn "Include the transaction
   note" on; assert `aria-checked="true"` immediately. Reload; assert it's
   still on. Independently turn "Include the amount" on (leaving note as-is);
   reload; assert **both** persisted states are correct (proves one toggle's
   PATCH doesn't clobber the other).

### B. Categorize queue — `tests/e2e/ai-suggest-categorize.spec.ts` (+ a mobile-viewport variant)

Setup shared across this file: a configured + verified + disclosure-accepted
key (drive this through the real Settings flow once per test, or via direct
`page.request.put('/api/settings/ai', ...)`/`post('/api/settings/ai/disclosure')`
calls after login, mirroring how other specs create fixture data through real
endpoints rather than a seed script) and one or more uncategorized,
unmatched-by-rule transactions created via the existing add-transaction UI
helper pattern.

7. **Happy path — grouped payee cards (default desktop view).** Add a
   transaction with a unique payee. Program the fixture's suggest endpoint to
   return a match for a real category id (fetch the category list via the UI
   first to pick one). Click "Suggest with AI" on that payee's card; assert
   the button enters its loading state (`aria-busy="true"`, "Asking…").
   Assert the suggestion lands in the row's existing category-select control
   (pre-filled, not yet applied) exactly like a rule-based suggestion would.
   Confirm/apply it via the existing accept action; assert the row leaves the
   queue and the progress count updates.

8. **Happy path — desktop table view.** Same flow against the dense table row
   render path. Assert the compact icon-only button variant is used
   (`aria-label`/`aria-describedby` present, no visible "Suggest with AI"
   text) and that the row's category `Select` is controlled — i.e. it visibly
   reflects the AI suggestion the same way it reflects a rule match today.

9. **Happy path — mobile cards.** `test.use({ viewport: <mobile size, matching
mobile-add-transaction.spec.ts> })`. Repeat the suggest-then-confirm flow
   against the mobile card layout; assert the non-compact icon+label button
   variant renders.

10. **Rule-matched row never shows Suggest.** Create a `CategoryRule` matching
    a payee, add a transaction with that payee so the queue shows a
    rule-based suggestion already. Assert that row does **not** render a
    "Suggest with AI" button at all — `toHaveCount(0)`, not merely disabled.

11. **Error states — exact copy per state** (requires the fixture server):
    - a. Probe/suggest 401 → `role="alert"` text exactly "Your {Provider} API
      key was rejected. Check it in Settings and save it again."
    - b. Suggest 429 → "{Provider} is rate-limiting your key right now. Wait a
      minute and try again."
    - c. Suggest 500 or malformed body → "{Provider} is having trouble right
      now. Try again in a few minutes."
    - d. Suggest hangs past `AI_TIMEOUT_MS` → "The request to {Provider} timed
      out. Try again in a few minutes." Flag this as the one intentionally
      slow test in the suite (real 10s wait) — acceptable as a single,
      clearly-commented case rather than something to avoid entirely; do not
      multiply it across providers/render-sites.
    - e. Suggest response names a nonexistent category id, or returns the
      literal `"none"` sentinel → **not** an alert; the informational "No
      confident match — pick a category yourself." message renders instead,
      with a non-`alert` role.
      Each assertion checks the exact string from the architecture doc's
      section 6 table, not a substring/regex match.

12. **Daily cap — the (N+1)th call, not "no bulk route exists".** Seed
    `AI_DAILY_SUGGEST_LIMIT` distinct eligible transactions (import/expose the
    constant for the spec to read, or hardcode the pinned value once
    implementation fixes it). Drive "Suggest with AI" against each in turn,
    each returning a normal 200. Then attempt one more (`N+1`th, against
    another eligible row) and assert the response is exactly "You've hit
    today's limit of {N} AI suggestions. Try again tomorrow." This is the
    concrete, testable stand-in for "bulk suggest doesn't exist" per the
    non-goals below — pick the smallest sane `AI_DAILY_SUGGEST_LIMIT` so this
    stays a fast test.

13. **Toggle enforcement is server-side, not just persisted UI state**
    (requires the fixture server's `last-request` control endpoint). With
    `sendNote` off, trigger Suggest on a transaction that has a note; inspect
    the fixture's last received request body and assert no `note` field is
    present. Toggle `sendNote` on, Suggest again (same or another eligible
    row with a note), assert the request now includes the exact note text.
    Repeat for `sendAmount`. This is the sharper end-to-end version of the
    unit-level toggle tests — it proves the real HTTP boundary, not just the
    service function's in-process behavior.

### Explicit non-applicable case

- A "disclosure not yet accepted" e2e case is **not written**: there is no UI
  action that un-accepts a disclosure once given, so this state is only
  reachable via direct API manipulation, which is better covered by the
  `AiDisclosureRequiredError` unit test than by a Playwright spec built around
  bypassing the UI it's supposed to exercise.

---

## Explicit non-goals for this test plan

Mirrors the PM's non-goals list in the architecture doc.

- **No test asserting a bulk-suggest route doesn't exist.** Absence of a route
  isn't testable behavior. Covered instead by e2e case 12 above (the
  `(N+1)`th single-suggest call hits the cap) and by the unit-level "provider
  never invoked once the cap is hit" case.
- **No test against real Anthropic/OpenAI APIs**, anywhere, unit or e2e.
  Every provider interaction is mockable: `global.fetch` at the unit level,
  the local fixture server + base-URL override at the e2e level.
- **No test of the manual key-rotation runbook** (`docs/runbooks/rotate-secret-encryption-key.md`)
  — it's an operational procedure a human runs, not app behavior under test.
- **No concurrency/load test of the DB-backed rate limiter.** The "atomic at
  the row level" claim is a Postgres guarantee; verifying it under real
  concurrent load needs a dedicated harness this plan doesn't scope. Flag as
  manual/DB-level verification before merge, the same way `pwa-push-reminders.md`
  flagged cron behavior as manually verified rather than e2e-covered.
- **No snapshot test of the literal system-prompt wording** beyond the
  field-presence assertions above — the prompt copy itself isn't user-facing
  and should be free to iterate without breaking tests.
- **No new coverage of unrelated auth/session flows** — this feature reuses
  existing session gating; that's already covered by existing tests.
