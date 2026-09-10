# Import Batch Tracking, Duplicate Detection, History & Undo

## Status: scoped + architected, ready for ui-designer phase (see checklist)

## Decisions

1. Filename match at commit: **block, require explicit override to re-import.** Implemented as: commit route returns `409` when active batch with mat
   ching normalized filename exists on that account; `commitImportSchema` gains `overrideDuplicateFilename: boolean` — commit proceeds only when true. U
   I surfaces this as a distinct, actionable error (not the current blanket "Import failed."), naming the conflicting batch.
2. Uniqueness scope: **per account** (not global). Enforced in service layer (no native partial-unique constraint for active-only uniqueness in Prism
   a) plus `@@index([userId, accountId, filenameNormalized])`.
3. Filename normalization: **case-insensitive + trimmed.** One exported helper produces `filenameNormalized`, used identically at preview-check, comm
   it-check, and storage.
4. Undone batches: **kept in history, marked "undone"**; filename immediately reusable (status flips, doesn't free via delete).
5. Secondary dup signal: **row count + date range** stored on batch, surfaced alongside filename warning. Definition: store both `rowCount` (submitte
   d row count) and `importedCount` (post-dedupe inserted count); comparison for the warning uses submitted `rowCount` against the prior batch's, to avo
   id false positives from unrelated dedupe skips.
6. Manual-edit tracking: **not built** — no `updatedAt` schema change. Undo silently discards edits made since import. Accepted known gap — undo conf
   irmation copy must explicitly say edits since import will be lost. This covers **skip-state too**: `skippedAt` (added by the categorize-dropdown-skip
   feature, after this decision was first written) has no edit-tracking either — confirmed via `lib/services/categorize.ts:46,75`, which excludes
   `skippedAt`-set rows from the categorize queue. Undo copy must name "recategorized, retyped, or skipped" as a set, not just recategorization/type
   changes.
7. Commit row cap: **align with preview's existing 2000-row limit** (`commitImportSchema.rows.max(2000)`).
8. Cross-batch skipped-duplicate rows (row skipped in batch B as dup of batch A, then A undone → row unrecoverable): **accepted known gap**, no speci
   al handling. Mitigation: persist `skippedDuplicates` count on the batch so the gap is visible in history rather than silent.
9. Schema change: **authorized.** New `ImportBatch` model + `Transaction.importBatch` relation. Migration must first `UPDATE "Transaction" SET "impor
tBatchId" = NULL` (existing values are orphan UUIDs with no matching entity — confirmed unused repo-wide) before adding the FK. Relation uses `onDele
te: SetNull` — undo is implemented as an explicit `prisma.$transaction` (delete matching transactions + flip batch status), never relies on cascade.
10. Multi-account commit: **narrowed to single account.** `commitImportSchema` requires one `accountId` for all rows (matches existing UI behavior).
    `ImportBatch.accountId` is non-null, no join table.
11. Undo confirmation: **type-filename-to-confirm** modal, not a single dialog — reflects irreversibility and the accepted edit-loss gap (decision 6)
    .

## Grounding in current code

- CSV import exists: `app/(protected)/import/page.tsx` → `components/import/import-view.tsx` (client CSV parse) → `POST /api/import/preview` → `POST
/api/import/commit` → `lib/services/csvImport.ts`.
- `Transaction.importBatchId` (`String?`, indexed) exists but is a bare `randomUUID()` set in `commitImport` (`lib/services/csvImport.ts:111`) — no c
  ompanion entity, no filename, no timestamp, no row count. **No `ImportBatch` model.**
- `importBatchId` is written but never read anywhere else (confirmed repo-wide).
- Filename never reaches server today — only used client-side for CSV parsing.
- Row-level duplicate detection exists: `duplicateKey = accountId|date|amount|payee` (`lib/services/csvImport.ts:18-26`), checked at preview AND re-c
  hecked at commit against DB (comment explains: preview snapshot can go stale). **Filename-level check must follow this same pattern: advise at previe
  w, enforce at commit.**
- `commitImport` accepts multi-account requests, but UI only ever submits one account. **Resolved: narrowing `commitImportSchema` to single-account (
  decision 10).**
- Budgets and statement summaries are computed on read, nothing persisted/derived — so **undo needs no reconciliation step**, deleting transactions i
  s sufficient.
- No `updatedAt` on `Transaction`, no edit-tracking — **cannot detect if a transaction was manually edited since import.** Undo will silently discard
  such edits. Accepted as known gap unless user says otherwise.

## User Stories & Acceptance Criteria

### 1. Import batch tracking (filename + metadata)

- Commit request includes original filename; persisted, associated with every transaction in that commit.
- Batch also records: commit timestamp, account(s), transaction count.
- Zero-row commit (all duplicates) creates no batch, reserves no filename — matches existing early-return behavior.
- Failed validation creates no batch, same as today.

### 2. Duplicate-import detection via filename

- At preview: filename match against existing active batch (same account) → distinct warning, separate from row-level dup flags, includes matched bat
  ch's row count + date range (decision 5). Advisory only, does not auto-exclude.
- At commit: filename match on same account → `409`, commit rejected, error names the conflicting batch. Client must resubmit with `overrideDuplicate
Filename: true` to proceed (decision 1). Override creates a new, independent batch — does not merge with or replace the prior one.
- Row-level dedupe continues unchanged, independently of filename check.

### 2a. Row-level duplicate override (fixes existing false-positive bug)

- **Bug found in current code:** `commitImport` (`lib/services/csvImport.ts:97-104`) re-checks every `include:true` row against DB keys at commit tim
  e and silently drops matches — this re-check exists to protect against stale-preview/double-submit, but it also silently discards a user's explicit "
  yes, import this anyway" override of a flagged false-positive duplicate. Today, checking the include box on a duplicate row has no effect if the key
  still matches at commit.
- **Fix:** distinguish "row was never flagged duplicate at preview, but matches now" (stale preview / double-submit → still auto-skip, protection pre
  served) from "row was flagged duplicate at preview AND user explicitly left/checked it included" (explicit override → import it, do not silently drop
  ).
- Server-side commit logic uses the client-echoed `duplicate` flag (already present on each row in the commit payload, since commit posts back the fu
  ll preview rows) together with `include`: `include:true, duplicate:true` at preview time → treated as explicit override, imported without being re-sk
  ipped. `include:true, duplicate:false` at preview time but a DB match now exists → still auto-skipped (stale-preview protection unchanged).
- No new UI needed: the existing per-row checkbox (defaults unchecked for flagged duplicates) already is the override control — checking it is the ex
  plicit action. Row still visually marked "possible duplicate" so the user knows what they're overriding.
- No extra confirmation friction (unlike undo) — this is reviewed in the same preview-then-commit screen before the user clicks Import.
- Does not touch batch-level filename dedupe (2, above) — orthogonal mechanism, same "advise then let user act" pattern.

### 3. Import history view

- New page listing all batches (undone included, marked) — filename, date/time, account, `importedCount`, `skippedDuplicates` (decision 8). Most-rece
  nt-first.
- Paginated (or capped with "load more") — do not assume unbounded list renders fine; batches accumulate every import, indefinitely, for a single lon
  g-lived user.
- Selecting a batch shows/filters its transactions. For an undone batch, this shows zero transactions (deleted) — must not error/404; show an explici
  t "transactions removed by undo" state instead.
- Empty state. Read-only for this pass.

### 4. Transaction display of import batch

- Transaction list/detail shows batch filename (not raw id) when `importBatchId` set.
- No indicator for manually-entered transactions.
- Requires extending `lib/services/transactions.ts` to select/return batch info (not done today).
- Batch indicator links to history entry.

### 5. Undo import

- From history view, undo any active batch.
- Deletes every transaction with matching `importBatchId` — whole batch, no partial undo.
- Type-filename-to-confirm modal (decision 11): warning states count of transactions to be deleted and explicitly warns that edits made since import —
  recategorized, retyped income/expense, or skipped — will be lost (decision 6); delete only fires once user retypes the batch filename correctly.
- Implemented as one `prisma.$transaction`: delete transactions with matching `importBatchId`, flip batch status to undone. Not a bare FK cascade (de
  cision 9).
- After undo, filename becomes reusable — new commit with same name treated as fresh independent batch.
- No budget/summary recomputation needed (computed on read).
- Idempotent: undo on already-undone/nonexistent batch → clear error/no-op, not crash.
- **Known gap:** manually-edited transactions silently lost on undo (no `updatedAt`/edit tracking exists to warn about this) — surfaced via the confi
  rmation copy above, not solved.

## Non-Goals (this pass)

- Storing/re-downloading raw uploaded file.
- Raw-file-byte hashing.
- Partial/row-level undo within a batch.
- Recovering silently-skipped duplicate rows.
- Detecting manual edits post-import (blocked on schema gap, flagged above).
- General audit log beyond import batches.
- Non-CSV import formats.
- Async/background import processing.
- Multi-file batch upload in one action.
- Concurrency controls beyond existing commit-time re-check + idempotent undo (single-user app).

## Checklist

- [x] User decisions on open questions
- [x] product-manager + software-architect review pass (findings folded into decisions above)
- [x] software-architect: full schema (`ImportBatch` model), service/validator contracts, route design
- [x] software-architect: story 2a amendment (row-level duplicate override) folded into the Architecture section
- [ ] ui-designer: history view (pagination, undone-batch state), type-to-confirm undo modal, transaction batch indicator, 409-override flow
- [ ] senior-developer: implementation + tests (incl. migration backfill)
- [ ] tester: review, edge cases

---

## Architecture

Designed against the locked decisions above. Where this section adds something the
decisions did not specify, it is marked **[architect addition — flagged, not assumed]**.

### 0. Cross-cutting invariants

- Request flow stays `route handler → Zod validator → service → prisma singleton`.
  No business logic in handlers; handlers only auth-gate, parse, map typed service
  errors to status codes.
- Every Prisma query in the new service scopes by `userId` (single-user app, but the
  scoping is the ownership check — there is no separate permission step).
- Services return plain serializable objects (`FrontendImportBatch`), never Prisma
  models. `Decimal`/`Date` are converted at the service boundary (`.toISOString()`,
  `Number(...).toFixed(2)`) exactly as `lib/services/transactions.ts` does.
- Exported functions are arrow functions with explicit return types.

---

### 1. Schema

**Authorization:** decision 9 explicitly authorizes this schema change. Scope is
limited to: one new enum, one new model, one relation field on `Transaction`.
Nothing else in `prisma/schema.prisma` is touched.

#### 1.1 New enum

```prisma
enum ImportBatchStatus {
  ACTIVE
  UNDONE
}
```

**[architect addition — flagged, not assumed]** Decision 4 says batches are "marked
undone"; it does not name the mechanism. A two-value enum (matching the repo's
existing UPPER_SNAKE enum convention in `AccountType` / `TransactionType`) is chosen
over a nullable `undoneAt` alone so the status is queryable and index-friendly for
the per-account active-filename check.

#### 1.2 New model

```prisma
/// one CSV commit; groups the transactions it created so the whole import can be
/// listed in history and undone as a unit. `filenameNormalized` is the lowercased,
/// trimmed `filename` and is what duplicate-import detection compares on.
model ImportBatch {
  id                 String            @id @default(cuid())
  userId             String
  accountId          String
  filename           String
  filenameNormalized String
  status             ImportBatchStatus @default(ACTIVE)
  /// count of rows the client submitted in the commit body (pre-dedupe); used for
  /// the secondary duplicate-import signal, so unrelated dedupe skips don't skew it
  rowCount           Int
  /// rows actually inserted (post row-level dedupe)
  importedCount      Int
  /// rows dropped by row-level dedupe at commit time
  skippedDuplicates  Int
  /// min/max transaction date across the submitted rows; secondary dup signal
  dateFrom           DateTime
  dateTo             DateTime
  createdAt          DateTime          @default(now())
  undoneAt           DateTime?

  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  account      Account       @relation(fields: [accountId], references: [id], onDelete: Cascade)
  transactions Transaction[]

  @@index([userId, accountId, filenameNormalized])
  @@index([userId, createdAt])
}
```

Notes:

- `@@index([userId, accountId, filenameNormalized])` is decision 2 verbatim. No
  native partial-unique constraint — active-only uniqueness is enforced in the
  service layer (`status: 'ACTIVE'` predicate), because Postgres partial unique
  indexes are not expressible in the Prisma schema and decision 2 rules them out.
- `@@index([userId, createdAt])` **[architect addition — flagged, not assumed]**:
  required by story 3's paginated most-recent-first listing.
- `undoneAt DateTime?` **[architect addition — flagged, not assumed]**: history wants
  to show _when_ a batch was undone; inside the authorized schema change, but not in
  the decisions list.
- `account` relation uses `onDelete: Cascade`, consistent with
  `Transaction.account`. Deleting an account removes its transactions today; its
  batch history goes with them.
- `Account` gains `importBatches ImportBatch[]` and `User` gains
  `importBatches ImportBatch[]` back-relations (required by Prisma).

#### 1.3 `Transaction` change

Add only the relation; the `importBatchId String?` column and its
`@@index([importBatchId])` already exist and are kept as-is.

```prisma
model Transaction {
  // ...unchanged fields...
  importBatchId String?

  importBatch ImportBatch? @relation(fields: [importBatchId], references: [id], onDelete: SetNull)
}
```

`onDelete: SetNull` per decision 9. Undo never relies on it — undo is an explicit
`prisma.$transaction`. `SetNull` exists only so a hard batch delete (not a feature
this pass) can't orphan transactions.

#### 1.4 Migration

`npm run prisma:migrate` cannot inject the backfill, so use `--create-only`:

`package.json` defines `prisma:migrate` as `prisma migrate dev`, so the documented
script accepts the extra flag — do not bypass it:

```bash
npm run prisma:migrate -- --name add_import_batch --create-only
# hand-edit the generated migration.sql to the ordering below
npm run prisma:migrate            # applies the edited SQL
npm run prisma:generate
```

Required SQL ordering in
`prisma/migrations/<timestamp>_add_import_batch/migration.sql` — **the `UPDATE` must
precede `ADD CONSTRAINT`** (decision 9: existing `importBatchId` values are orphan
`randomUUID()`s with no matching row and would fail the FK):

```sql
-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('ACTIVE', 'UNDONE');

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filenameNormalized" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "skippedDuplicates" INTEGER NOT NULL,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_userId_accountId_filenameNormalized_idx"
  ON "ImportBatch"("userId", "accountId", "filenameNormalized");
CREATE INDEX "ImportBatch_userId_createdAt_idx" ON "ImportBatch"("userId", "createdAt");

-- Backfill: clear pre-existing orphan batch ids before the FK is enforced
UPDATE "Transaction" SET "importBatchId" = NULL WHERE "importBatchId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

`prisma/seed.ts` was checked: it never writes `importBatchId`, so no seed change is
needed and `npm run db:setup` stays green.

---

### 2. Validators — `lib/validators/csv-import.ts`

The preview schema currently lives inline in `app/api/import/preview/route.ts`
(`rawRowSchema` / `previewSchema`). It now carries `filename` + `accountId` and needs
unit coverage, so **move it into the validator module** to match the documented
route → validator → service flow. The route imports it instead of declaring it.

```ts
// shared
export const importFilenameSchema = z.string().trim().min(1).max(255);

export const rawImportRowSchema = z.object({
  accountId: z.string().min(1),
  date: z.string().min(1),
  amount: z.coerce.number(),
  type: z.enum(['INCOME', 'EXPENSE']),
  payee: z.string().trim().max(120).optional(),
  note: z.string().trim().max(280).optional(),
});

export const previewImportSchema = z.object({
  accountId: z.string().min(1),
  filename: importFilenameSchema,
  rows: z.array(rawImportRowSchema).min(1).max(2000),
});

// existing importRowSchema + `duplicate` (story 2a)
export const importRowSchema = z.object({
  /* ...existing fields unchanged... */
  include: z.boolean().default(true),
  /** client echo of the preview-time duplicate flag; drives the story 2a override */
  duplicate: z.boolean().default(false),
});

export const commitImportSchema = z
  .object({
    accountId: z.string().min(1),
    filename: importFilenameSchema,
    rows: z.array(importRowSchema).min(1).max(2000), // decision 7: cap matches preview
    overrideDuplicateFilename: z.boolean().default(false), // decision 1
  })
  .refine((input) => input.rows.every((r) => r.accountId === input.accountId), {
    message: 'All rows must belong to the selected account',
    path: ['rows'],
  });

export type RawImportRowInput = z.infer<typeof rawImportRowSchema>;
export type PreviewImportInput = z.infer<typeof previewImportSchema>;
export type ImportRowInput = z.infer<typeof importRowSchema>;
export type CommitImportInput = z.infer<typeof commitImportSchema>;
```

Single-account narrowing (decision 10) is done via a top-level `accountId` +
`.refine`, **not** by stripping `accountId` off `importRowSchema`. Rationale: the
client posts `{ rows: preview }` where each preview row already carries `accountId`;
the refine is the smaller diff and keeps `importRowSchema` usable by `previewImport`
output typing. `filename` is stored raw (for display) and normalized (for matching).

`duplicate` is **new on `importRowSchema`** (story 2a). Today the field exists on
`PreviewRow` and is posted back by the client (`components/import/import-view.tsx`
commits `JSON.stringify({ rows: preview })` — verified, the full preview rows go over
the wire verbatim), but Zod strips it because the schema does not declare it, so
`commitImport` cannot tell an overridden duplicate from a stale-preview one. Declaring
it threads it through with **no client change**.

`.default(false)`, not `.optional()`, and the direction is load-bearing: an absent flag
must read as "was not flagged at preview" → stale-preview protection applies → row is
skipped. Defaulting toward "flagged" would turn every malformed or legacy payload into a
silent override of duplicate detection. Fail safe, not fail open.

Consequence for `csvImport.ts` typing: `PreviewRow` becomes
`ImportRowInput & { categoryName: string | null }` — `duplicate` now comes from
`ImportRowInput`. The structural shape of a preview row is unchanged.

`previewImportSchema` deliberately has **no** `.refine`: the top-level `accountId` is
the authoritative value and is the only one passed to `findActiveBatchByFilename`,
while each row's `accountId` is passed through untouched into `duplicateKey` so the
existing row-level dedupe logic is unchanged. (In practice the client sets both from
the same select; commit is where the mismatch is rejected.)

New file `lib/validators/import-batches.ts`:

```ts
export const listImportBatchesQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListImportBatchesQuery = z.infer<typeof listImportBatchesQuerySchema>;
```

`lib/validators/transactions.ts` — `listTransactionsQuerySchema` gains:

```ts
batchId: z.string().optional(),
```

---

### 3. Service contracts

#### 3.1 New — `lib/services/importBatches.ts`

Owns normalization, the duplicate-filename lookup, history listing, batch detail, and
undo. `normalizeFilename` lives here as the single exported helper (decision 3) and is
imported by `csvImport.ts` for both the preview check and the commit check — one
implementation, used at preview-check, commit-check, and storage.

```ts
export type FrontendImportBatch = {
  id: string;
  filename: string;
  accountId: string;
  accountName: string;
  status: 'ACTIVE' | 'UNDONE';
  rowCount: number;
  importedCount: number;
  skippedDuplicates: number;
  dateFrom: string;          // ISO
  dateTo: string;            // ISO
  createdAt: string;         // ISO
  undoneAt: string | null;   // ISO
};

/** decision 3: case-insensitive + trimmed. Single source of truth. */
export const normalizeFilename = (filename: string): string =>
  filename.trim().toLowerCase();

/**
 * Active batch on this account whose normalized filename matches, or null.
 * Used advisory-only at preview and as the 409 gate at commit.
 */
export const findActiveBatchByFilename = async (
  userId: string,
  accountId: string,
  filename: string,
): Promise<FrontendImportBatch | null>;

/** Most-recent-first, cursor-paginated. Includes UNDONE batches (story 3). */
export const listImportBatches = async (
  userId: string,
  query: ListImportBatchesQuery,
): Promise<{ batches: FrontendImportBatch[]; nextCursor: string | null }>;

/** Throws ServiceValidationError('Import batch not found') if missing/not owned. */
export const getImportBatch = async (
  userId: string,
  batchId: string,
): Promise<FrontendImportBatch>;

/**
 * Deletes every transaction with this importBatchId and flips the batch to UNDONE,
 * in one prisma.$transaction (decision 9 — never a bare FK cascade).
 * Throws ServiceValidationError  -> not found / not owned (route: 404)
 * Throws BatchAlreadyUndoneError -> already UNDONE (route: 409, idempotent no-op)
 */
export const undoImportBatch = async (
  userId: string,
  batchId: string,
): Promise<{ batch: FrontendImportBatch; deletedTransactions: number }>;
```

Implementation constraints:

- **Shared `include` + mapper.** `accountName` is on `FrontendImportBatch` and all four
  functions produce it, so `lib/services/importBatches.ts` declares a module-level
  `const include = { account: { select: { name: true } } } as const;` and a single
  private `toFrontendImportBatch(batch): FrontendImportBatch` mapper — mirroring the
  `include` / `toFrontend` pattern already in `lib/services/transactions.ts`. Every
  one of `findActiveBatchByFilename`, `listImportBatches`, `getImportBatch`, and
  `undoImportBatch` uses both; none hand-rolls its own select or mapping. The mapper
  owns the `Date -> ISO string` conversions (`dateFrom`, `dateTo`, `createdAt`,
  `undoneAt ?? null`).
- `findActiveBatchByFilename` query:
  `where: { userId, accountId, filenameNormalized: normalizeFilename(filename), status: 'ACTIVE' }`,
  `orderBy: { createdAt: 'desc' }`, `findFirst`. (`findFirst`, not `findUnique` —
  there is no unique constraint; multiple UNDONE rows with the same name are legal
  per decision 4, and an override can create a second ACTIVE one per decision 1.)
- `listImportBatches`: `where: { userId }`,
  `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`, `take: limit + 1`, and when
  `cursor` present `cursor: { id: cursor }, skip: 1`. If `limit + 1` rows came back,
  drop the extra and return its id as `nextCursor`; else `nextCursor: null`.
  **Cursor pagination is the precedent-setting choice** (no pagination exists
  anywhere in the repo): stable under concurrent inserts and index-aligned with
  `@@index([userId, createdAt])`.
- `getImportBatch` / `undoImportBatch` use `findFirst({ where: { id, userId } })` —
  the `userId` in the `where` is the ownership check.
- `undoImportBatch` body:
  ```ts
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.transaction.deleteMany({
      where: { userId, importBatchId: batchId },
    });
    const batch = await tx.importBatch.update({
      where: { id: batchId },
      data: { status: 'UNDONE', undoneAt: new Date() },
      include: { account: { select: { name: true } } },
    });
    return { batch, count };
  });
  ```
  Read-and-guard happens before the transaction; re-checking status inside is
  unnecessary for a single-user app (non-goal: concurrency controls).

#### 3.2 New typed errors — `lib/services/common.ts`

`ServiceValidationError` maps to 400/404 everywhere today, so 409 needs distinct
types. Both carry the payload the UI must render.

```ts
export class DuplicateFilenameError extends Error {
  constructor(
    message: string,
    public readonly batch: FrontendImportBatch,
  ) {
    super(message);
    this.name = 'DuplicateFilenameError';
  }
}

export class BatchAlreadyUndoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchAlreadyUndoneError';
  }
}
```

To avoid `common.ts` importing from a service, type the `batch` field as a structural
type declared in `common.ts` (or import the type only, `import type`). Prefer
`import type { FrontendImportBatch } from '@/lib/services/importBatches'` — type-only,
no runtime cycle.

#### 3.3 Changed — `lib/services/csvImport.ts`

`previewImport` return shape changes (breaking — see file list):

```ts
export type FilenameWarning = {
  batch: FrontendImportBatch;   // the matched active batch (filename, createdAt, rowCount, dateFrom/dateTo)
  submittedRowCount: number;    // this file's submitted row count
  rowCountMatches: boolean;     // submittedRowCount === batch.rowCount (decision 5)
  dateRangeMatches: boolean;    // submitted min/max dates equal batch.dateFrom/dateTo
};

export type PreviewResult = {
  rows: PreviewRow[];           // unchanged element shape
  filenameWarning: FilenameWarning | null;
};

export const previewImport = async (
  userId: string,
  input: PreviewImportInput,
): Promise<PreviewResult>;
```

- Signature changes from `(userId, rawRows)` to `(userId, input)` because preview now
  needs `filename` + `accountId`.
- Row-level duplicate logic and `duplicateKey` are **unchanged**; the filename warning
  is computed independently and never auto-excludes rows (story 2: advisory only).
- Warning is produced by calling `findActiveBatchByFilename`. If null →
  `filenameWarning: null`.

`commitImport`:

```ts
export const commitImport = async (
  userId: string,
  input: CommitImportInput,
): Promise<{ batchId: string | null; imported: number; skippedDuplicates: number }>;
// batchId is null on the zero-row path (step 4) — no batch is created.
```

**Order of operations is normative** — the filename check runs _before_ dedupe and
_before_ the zero-row early return, otherwise re-importing an identical file (every
row a row-level duplicate) would return 201/`imported: 0` and never surface the 409:

1. Validate account ownership: `prisma.account.findFirst({ where: { id: input.accountId, userId } })`
   → `ServiceValidationError('Account not found')` if missing. (Replaces today's
   multi-account `findMany` length check; the refine guarantees rows match.)
2. **Filename check.** `const conflict = await findActiveBatchByFilename(userId, input.accountId, input.filename)`.
   If `conflict && !input.overrideDuplicateFilename` → `throw new DuplicateFilenameError(...)`.
   Override proceeds and creates a new independent batch (decision 1) — no merge,
   no mutation of the prior batch.
3. Row-level dedupe, **amended by story 2a**. `requested = input.rows.filter(r => r.include)`.
   For each requested row, the client-echoed `row.duplicate` decides which branch applies:

   ```ts
   const rowsToImport = requested.filter((row) => {
     const key = duplicateKey(row);
     if (row.duplicate) {
       // flagged at preview AND still included => explicit user override.
       // Import it: checked against neither existingKeys nor seenInBatch.
       seenInBatch.add(key); // so a later NON-flagged row with this key still dedupes
       return true;
     }
     // not flagged at preview but matches now => stale preview / double submit.
     // Unchanged protection.
     if (existingKeys.has(key) || seenInBatch.has(key)) return false;
     seenInBatch.add(key);
     return true;
   });
   ```

   Adding an overridden row's key to `seenInBatch` is defensive: preview flags in file
   order, so within one honest preview a non-flagged row cannot follow a same-key flagged
   row. It matters only for hand-built or stale payloads.

   `skippedDuplicates = requested.length - rowsToImport.length` — the **arithmetic** is
   unchanged, but the **population** narrows: it now counts only stale-preview drops, not
   user-acknowledged overrides. Since this value is persisted on `ImportBatch` and shown in
   history (decision 8), that is the intended meaning — "rows the server silently skipped",
   which is exactly the number a user could otherwise not account for.

4. If `rowsToImport.length === 0` → return `{ batchId: null-equivalent, imported: 0, skippedDuplicates }`.
   **No batch is created, no filename reserved** (story 1). Make the return type
   `{ batchId: string | null; imported: number; skippedDuplicates: number }`.
5. Create batch + rows atomically:
   ```ts
   await prisma.$transaction(async (tx) => {
     const batch = await tx.importBatch.create({ data: { userId, accountId: input.accountId,
       filename: input.filename, filenameNormalized: normalizeFilename(input.filename),
       rowCount, importedCount: rowsToImport.length, skippedDuplicates, dateFrom, dateTo } });
     await tx.transaction.createMany({ data: rowsToImport.map(r => ({ ..., importBatchId: batch.id })) });
     return batch;
   });
   ```
   Batch must be created first (the transactions' FK requires it to exist). A
   non-transactional two-step would either orphan a batch that reserves a filename or
   violate the FK.
6. `randomUUID` import is removed from this file — batch ids are now cuids from Prisma.

Metric definitions (pinning decision 5):

- `rowCount = input.rows.length` — **submitted** rows, including `include: false` and
  rows later dropped by dedupe. This is what decision 5's "avoid false positives from
  unrelated dedupe skips" requires.
- `dateFrom` / `dateTo` = min / max `row.date` over **the same set** (`input.rows`),
  so the preview comparison is like-for-like.
- `importedCount` = actually inserted count, including story 2a overrides.
  `skippedDuplicates` = same formula, narrowed population (step 3): stale-preview drops
  only. Overridden duplicates count toward `importedCount`, never `skippedDuplicates`.

---

### 4. Routes

| Method | Path                            | Purpose                                                                      |
| ------ | ------------------------------- | ---------------------------------------------------------------------------- |
| POST   | `/api/import/preview`           | changed: takes `accountId` + `filename`, returns `{ rows, filenameWarning }` |
| POST   | `/api/import/commit`            | changed: 409 on filename conflict                                            |
| GET    | `/api/import/batches`           | new: paginated history                                                       |
| GET    | `/api/import/batches/[id]`      | new: batch detail                                                            |
| POST   | `/api/import/batches/[id]/undo` | new: undo                                                                    |

All routes start with the existing `getServerAuthSession()` guard → 401.

**`POST /api/import/preview`** — request
`{ accountId: string, filename: string, rows: RawImportRow[] }` (1–2000).
`400` on Zod failure (`parsed.error.flatten()`), `200` with
`{ rows: PreviewRow[], filenameWarning: FilenameWarning | null }`.

**`POST /api/import/commit`** — request
`{ accountId, filename, rows: ImportRow[], overrideDuplicateFilename?: boolean }`, where
each `ImportRow` carries both `include` and `duplicate` (the echoed preview flag, story
2a). The two override mechanisms are orthogonal and compose without collision:
`overrideDuplicateFilename` is a single batch-level boolean gating the 409; `duplicate` is
per-row and gates nothing — it only tells the service which rows the user knowingly
included. No shared name, no shared code path, no ordering dependency (the filename gate
in step 2 runs before row dedupe in step 3 either way).

They do **stack**, intentionally. Re-importing `march.csv` into the same account: every
row previews as `duplicate: true`, the user checks the boxes, the commit returns 409, the
user clicks "Import anyway" → `overrideDuplicateFilename: true` clears the batch gate and
each row's `duplicate: true` clears row dedupe, so the whole file imports again as a new
independent batch. That is the intended outcome, not a hole: it requires two distinct
deliberate actions (per-row checkboxes, then a named-batch confirmation), which is the
double opt-in the two stories together are meant to demand.

- `400` Zod failure or `ServiceValidationError` (invalid account).
- `409` `DuplicateFilenameError`, body:
  ```json
  {
    "code": "DUPLICATE_FILENAME",
    "error": "\"march.csv\" was already imported into this account on 2026-08-14.",
    "batch": {
      "id": "...",
      "filename": "march.csv",
      "createdAt": "...",
      "rowCount": 120,
      "importedCount": 118,
      "dateFrom": "...",
      "dateTo": "..."
    }
  }
  ```
  The `code` discriminator is what lets the client replace the blanket
  "Import failed." with the named-batch actionable error and offer the
  `overrideDuplicateFilename: true` resubmit (decision 1).
- `201` `{ batchId: string | null, imported: number, skippedDuplicates: number }`.

**`GET /api/import/batches?cursor=&limit=`** — `400` on bad query, `200`
`{ batches: FrontendImportBatch[], nextCursor: string | null }`.

**`GET /api/import/batches/[id]`** — `404` on `ServiceValidationError`, `200`
`FrontendImportBatch`. Params typed `{ params: Promise<{ id: string }> }`, awaited,
matching `app/api/transactions/[id]/route.ts`.

**`POST /api/import/batches/[id]/undo`** — POST, not DELETE: the batch survives undo
(decision 4), only its transactions are removed, so this is a state transition, not a
resource deletion. No request body.

- `404` `ServiceValidationError` — not found / not owned.
- `409` `BatchAlreadyUndoneError` — `{ code: 'ALREADY_UNDONE', error: '...' }`
  (story 5's "clear error, not crash").
- `200` `{ batch: FrontendImportBatch, deletedTransactions: number }`.

The type-filename-to-confirm gate (decision 11) is **client-side only**; the API takes
no confirmation token. Rationale: single-user app, the modal is a UX guard against
misclicks, not an authorization boundary.

---

### 5. `lib/services/transactions.ts` extension (stories 3 + 4)

- `FrontendTransaction` gains:
  ```ts
  importBatchId: string | null;
  importBatchFilename: string | null; // null when manually entered
  ```
- The shared `include` const gains `importBatch: { select: { id: true, filename: true } }`.
- `toFrontend` maps `importBatchId: tx.importBatchId`,
  `importBatchFilename: tx.importBatch?.filename ?? null`, and its parameter type
  gains `importBatchId: string | null; importBatch: { id: string; filename: string } | null`.
  Raw batch id is still returned (the UI links to the history entry) but the **display**
  value is the filename (story 4).
- `listTransactions` `where` gains `importBatchId: query.batchId` — undefined when
  absent, so existing behavior is unchanged:
  ```ts
  where: { userId, accountId: query.accountId, categoryId: query.categoryId,
           importBatchId: query.batchId, date: { gte: query.from, lte: query.to } }
  ```
- **`app/api/transactions/route.ts` GET enumerates search params one by one**, so it
  also needs `batchId: url.searchParams.get('batchId') ?? undefined` added to the
  `safeParse` object — adding it to the schema and service alone is not enough.
- Batch detail view uses `listTransactions(userId, { batchId })`. For an UNDONE batch
  this legitimately returns `[]` — the page must render the explicit "transactions
  removed by undo" state driven by `batch.status === 'UNDONE'`, never a 404
  (story 3).

---

### 6. File-by-file breakdown

**Schema / migration**

- `prisma/schema.prisma` — _(modify)_ add `ImportBatchStatus` enum, `ImportBatch`
  model, `Transaction.importBatch` relation, `User.importBatches` and
  `Account.importBatches` back-relations.
- `prisma/migrations/<ts>_add_import_batch/migration.sql` — _(new, `--create-only` + hand-edited)_
  enum + table + indexes, `UPDATE ... SET "importBatchId" = NULL`, then FKs.

**Validators**

- `lib/validators/csv-import.ts` — _(modify)_ add `importFilenameSchema`,
  `rawImportRowSchema`, `previewImportSchema`; add `duplicate: z.boolean().default(false)`
  to `importRowSchema` (story 2a); extend `commitImportSchema` with `accountId`,
  `filename`, `overrideDuplicateFilename`, `.max(2000)`, and the single-account `.refine`.
- `lib/validators/import-batches.ts` — _(new)_ `listImportBatchesQuerySchema`.
- `lib/validators/transactions.ts` — _(modify)_ `batchId` on `listTransactionsQuerySchema`.

**Services**

- `lib/services/importBatches.ts` — _(new)_ `normalizeFilename`,
  `findActiveBatchByFilename`, `listImportBatches`, `getImportBatch`,
  `undoImportBatch`, `FrontendImportBatch`.
- `lib/services/csvImport.ts` — _(modify)_ preview takes `PreviewImportInput` and
  returns `PreviewResult`; commit gains the filename gate, the story 2a override branch in
  the dedupe filter, batch creation inside `$transaction`, returns `batchId`; drop
  `randomUUID`. `PreviewRow` drops its now-redundant `duplicate` intersection member.
- `lib/services/common.ts` — _(modify)_ add `DuplicateFilenameError`,
  `BatchAlreadyUndoneError`.
- `lib/services/transactions.ts` — _(modify)_ batch fields on `FrontendTransaction`,
  `include`, `toFrontend`, and the `batchId` filter.

**Routes**

- `app/api/import/preview/route.ts` — _(modify)_ import `previewImportSchema` from the
  validator module (delete the inline schemas), pass `parsed.data` to the service.
- `app/api/import/commit/route.ts` — _(modify)_ catch `DuplicateFilenameError` → 409
  with `code: 'DUPLICATE_FILENAME'` + batch payload.
- `app/api/import/batches/route.ts` — _(new)_ GET list, cursor pagination.
- `app/api/import/batches/[id]/route.ts` — _(new)_ GET detail, 404 on not found.
- `app/api/import/batches/[id]/undo/route.ts` — _(new)_ POST undo, 404 / 409 / 200.
- `app/api/transactions/route.ts` — _(modify)_ read `batchId` search param.

**Pages / components** (shapes only — `ui-designer` owns the visual spec)

- `app/(protected)/import/history/page.tsx` — _(new)_ server component; calls
  `listImportBatches(userId, { limit: 25 })`, renders the history list + empty state.
- `app/(protected)/import/history/[id]/page.tsx` — _(new)_ server component; calls
  `getImportBatch` + `listTransactions(userId, { batchId })`; renders the
  undone-batch state when `status === 'UNDONE'`.
- `components/import/import-history.tsx` — _(new)_ client component: load-more via
  `nextCursor`, undo trigger.
- `components/import/undo-batch-modal.tsx` — _(new)_ client component: type-filename-
  to-confirm; copy must state the transaction count **and** explicitly warn that edits
  made since import — recategorized, retyped, or skipped — will be lost (decisions 6 + 11).
- `components/import/import-view.tsx` — _(modify)_ send `accountId` + `filename` on
  preview and commit; consume `{ rows, filenameWarning }` (was a bare array); render
  the filename warning distinctly from row-level dup flags; handle the 409 by showing
  the named-batch error and a "Import anyway" action that resubmits with
  `overrideDuplicateFilename: true`. **Story 2a needs no change here** — the commit body is
  already `{ rows: preview }` (full rows, `duplicate` included) and the per-row checkbox is
  already the override control; keep the "possible duplicate" row marking so the user can
  see what checking the box overrides.
- `components/transactions/transactions-view.tsx` — _(modify)_ render
  `importBatchFilename` on the row (and detail/edit affordance) as a link to
  `/import/history/{importBatchId}`; render nothing when null (story 4: no
  manually-entered indicator). `period-picker.tsx` and `transaction-form.tsx` are
  unaffected.
- `components/nav/sidebar.tsx` — _(modify)_ **[architect addition — flagged, not assumed]**
  the sidebar has no `/import` entry at all today (the page is reachable only by URL).
  Add `{ href: '/import', label: 'Import' }`; history is reached from the import page,
  and the existing `pathname.startsWith` logic keeps `/import/history` highlighted.

**Tests** (`senior-developer` writes; `tester` extends)

- `tests/unit/services/csvImport.test.ts` — _(modify)_ every existing assertion
  indexing `result[0]` must become `result.rows[0]`; the hoisted `prismaMock` needs
  `importBatch: { findFirst, create }` and a `$transaction` mock that invokes its
  callback with a tx-shaped mock. New cases: 409 path, filename-override path, zero-row
  commit creates no batch, `rowCount` vs `importedCount` vs `skippedDuplicates`. Story 2a
  needs two discriminating cases that must not be collapsed into one:
  `{ include: true, duplicate: true }` with a matching DB key → **imported** (override),
  and `{ include: true, duplicate: false }` with a matching DB key → **skipped**
  (stale-preview protection intact). Plus: `duplicate` absent from the payload defaults to
  `false` and therefore skips.
- `tests/unit/services/importBatches.test.ts` — _(new)_ `normalizeFilename`
  (case/whitespace), active-only + per-account scoping of the filename lookup,
  cursor pagination incl. `nextCursor: null` on the last page, undo happy path,
  undo on already-undone → `BatchAlreadyUndoneError`, undo on unowned id → not found.
- `tests/unit/services/transactions.test.ts` — _(modify)_ `batchId` filter reaches the
  `where`; `importBatchFilename` mapping incl. the null case.

---

### 7. Key tradeoffs

- **Service-layer filename uniqueness vs. DB partial unique index.** Decision 2 locks
  the service-layer approach. Cost: a TOCTOU window between check and insert. Accepted
  — single-user app, concurrency controls are an explicit non-goal, and the commit-time
  re-check already mirrors the row-level dedupe pattern.
- **Denormalized `rowCount` / `dateFrom` / `dateTo` on the batch vs. deriving from
  transactions.** Denormalized wins: derived values would be destroyed by undo, and
  decision 5's warning must still work against an undone batch's history entry.
- **Cursor vs. offset pagination.** Cursor chosen; index-aligned and stable, and it
  sets a single precedent for the repo.
- **POST `/undo` vs. DELETE `/batches/[id]`.** POST, because the batch is retained and
  flipped, not deleted (decision 4).
- **Client-echoed `duplicate` flag vs. a server-side preview token (story 2a).** Echoing
  the flag wins: zero schema change, zero client change, and the preview→commit round trip
  already carries the rows. A signed/persisted preview snapshot would make override
  intent server-verifiable and preserve exact double-submit protection, but costs a new
  table or cache plus an expiry policy — disproportionate for a single-user app whose
  concurrency controls are an explicit non-goal.
- **`previewImport` breaking signature change vs. an additive second endpoint.** The
  breaking change wins: one round-trip, one place where filename normalization is
  applied, and the only consumers are one component and one test file.

### 8. Risks

- The `previewImport` return-shape change silently breaks `import-view.tsx` at runtime
  if the component isn't updated in the same change — TypeScript catches it only
  because the component types the fetch response manually; it is `await res.json()`,
  so **there is no compile-time error**. Update both together.
- The migration's `UPDATE` is irreversible for anyone who had meaningful
  `importBatchId` values. Decision 9 confirms none exist repo-wide.
- Undo deletes transactions with no recovery path, including manual edits made since
  import (decision 6). The type-to-confirm modal is the only guard.
- **Story 2a narrows double-submit protection, by design.** A resubmitted identical commit
  body re-imports every `duplicate: true, include: true` row, because a client-echoed
  boolean cannot distinguish "user wants this row anyway" from "the browser resent the
  request". Non-overridden rows keep full protection. Accepted, with a named mitigation:
  the batch-level filename 409 (decision 1) rejects the second submit of the same file on
  the same account before dedupe ever runs — the two mechanisms interlock, which is why
  the filename gate is normatively ordered _before_ step 3.
- The story 2a fix is invisible if `duplicate` is not declared on `importRowSchema`: Zod
  strips undeclared keys, every row would default to `duplicate: false`, and overrides
  would keep being silently dropped with no error anywhere. The validator change and the
  service change must land together.

### 9. Implementation checklist (senior-developer)

- [ ] `prisma/schema.prisma`: `ImportBatchStatus` enum, `ImportBatch` model, `Transaction.importBatch` relation, `User`/`Account` back-relations
- [ ] Migration via `npm run prisma:migrate -- --name add_import_batch --create-only`; hand-edit so `UPDATE "Transaction" SET "importBatchId" = NULL`
      precedes the FKs; apply; `npm run prisma:generate`
- [ ] `lib/validators/csv-import.ts`: `importFilenameSchema`, `rawImportRowSchema`, `previewImportSchema`, `duplicate: z.boolean().default(false)` on
      `importRowSchema` (story 2a), extended `commitImportSchema` (+ single-account refine, 2000 cap, `overrideDuplicateFilename`)
- [ ] `lib/validators/import-batches.ts`: `listImportBatchesQuerySchema`
- [ ] `lib/validators/transactions.ts`: `batchId` on the list query
- [ ] `lib/services/common.ts`: `DuplicateFilenameError`, `BatchAlreadyUndoneError`
- [ ] `lib/services/importBatches.ts`: `normalizeFilename`, `findActiveBatchByFilename`, `listImportBatches`, `getImportBatch`, `undoImportBatch`
- [ ] `lib/services/csvImport.ts`: new preview signature/return, commit filename gate, story 2a override branch in the dedupe filter (`duplicate:true
` bypasses both key checks, still seeds `seenInBatch`), atomic batch+rows `$transaction`, drop `randomUUID`
- [ ] `lib/services/transactions.ts`: batch fields + `batchId` filter
- [ ] Routes: preview, commit (409), `GET /api/import/batches`, `GET /api/import/batches/[id]`, `POST /api/import/batches/[id]/undo`, `batchId` param
      in `app/api/transactions/route.ts`
- [ ] UI: `import-view.tsx` (filename/accountId, warning, 409 override), history list + detail pages, undo modal, transaction batch indicator, sideba
      r `/import` link
- [ ] Tests: update `csvImport.test.ts` (`result.rows`, `$transaction` mock, both story 2a override/stale-preview cases), new `importBatches.test.ts`
      , extend `transactions.test.ts`
- [ ] `npm run format:fix && npm run lint && npm run test`
