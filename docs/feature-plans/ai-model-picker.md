# AI model picker (BYOK)

Let the user choose which model their saved Anthropic/OpenAI key uses for category
suggestions, sourced from the provider's live `/v1/models` list. Replaces the hardcoded
`ANTHROPIC_MODEL` / `OPENAI_MODEL` as the runtime default.

Motivating bug: a workspace-scoped Anthropic key is not permitted to use
`claude-3-5-haiku-latest` (`lib/ai/anthropic.ts:38`), so `/v1/messages` returns a non-401/403/429
4xx, `classifyProviderStatus` maps it to `AiProviderUnavailableError` and the user sees a generic
502 with no route to a fix.

Product decisions taken as given (do not re-litigate): schema change authorized; list is fetched
live on every Settings page render; default is auto-pick the first entry of the first successful
list fetch.

## 1. Architecture summary

```
Settings render ──► listAiModels(userId) ──► decrypt key ──► provider GET /v1/models
                         │                                        │
                         │                                   filter + normalize
                         ▼                                        │
              conditional backfill of modelId  ◄──────────────────┘
                 (updateMany where modelId: null)

PUT /api/settings/ai  ──► saveAiSettings ──► probe GET /v1/models (already exists,
                                              now returns data) ──► upsert sets modelId
                                              from list[0] in the same write

PATCH /api/settings/ai/model ──► updateAiModel ──► narrow updateMany (modelId only)

POST /api/categorize/suggest-ai ──► suggestCategoryWithAi ──► resolveEffectiveModel()
                                     ──► suggestCategory(apiKey, model, request, signal)
```

Three properties the design is built around:

1. **The Settings page must not be able to 500.** `app/(protected)/settings/page.tsx` runs the AI
   call inside a `Promise.all` with `userHasPassword` / `getReminderPreference` /
   `listPushSubscriptions`. One rejection takes down password change, reminders, export and import.
   `listAiModels` therefore returns a discriminated union and **never throws**.
2. **Suggest-time makes exactly one outbound call.** `aiCategorize.ts` step 9 is a single provider
   request. The effective model must be resolvable from the DB alone — which is _why_ the auto-pick
   is persisted rather than resolved lazily. Lazy resolution would force the hardcoded constant as
   the runtime default, which decision 3 rejects.
3. **`listModels` still sends no user data.** It gains a return value; it gains no request body, no
   query parameter derived from user data, and no new header. The data-minimization assertion from
   c584bdc must keep passing.

## 2. Prisma schema impact — AUTHORIZED BY THIS TASK

CLAUDE.md forbids touching `prisma/schema.prisma` unless the task explicitly requires it. It does
here: the task grants explicit authorization. Recording that so the implementer does not re-ask.

In `model UserAiSettings` (prisma/schema.prisma), after `verifiedAt`:

```prisma
  /// provider model id the user picked for suggestions (e.g.
  /// "claude-3-5-haiku-latest", "gpt-4o-mini"). Always belongs to the
  /// `provider` in the same row — saving a key or switching provider rewrites
  /// this column in the same write, so it can never name a model from the
  /// other provider. null = not yet picked: the next successful models-list
  /// fetch backfills it with the first entry. Existing rows start null, so no
  /// backfill migration is needed.
  modelId         String?
```

- Named `modelId`, not `model` — reads ambiguously next to Prisma's `model` keyword, and this
  table's convention is descriptive (`keyLast4`, `encryptedApiKey`, `suggestCountDate`).
- Nullable, no default. `null` is a real state ("not yet picked"), which is what makes the
  auto-pick backfill and the zero-migration-work-for-existing-rows property both true.
- Migration: `npm run prisma:migrate -- --name add_ai_model_selection`, then
  `npm run prisma:generate`. Expected SQL is a single
  `ALTER TABLE "UserAiSettings" ADD COLUMN "modelId" TEXT;`.
- No change to `lib/services/userData.ts`: `UserAiSettings` is already excluded from export and
  preserved across import, and a model id is not user data worth exporting.

## 3. File-by-file breakdown

### New files

| File                                    | What                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/ai/models.ts`                      | `AiModelSummary` normalization + the per-provider filter. Exports `filterChatModels` (OpenAI heuristic) and `parseModelsResponse` helpers so they are unit-testable without a fetch. |
| `app/api/settings/ai/model/route.ts`    | `PATCH` — persist the user's model choice. Mirrors `app/api/settings/ai/toggles/route.ts` line for line.                                                                             |
| `docs/feature-plans/ai-model-picker.md` | this file                                                                                                                                                                            |

### Changed files

| File                                                          | Change                                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `prisma/schema.prisma`                                        | add `modelId String?` (§2)                                                                                                           |
| `prisma/migrations/<ts>_add_ai_model_selection/migration.sql` | generated                                                                                                                            |
| `lib/ai/types.ts`                                             | `listModels` return type; new `AiModelSummary` type                                                                                  |
| `lib/ai/anthropic.ts`                                         | `listModels` parses+returns; `suggestCategory` takes `model`; `ANTHROPIC_MODEL` → `ANTHROPIC_FALLBACK_MODEL`                         |
| `lib/ai/openai.ts`                                            | same, plus `filterChatModels` applied; `OPENAI_MODEL` → `OPENAI_FALLBACK_MODEL`                                                      |
| `lib/ai/index.ts`                                             | re-export renames; new `AI_LIST_TIMEOUT_MS`; new `getFallbackModel(provider)`                                                        |
| `lib/ai/errors.ts`                                            | new `AiModelRejectedError`; optional model context on `classifyProviderStatus`; `aiErrorToResponse` entry                            |
| `lib/validators/ai-settings.ts`                               | new `updateAiModelSchema`                                                                                                            |
| `lib/services/aiSettings.ts`                                  | `listAiModels`, `updateAiModel`, `modelId` on `FrontendAiSettings` + `AiCredentials`, model auto-set inside `saveAiSettings`' upsert |
| `lib/services/aiCategorize.ts`                                | resolve the effective model, pass it to `suggestCategory`                                                                            |
| `app/api/settings/ai/route.ts`                                | `PUT` response now also carries `models`                                                                                             |
| `app/(protected)/settings/page.tsx`                           | add `listAiModels` to the existing `Promise.all`, pass result to `SettingsView`                                                      |
| `components/settings/settings-view.tsx`                       | thread the new prop through                                                                                                          |
| `components/settings/ai-categorization-section.tsx`           | model picker UI; `handleRemove`'s full `FrontendAiSettings` literal needs the new field                                              |

### Test files that break (hand to the tester)

- `tests/unit/lib/ai-anthropic.test.ts:56` `resolves.toBeUndefined()`; `:164` `body.model === ANTHROPIC_MODEL`.
- `tests/unit/lib/ai-openai.test.ts:53`, `:172` — same two.
- `tests/unit/services/aiSettings.test.ts:92` `listModels.mockResolvedValue(undefined)` must resolve to a list; `:156`, `:181-233` probe assertions still hold.
- `tests/unit/services/aiCategorize.test.ts:13` and `tests/unit/lib/ai-index.test.ts:11,18` — client mock shape / identity checks.
- `tests/e2e/fixtures/ai-provider-server.ts:135` — `/v1/models` is hardcoded to
  `{ data: [{ id: 'fixture-model' }] }`. Needs a programmable `models` field on `Programmed` and a
  `programModels` helper in `tests/e2e/fixtures/ai-control.ts`, including a list containing
  non-chat OpenAI entries to exercise the filter.
- `tests/e2e/ai-categorization-settings.spec.ts`, `tests/e2e/ai-suggest-categorize.spec.ts` — new
  picker surface and the new error path.

## 4. `AiProviderClient.listModels` contract

In `lib/ai/types.ts`:

```ts
/** One selectable model. `label` is display-only; `id` is what goes on the wire. */
export type AiModelSummary = { id: string; label: string };

export type AiProviderClient = {
  readonly provider: AiProviderName;
  /**
   * Cheap GET, used both as the save-time verification probe and as the
   * Settings-page picker source. Sends no user data: no body, and no header or
   * query parameter derived from user data (Anthropic sends a constant
   * `limit`). Returns provider-filtered, chat-capable models in a deterministic
   * order — `[0]` is the auto-pick default.
   */
  listModels: (apiKey: string, signal: AbortSignal) => Promise<AiModelSummary[]>;
  suggestCategory: (
    apiKey: string,
    /** resolved by the service; deliberately NOT part of AiSuggestionRequest */
    model: string,
    request: AiSuggestionRequest,
    signal: AbortSignal,
  ) => Promise<AiSuggestionResult>;
};
```

**`model` is a separate parameter, not a field on `AiSuggestionRequest`.** `AiSuggestionRequest` is
the data-minimization payload: `buildSuggestionPayload` renders it and `previewFields` in
`aiCategorize.ts` derives the user-facing disclosure list from it. A non-transaction field there
would make the disclosure claim something false. Do not "clean this up."

### Parsing and filtering

Both adapters read only the fields they need and ignore the rest; an unparseable body throws the
existing `AiInvalidResponseError(provider)` with no detail, preserving "never echoes the provider's
body."

**Both `listModels` fetches must pass `cache: 'no-store'`.** Until now `listModels` only ran from a
POST handler; decision 2 moves it onto a server-component render path, where App Router's patched
`fetch` applies different caching/deduping semantics to GETs. If the response is cached, the picker
serves a stale list and "fetch live on every render" becomes quietly false. Harmless in the
save-time path, load-bearing in the render path. **Verify the actual semantics in
`node_modules/next/dist/docs/` for this Next version before implementing** — CLAUDE.md warns this
version differs from training data, and this is the item most likely to make the shipped feature
silently not match the product decision.

**Anthropic** — `GET /v1/models?limit=100`, headers unchanged (`x-api-key`, `anthropic-version`).
Response `{ data: [{ id, display_name }] }`. No filter: every model Anthropic lists takes
`/v1/messages` with tools. `label = display_name ?? id`. Single page only (see open question 2).

**OpenAI** — `GET /v1/models`, `Authorization: Bearer`. Response `{ data: [{ id, created }] }`.
`/v1/models` mixes in embeddings, whisper, tts, dall-e, moderation, which cannot satisfy the
`strict: true` structured-output contract. `filterChatModels` in `lib/ai/models.ts`:

```ts
/**
 * Coarse prefix heuristic, NOT a capability matrix. The list is not ground
 * truth for what /v1/chat/completions accepts (which is exactly why the
 * model-rejected error path in §7 is mandatory regardless) — this only keeps
 * obviously-wrong entries out of the picker.
 */
export const filterChatModels = (models: AiModelSummary[]): AiModelSummary[] => { ... }
```

Deny-substring pass on the id: `embedding`, `whisper`, `tts`, `dall-e`, `moderation`,
`audio`, `realtime`, `image`, `transcribe`, `search`, `babbage`, `davinci`, `codex`.
**If filtering yields zero entries, return the unfiltered list** rather than an empty picker — a
wrong-looking picker is recoverable, an empty one is a dead end, and the §7 error path already
covers picking something unusable. Write a comment saying so.

`label = id` for OpenAI (the API supplies no display name).

## 5. Service layer (`lib/services/aiSettings.ts`)

### 5a. `FrontendAiSettings` and `AiCredentials` gain a field

```ts
export type FrontendAiSettings = {
  ...existing,
  /** null until the first successful list fetch auto-picks one */
  modelId: string | null;
};
```

Add `modelId: null` to `UNCONFIGURED()` and `modelId: row.modelId` to `toFrontend`, plus
`modelId: string | null` on `SettingsRow` and on `AiCredentials` / `loadAiCredentials`'s return.
Keep the explicit field-by-field projection — never a spread of the Prisma row.

### 5b. `saveAiSettings` — auto-pick folded into the existing probe

The probe at line 103 already makes the `/v1/models` call and discards the body. Now it keeps it:

```ts
let verifiedAt: Date | null = new Date();
let warning: string | null = null;
let models: AiModelSummary[] = [];
try {
  models = await client.listModels(input.apiKey, AbortSignal.timeout(AI_TIMEOUT_MS));
} catch (error) {
  /* unchanged: rethrow AiProviderAuthError, else soft-fail */
}

// Auto-pick, decision 3. `?? null` is what resets a stale selection when the
// user switches provider or saves a new key: the full-row upsert writes the
// column unconditionally, so a model id belonging to the previous provider can
// never survive.
const modelId = models[0]?.id ?? null;
```

`modelId` goes in **both** the `create` and `update` branches of the existing upsert. No second
provider call, no second write, no window in which the row names a model from the old provider.
Soft probe failure (429/5xx/network/timeout) leaves `modelId = null`; the next Settings render
backfills it (§5c).

Return type becomes `FrontendAiSettings & { warning: string | null; models: AiModelSummary[] }` —
the client component holds `settings` in `useState` seeded from props, so `router.refresh()` would
not reseed the picker after a key save. Returning the list from the PUT is what actually
repopulates it, at zero extra cost.

### 5c. `listAiModels` — the Settings-render fetch

```ts
export type AiModelsResult =
  | { outcome: 'not-configured' }
  | { outcome: 'ok'; models: AiModelSummary[]; selectedModelId: string }
  | { outcome: 'unavailable'; message: string; selectedModelId: string | null };

export const listAiModels = async (userId: string): Promise<AiModelsResult> => { ... }
```

**Never throws** (property 1). Steps:

1. `prisma.userAiSettings.findUnique({ where: { userId } })` — no row, or
   `!isSecretEncryptionConfigured()` → `{ outcome: 'not-configured' }`.
2. Decrypt via the existing in-module `decryptSecret`. A decrypt failure → `outcome: 'unavailable'`
   with the existing "Your saved API key could not be read. Save it again in Settings." copy. The
   crypto import stays confined to this file.
3. `getAiProviderClient(row.provider).listModels(apiKey, AbortSignal.timeout(AI_LIST_TIMEOUT_MS))`.
   Any throw is caught and mapped to `{ outcome: 'unavailable', message: error.message,
selectedModelId: row.modelId }` — our typed errors already carry user-safe copy; anything
   unrecognized gets a generic "Couldn't load the model list from <provider> just now." and is
   `console.warn`ed by name only.
4. Empty list → `{ outcome: 'unavailable', message: "<Provider> didn't return any usable models for
this key.", selectedModelId: row.modelId }`.
5. Backfill when unset, conditionally, so concurrent renders/tabs cannot clobber an explicit pick:

```ts
let selectedModelId = row.modelId;
if (selectedModelId === null) {
  selectedModelId = models[0].id;
  await prisma.userAiSettings.updateMany({
    where: { userId, modelId: null }, // the null guard is the concurrency guard
    data: { modelId: selectedModelId },
  });
}
```

6. If `row.modelId` is set but absent from the returned list, **keep it** and return it as
   `selectedModelId` anyway (the UI renders it as a still-selected entry). The list is not ground
   truth; silently reassigning a user's setting on a page render is worse than a picker that shows
   an id the list omitted.

### 5d. `updateAiModel` — the narrow update

Follows `updateAiToggles` exactly:

```ts
export const updateAiModel = async (
  userId: string,
  input: UpdateAiModelInput,
): Promise<FrontendAiSettings> => {
  // updateMany scoped by userId carrying only `modelId`: no code path here can
  // touch encryptedApiKey, provider or verifiedAt, and no provider call is made
  // — changing the model is not a re-verification of the key.
  const updated = await prisma.userAiSettings.updateMany({
    where: { userId },
    data: { modelId: input.modelId },
  });
  if (updated.count === 0) {
    throw new ServiceValidationError('Add an API key in Settings first.');
  }
  return getAiSettings(userId);
};
```

No probe, no `verifiedAt` re-stamp, no key decryption. The value is **not** validated against a
live list: that would mean a provider call per model change, and the list is not ground truth
anyway — §7 is the real backstop. Zod bounds it to a plausible id (§6).

## 6. Validator (`lib/validators/ai-settings.ts`)

```ts
/**
 * Model id only — `.strict()`, following updateAiTogglesSchema: a client that
 * smuggles an `apiKey` or `provider` field gets a 400 rather than a silent drop.
 * Not checked against a live list: that would cost a provider call per change,
 * and the list is not ground truth for what the completion endpoint accepts.
 */
export const updateAiModelSchema = z
  .object({
    modelId: z
      .string()
      .trim()
      .min(1, 'Pick a model')
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/, 'That does not look like a model id'),
  })
  .strict();

export type UpdateAiModelInput = z.infer<typeof updateAiModelSchema>;
```

## 7. Error path: stored model rejected at suggest time

Required regardless of filtering, per the PM. `classifyProviderStatus` currently maps 403 →
`AiProviderAuthError` (400) and >=500 → 'server'; the observed 502 therefore means a non-401/403/429
4xx — 404 being the likely one for an unpermitted model id.

New class in `lib/ai/errors.ts`:

```ts
/**
 * The model id stored in the user's Settings was rejected by the completion
 * endpoint. Distinct from AiProviderUnavailableError because the user action is
 * different and actionable: pick another model, not "try again in a few minutes".
 */
export class AiModelRejectedError extends Error {
  constructor(
    public readonly provider: AiProviderName,
    public readonly modelId: string,
  ) {
    super(
      `${PROVIDER_LABELS[provider]} wouldn't accept the AI model saved in your Settings. Pick a different model in Settings.`,
    );
    this.name = 'AiModelRejectedError';
  }
}
```

The id is echoed only in the `modelId` property, never in the message — it is the user's own stored
setting, not provider body content, but keeping messages id-free stays consistent with the module's
rule 2.

Classification, without changing existing semantics:

```ts
export const classifyProviderStatus = (
  provider: AiProviderName,
  status: number,
  context?: { modelId: string }, // absent for listModels → byte-identical behavior
): Error => {
  if (status === 401 || status === 403) return new AiProviderAuthError(provider);
  if (status === 429) return new AiRateLimitedError({ reason: 'provider', provider });
  if (context && (status === 404 || status === 400)) {
    return new AiModelRejectedError(provider, context.modelId);
  }
  if (status >= 500) return new AiProviderUnavailableError(provider, 'server');
  return new AiProviderUnavailableError(provider, 'other');
};
```

- **404 → model rejected.** High confidence; this is the unpermitted/retired-id status.
- **400 → also mapped, deliberately.** 400 is ambiguous (malformed payload, oversized enum, bad
  model), which is why the message is phrased "wouldn't accept the model saved in your Settings"
  rather than "that model doesn't exist" — it is not actively false in the malformed-payload case,
  and a payload bug is our bug, surfaced to the user either way. Note this in the code comment.
- Only the `suggestCategory` call sites pass `context`. `listModels` passes nothing, so
  `tests/unit/lib/ai-errors.test.ts` and both adapters' probe tests keep their current behavior.

`aiErrorToResponse` gains, **above** the `ServiceValidationError` branch (otherwise it falls through
to `null` and the route rethrows into a 500):

```ts
if (error instanceof AiModelRejectedError) {
  return { status: 400, message: error.message };
}
```

`aiCategorize.ts` step 9's catch must **not** treat this as `{ outcome: 'none' }` — it rethrows,
like every non-`AiInvalidResponseError`, so the route returns the actionable 400.

**Do not clear `modelId` on this error.** Auto-repair was not asked for, "auto-retry against a
different model" is an explicit non-goal, and silently mutating a user's setting on an error path is
worse than the error. Written here so nobody adds it helpfully.

## 8. Effective-model resolution at suggest time

`lib/ai/index.ts`:

```ts
export { ANTHROPIC_FALLBACK_MODEL, OPENAI_FALLBACK_MODEL };

/**
 * Last resort only: reached when the row's modelId is still null, i.e. the key
 * was saved during a provider outage and no Settings render has since succeeded
 * in fetching a list. A stale id here is low-stakes — it surfaces as
 * AiModelRejectedError, which points the user at the picker.
 */
export const getFallbackModel = (provider: AiProviderName): string =>
  provider === 'ANTHROPIC' ? ANTHROPIC_FALLBACK_MODEL : OPENAI_FALLBACK_MODEL;

/** Shorter than AI_TIMEOUT_MS: this one sits on the Settings render path. */
export const AI_LIST_TIMEOUT_MS = 5_000;
```

In `suggestCategoryWithAi` step 9:

```ts
const model = credentials.modelId ?? getFallbackModel(credentials.provider);
result = await getAiProviderClient(credentials.provider).suggestCategory(
  credentials.apiKey,
  model,
  request,
  AbortSignal.timeout(AI_TIMEOUT_MS),
);
```

No list call here — the single-outbound-call property of step 9 is preserved.

The renames discharge the two un-discharged `TODO: reverify this id` comments: as a fallback reached
only when the list fetch itself failed, a stale id is acceptable. Rewrite the comments to say that
instead of deleting them silently.

## 9. Routes

### `PATCH /api/settings/ai/model` (new)

Clone `app/api/settings/ai/toggles/route.ts`: `runtime = 'nodejs'`, session guard → 401,
`updateAiModelSchema.safeParse(await request.json().catch(() => null))` → 400 with
`parsed.error.issues[0].message`, then `updateAiModel`, then `aiErrorToResponse`/rethrow. No
business logic in the handler.

- Request: `{ "modelId": "claude-3-5-haiku-latest" }`
- 200: `FrontendAiSettings` (now including `modelId`)
- 400: `{ error: string }` (bad shape, or "Add an API key in Settings first.")
- 401: `{ error: "Unauthorized" }`

### `PUT /api/settings/ai` (changed response only)

Request shape unchanged. 200 body becomes
`FrontendAiSettings & { warning: string | null; models: AiModelSummary[] }` — `models` is `[]`
when the probe soft-failed. Handler code is unchanged; only the service return type widens.

### `GET /api/settings/ai` (unchanged)

Gains `modelId` in its body by virtue of `FrontendAiSettings`. Deliberately does **not** fetch the
live list: it would put a provider call on a plain settings read.

### No `GET /api/settings/ai/models`

Two sources cover every case: the page render (`listAiModels`) and the PUT response. A route would
only be needed for a standalone "refresh models" button — see open question 4.

## 10. UI wiring (details to the ui-designer)

- `app/(protected)/settings/page.tsx`: add `listAiModels(session!.user.id)` to the existing
  `Promise.all`; pass the result as `aiModels` alongside `aiSettings`. Safe inside the `Promise.all`
  precisely because it never rejects (§5c).
- `components/settings/settings-view.tsx`: thread `aiModels: AiModelsResult` through to
  `AiCategorizationSection`.
- `components/settings/ai-categorization-section.tsx`:
  - New "Model" row below the API-key block, rendered only when `settings.configured`. A native
    `<select>` (the list can be long and unbounded; the `pillGroup` idiom used for Provider does not
    scale to 40 OpenAI ids).
  - **Precedence rule — `aiModels.selectedModelId` wins.** `getAiSettings` and `listAiModels` run
    concurrently in the same `Promise.all` and read the same row, and `listAiModels` _writes_
    `modelId` as a side effect (§5c step 5). On the first render after a soft-failed save,
    `aiSettings.modelId` can come back `null` while `aiModels.selectedModelId` comes back
    `"gpt-4o"`. When `aiModels.outcome === 'ok'`, `selectedModelId` is authoritative for the
    picker's value and `settings.modelId` is never read by the picker. Only the
    `'unavailable'` arm falls back to `settings.modelId`.
  - **A stored id absent from the returned list must still render.** §5c step 6 keeps such an id;
    a `<select>` whose `value` matches no `<option>` renders blank, which is the exact failure that
    step 6 exists to prevent. When `selectedModelId` is not in `models`, prepend it as an option
    labelled `` `${id} (current)` ``. The same code path covers open question 5's
    disabled-single-option case.
  - `onChange` → `PATCH /api/settings/ai/model`, optimistic with rollback, same shape as
    `handleToggle`.
  - Component-local `models` state seeded from the `aiModels` prop and **replaced from the PUT
    response** after a key save (`useState` seeding means a router refresh would not reseed it).
  - `outcome: 'unavailable'` → render the muted-border `role="status"` notice treatment already used
    for `warning`, not the rose error treatment; see open question 5 for the control's state.
  - `handleRemove`'s full `FrontendAiSettings` literal needs `modelId: null` and the local model
    list cleared — TypeScript will flag the literal, which is the intended forcing function.

## 11. Tradeoffs

- **Auto-pick persisted at write time vs resolved lazily at suggest time.** Lazy resolution needs
  the list at suggest time: a second outbound call per suggestion (latency + the user's money) and
  it breaks step 9's single-call property. Without it, "first list entry" is unknowable at suggest
  time and the hardcoded constant becomes the de-facto default — which decision 3 rejects.
  Persisting costs one extra column and one conditional write.
- **Fold the auto-pick into `saveAiSettings`' existing probe vs a separate fetch.** The probe already
  calls `/v1/models` and throws the body away. Reusing it makes "clear on key/provider change" and
  "auto-pick first entry" a single atomic write with no race and no extra provider call.
- **Return `models` from the PUT vs `router.refresh()`.** The section is a client component holding
  `settings` in `useState` seeded from props; a refresh would not reseed it. Returning the list is
  free — it is already in hand.
- **`listAiModels` returns a union vs throws.** It shares a `Promise.all` with four unrelated
  settings services; a throw would blank the whole Settings page over a provider blip.
- **Separate `AI_LIST_TIMEOUT_MS` (5s) vs reusing `AI_TIMEOUT_MS` (10s).** Blast radius: per decision
  2 this call is on every Settings render, so a hung provider adds the full timeout to every Settings
  load. 5s halves that. (Sizing the cost of the agreed timing, not reopening it.)
- **Heuristic prefix filter vs a capability matrix.** The list is not ground truth for the completion
  endpoint, so the filter can only ever be UX polish; §7 is the correctness mechanism. A matrix would
  be a maintenance burden with no added guarantee.
- **`model` as a `suggestCategory` parameter vs an `AiSuggestionRequest` field.** §4.

## 12. Open questions for product — recommended defaults, not silent resolutions

1. **"First entry" is undefined for OpenAI.** `/v1/models` ordering is neither stable nor documented,
   so "auto-pick the first chat-capable model" has no deterministic meaning there. _Recommended
   default:_ impose our own ordering in `lib/ai/models.ts` — OpenAI sorted by `created` descending
   (newest first), tie-broken by id ascending; Anthropic's list is already newest-first and is left
   as returned. "First entry" then means "newest", deterministically, for both. Needs a yes/no: it is
   adjacent to the "no automatic best-model selection" non-goal.
2. **Anthropic pagination.** `/v1/models` returns a `has_more`/`first_id`/`last_id` envelope with a
   default page size of 20. _Recommended default:_ request `?limit=100`, take one page, ignore
   `has_more`. 100 comfortably exceeds Anthropic's catalogue, and following pages would multiply the
   Settings-render cost. Confirm the envelope shape against live API docs during implementation.
3. **Empty after filtering (OpenAI).** _Recommended default (§4):_ fall back to the unfiltered list
   rather than showing an empty picker.
4. **Is a "refresh models" affordance in scope?** _Recommended default:_ no — the list refreshes on
   every Settings render by design, so a button is redundant. If yes, add `GET /api/settings/ai/models`
   returning `AiModelsResult`.
5. **List fetch fails while a model IS stored.** _Recommended default:_ show the muted notice plus a
   disabled `<select>` containing the stored id as its single option, so the user sees what is in
   force and cannot half-change it against a list we could not load.

## Checklist

### Schema

- [x] Add `modelId String?` with the doc comment to `model UserAiSettings` in `prisma/schema.prisma`
- [x] `npm run prisma:migrate -- --name add_ai_model_selection`; confirm the SQL is a single `ADD COLUMN`
- [x] `npm run prisma:generate`

### Provider layer

- [x] `lib/ai/types.ts`: add `AiModelSummary`; change `listModels` to `Promise<AiModelSummary[]>`; add the `model` parameter to `suggestCategory`; update the "sends no user data" comment to cover the new return
- [x] New `lib/ai/models.ts`: `filterChatModels` (deny-substring list, unfiltered fallback when empty) and the shared `data[]` parse helper
- [x] Read `node_modules/next/dist/docs/` on fetch caching for this Next version; pass `cache: 'no-store'` on both `listModels` fetches
- [x] `lib/ai/anthropic.ts`: `listModels` → `?limit=100`, parse `data[].id`/`display_name`, `AiInvalidResponseError` on an unparseable body; `suggestCategory(apiKey, model, request, signal)` uses `model` in the POST body and passes `{ modelId: model }` to `classifyProviderStatus`; rename to `ANTHROPIC_FALLBACK_MODEL` and rewrite the TODO comment
- [x] `lib/ai/openai.ts`: same, plus `filterChatModels` and the §12.1 ordering; rename to `OPENAI_FALLBACK_MODEL`
- [x] `lib/ai/index.ts`: re-export the renamed constants, add `getFallbackModel`, add `AI_LIST_TIMEOUT_MS`
- [x] `lib/ai/errors.ts`: add `AiModelRejectedError`; add the optional `context` arg to `classifyProviderStatus` leaving the context-free path byte-identical; add the `aiErrorToResponse` branch **above** `ServiceValidationError`

### Validator + services

- [x] `lib/validators/ai-settings.ts`: `updateAiModelSchema` (`.strict()`) + `UpdateAiModelInput`
- [x] `lib/services/aiSettings.ts`: `modelId` on `SettingsRow`, `FrontendAiSettings`, `UNCONFIGURED()`, `toFrontend`, `AiCredentials`, `loadAiCredentials`
- [x] `lib/services/aiSettings.ts`: `saveAiSettings` keeps the probe result, writes `models[0]?.id ?? null` in both upsert branches, returns `models`
- [x] `lib/services/aiSettings.ts`: `listAiModels` — union return, never throws, conditional `where: { userId, modelId: null }` backfill, keeps a stored id absent from the list
- [x] `lib/services/aiSettings.ts`: `updateAiModel` — narrow `updateMany`, no probe, no `verifiedAt` touch
- [x] `lib/services/aiCategorize.ts`: `credentials.modelId ?? getFallbackModel(...)`, pass to `suggestCategory`, let `AiModelRejectedError` propagate (not `{ outcome: 'none' }`)

### Routes

- [x] New `app/api/settings/ai/model/route.ts` PATCH, cloned from the toggles handler
- [x] `app/api/settings/ai/route.ts`: confirm the widened PUT response type compiles; no logic change

### UI

- [x] `app/(protected)/settings/page.tsx`: add `listAiModels` to the `Promise.all`, pass `aiModels`
- [x] `components/settings/settings-view.tsx`: thread the prop through
- [x] `components/settings/ai-categorization-section.tsx`: model `<select>`, PATCH handler with rollback, seed + replace-from-PUT list state, `unavailable` notice, `modelId: null` in the `handleRemove` literal
- [x] Implement the `selectedModelId`-wins precedence rule and the prepended `(current)` option for a stored id missing from the list

### Tests (per the tester's plan)

- [x] Update `tests/unit/lib/ai-anthropic.test.ts` and `ai-openai.test.ts` for the new `listModels` return and the `model` parameter
- [x] New unit tests for `filterChatModels` (non-chat entries removed; empty-after-filter falls back) and the §12.1 ordering
- [x] Update `tests/unit/services/aiSettings.test.ts`; add: save auto-sets `modelId`; provider switch resets it; `updateAiModel` leaves key/provider/`verifiedAt` untouched and fires no probe; `listAiModels` never throws on provider failure; backfill is `modelId: null`-guarded
- [x] New unit tests for `AiModelRejectedError` classification (404 and 400 with context; unchanged without) and its `aiErrorToResponse` 400
- [x] `tests/e2e/fixtures/ai-provider-server.ts`: programmable `models` on `Programmed`; `programModels` in `ai-control.ts`; include non-chat entries
- [x] E2e: pick a model and see it persist; model used in the suggest request body; stored-model-rejected shows the actionable Settings message, not the generic 502
- [x] Confirm the c584bdc data-minimization assertion still passes against the new `/v1/models` parsing. Known limitation to note, not fix: the fixture records `url.pathname` only (`ai-provider-server.ts:120`), so query strings are invisible to `lastProviderRequest` — the assertion cannot regress on Anthropic's `?limit=100`, but it also cannot catch a future leak into a query string
- [x] E2e or unit: a stale/cached models list does not survive a second Settings render (guards the `cache: 'no-store'` decision)

### Wrap-up

- [x] `npm run format:fix && npm run lint`
- [x] `npm run test` and `npm run test:e2e`
- [x] Tick this checklist and record resolutions for §12's open questions

## 13. Implementation-pass resolutions

Recorded at implementation time, per the wrap-up item above.

### §12's open questions

1. **OpenAI "first entry" ordering** — implemented as recommended. `parseModelsResponse` sorts
   OpenAI's list by `created` descending, tie-broken by `id` ascending; Anthropic's is left exactly
   as returned. "First entry" therefore means "newest" deterministically for both. The picker
   suffixes the first option with "(newest)" so the ordering is visible rather than implied.
2. **Anthropic pagination** — implemented as recommended: `?limit=100`, one page, `has_more`
   ignored. Asserted in `tests/unit/lib/ai-anthropic.test.ts` (the e2e fixture records
   `url.pathname` only, so the query string is invisible there).
3. **Empty after filtering** — implemented as recommended: `filterChatModels` returns the
   unfiltered list rather than `[]`.
4. **"Refresh models" affordance** — not built, per the recommended default. No
   `GET /api/settings/ai/models` route exists.
5. **List fetch fails while a model IS stored** — implemented as recommended: muted `role="status"`
   notice plus a disabled `<select>` whose single option is the stored id. The
   `unavailable`-with-nothing-stored case renders the notice and no control at all.

### Newly recorded decisions

- **Backfill race (test plan §3.1)** — `listAiModels` does not consult the guarded `updateMany`'s
  `count`. On a lost race it returns the value it computed locally and the next render reconciles.
  Implemented and unit-tested as such; flagged here because the plan never stated it.
- **Same-provider key rotation (test plan §3.3)** — behaves identically to a provider swap: the
  full-row upsert writes `modelId` unconditionally, so a hand-picked model does not survive any
  re-save. No code distinguishes the two cases.
- **`cache: 'no-store'` (§4)** — implemented on both `listModels` fetches and asserted at the unit
  level (`init.cache === 'no-store'`). Per `node_modules/next/dist/docs/01-app/03-api-reference/
04-functions/fetch.md` for Next 16.3.4, within-a-render memoization is separately opted out of by
  passing an `AbortSignal`, which both adapters already do. Note that the Settings route reads the
  session and is therefore request-time/dynamic, so the default `auto no cache` would already
  refetch per request: the e2e staleness test is a valid behavioral guard but is _not_ the thing
  that would catch removal of `no-store`. The unit assertion is.
- **`AiModelSummary` carries no `created`** — the sort key is read and used inside
  `parseModelsResponse`, then discarded when narrowing to `{ id, label }`. Ordering is therefore a
  property of the parse step, which is where it is tested.
