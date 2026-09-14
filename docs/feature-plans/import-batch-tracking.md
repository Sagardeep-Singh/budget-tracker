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
- [x] ui-designer: history view (pagination, undone-batch state), type-to-confirm undo modal, transaction batch indicator, 409-override flow
- [x] senior-developer: implementation + tests (incl. migration backfill)
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

- [x] `prisma/schema.prisma`: `ImportBatchStatus` enum, `ImportBatch` model, `Transaction.importBatch` relation, `User`/`Account` back-relations
- [x] Migration via `npm run prisma:migrate -- --name add_import_batch --create-only`; hand-edit so `UPDATE "Transaction" SET "importBatchId" = NULL`
      precedes the FKs; apply; `npm run prisma:generate`
- [x] `lib/validators/csv-import.ts`: `importFilenameSchema`, `rawImportRowSchema`, `previewImportSchema`, `duplicate: z.boolean().default(false)` on
      `importRowSchema` (story 2a), extended `commitImportSchema` (+ single-account refine, 2000 cap, `overrideDuplicateFilename`)
- [x] `lib/validators/import-batches.ts`: `listImportBatchesQuerySchema`
- [x] `lib/validators/transactions.ts`: `batchId` on the list query
- [x] `lib/services/common.ts`: `DuplicateFilenameError`, `BatchAlreadyUndoneError`
- [x] `lib/services/importBatches.ts`: `normalizeFilename`, `findActiveBatchByFilename`, `listImportBatches`, `getImportBatch`, `undoImportBatch`
- [x] `lib/services/csvImport.ts`: new preview signature/return, commit filename gate, story 2a override branch in the dedupe filter (`duplicate:true
` bypasses both key checks, still seeds `seenInBatch`), atomic batch+rows `$transaction`, drop `randomUUID`
- [x] `lib/services/transactions.ts`: batch fields + `batchId` filter
- [x] Routes: preview, commit (409), `GET /api/import/batches`, `GET /api/import/batches/[id]`, `POST /api/import/batches/[id]/undo`, `batchId` param
      in `app/api/transactions/route.ts`
- [x] UI: `import-view.tsx` (filename/accountId, warning, 409 override), history list + detail pages, undo modal, transaction batch indicator, sideba
      r `/import` link
- [x] Tests: update `csvImport.test.ts` (`result.rows`, `$transaction` mock, both story 2a override/stale-preview cases), new `importBatches.test.ts`
      , extend `transactions.test.ts`
- [x] `npm run format:fix && npm run lint && npm run test`

---

## UI Design

Covers the last unchecked checklist item. Schema/validators/services/routes above are
locked — not redesigned here. Token/component reuse only; no new visual primitives
unless explicitly called out below.

### 0. Token pin

The palette actually in `app/globals.css` (not `--teal`/`--moss`/`--brick` — those
names don't exist in this repo):

- `--iris` / `bg-iris` / `text-iris` — primary accent, links, active nav, primary buttons.
- `--sky` / `text-sky` / `bg-sky-soft` — income / positive / informational-advisory tone.
- `--rose` / `text-rose` / `bg-rose-soft` — expense / destructive / blocking-error tone.
- `--line` / `border-line` — hairline borders (all cards, row dividers).
- `--ink` / `--ink-muted` — primary / secondary text.
- `--paper-raised` / `--paper-sunk` — card surface / recessed surface.
- `font-money` — monetary figures only (`<Money>` internal), never counts.
- `font-mono tabular-nums` — counts, ids, dates (the `rules-view.tsx` "Applied" column
  pattern) — use for `rowCount`/`importedCount`/`skippedDuplicates`, never `<Money>`.

No new CSS variables. New components compose `Card`, `Button`, `Modal`, `Input`,
`Label`, `Select`, `Money`, `ConfirmDialog`'s layout idiom (but not the component
itself — see 3).

---

### 1. History list — `/import/history`

**Files:** `app/(protected)/import/history/page.tsx` (server) renders
`components/import/import-history.tsx` (client), passing the first page
(`listImportBatches(userId, { limit: 25 })`) as `initialBatches` + `initialNextCursor`.

**Row layout** (`Card className="p-0"`, same shell as `categories-view.tsx`'s list,
header row like `rules-view.tsx`):

```
[filename + status pill]              [account]   [imported/skipped]   [date]   [chevron→]
```

- Header row (uppercase 11px tracked labels, `border-line border-b`, matching
  `rules-view.tsx:130-135`): `Filename`, `Account`, `Imported`, `Date`, blank action column.
- Each row is a plain `ledger-row` div; the filename text is a `Link` to
  `/import/history/{batch.id}`, the trailing "Undo" action is a separate sibling
  `Button` in its own cell — see the Undo action note below for why the row itself is
  not a `Link`.
- **Filename cell:** `text-ink text-sm font-medium truncate` + status pill inline:
  - `ACTIVE`: no pill (default state, unmarked — matches "no indicator for the common
    case" precedent from story 4's manual-transaction rule).
  - `UNDONE`: pill `border-line text-ink-muted rounded-full border px-2.5 py-1 text-[12.5px]`
    reading `Undone {relativeOrShortDate(undoneAt)}` — same visual family as the
    category chip in `transactions-view.tsx:290-298`, **not** `--rose`. Undone is a
    completed, intentional state, not an error.
- **Account cell:** `accountName`, `text-ink-muted text-sm`.
- **Imported/skipped cell:** `font-mono tabular-nums text-[13px]` — `"{importedCount} imported"`,
  and if `skippedDuplicates > 0` a second muted line `"{skippedDuplicates} skipped"`.
  Never `<Money>` (these are counts, not currency).
- **Date cell:** `formatDate(createdAt)` (reuse `lib/format.ts`'s `formatDate`, already
  imported in `transactions-view.tsx`), `text-ink-muted font-mono text-xs`.
- Trailing chevron (`ChevronRight` from `lucide-react`, `text-ink-muted`) next to the
  filename `Link`, purely decorative affordance that the filename is clickable.

**Undo action:** rendered only for `status === 'ACTIVE'` rows, as a secondary
`Button variant="ghost"` with `Trash2` icon, labeled "Undo", in its own trailing cell.
**Decision: the row itself is not a `Link`** — only the filename text is the `Link`
(`<Link href=".../{id}" className="hover:text-iris">{filename}</Link>`), and the
"Undo" `Button` is a plain sibling inside the same `ledger-row` div. This sidesteps
the nested-interactive-element problem entirely (no `stopPropagation()` needed, no
`<a>` wrapping a `<button>`) and matches `rules-view.tsx`'s existing per-row
delete-button pattern exactly (filename ~ match text, action ~ delete button).
Clicking "Undo" opens `UndoBatchModal` (section 3) for that batch.

**Empty state** (zero batches ever): follows `rules-view.tsx`'s dashed-border empty
card exactly:

```tsx
<div className="border-line bg-paper-raised flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center">
  <p className="text-ink-muted text-sm">No imports yet.</p>
  <Link href="/import" className="...same Button-as-Link primary pill as rules-view...">
    <Upload size={16} /> Import a CSV
  </Link>
</div>
```

**Pagination — "Load more", not page links** (cursor-based, matches decision 3's
cursor choice):

- `import-history.tsx` state: `batches: FrontendImportBatch[]`, `nextCursor: string | null`,
  `loadingMore: boolean`, `loadError: string | null`.
- When `nextCursor !== null`, render a centered `Button variant="secondary" loading={loadingMore}`
  labeled "Load more" below the list, `onClick` fetches
  `/api/import/batches?cursor={nextCursor}&limit=25`, appends to `batches`, updates
  `nextCursor`.
- On fetch failure: `loadError` shown as inline `text-rose text-sm` beneath the button;
  button stays visible and re-clickable (retry-in-place, no dead end).
- When `nextCursor === null`, the button unmounts — this drops focus if it was
  focused. **Accessibility fix:** on successful load-more, move focus to the first
  newly-appended row's filename link (`ref` + `.focus()` in the fetch-then callback) —
  this keeps keyboard users oriented at the new content instead of on a vanished button.

---

### 2. Batch detail — `/import/history/[id]`

**Files:** `app/(protected)/import/history/[id]/page.tsx` (server): calls
`getImportBatch(userId, id)` (404 → Next.js `notFound()` on `ServiceValidationError`,
matching existing `[id]` route conventions) and
`listTransactions(userId, { batchId: id })`; passes both to a lightweight presentational
view. **Do not reuse `TransactionsView`** — it owns filters, the add-transaction drawer,
period picker, and running-balance math this page has no use for (story 3 is read-only).

**Header (Card):**

- Filename as page title (`font-display text-lg font-semibold`), status pill next to
  it (same pill as list row — `--line`/`--ink-muted` for UNDONE, none for ACTIVE).
- Metadata row, `text-ink-muted text-sm`, `font-mono tabular-nums` for the numbers:
  account name · `{rowCount}` rows submitted · `{importedCount}` imported ·
  `{skippedDuplicates}` skipped · date range (`dateFrom`–`dateTo`) · imported
  `{createdAt}`.
- If `UNDONE`: an additional line, `text-ink-muted`, "Undone {undoneAt}" — no `--rose`.
- "Undo this import" `Button variant="danger"` in the header, rendered only when
  `status === 'ACTIVE'`; opens `UndoBatchModal`.

**Body — transaction list:**

- `ACTIVE` with transactions present: a read-only row list (new, minimal —
  inline in the detail page or a small `components/import/batch-transaction-row.tsx`
  if the row markup exceeds ~15 lines; not required to be a separate file for this
  spec). Each row: payee/category, date, `<Money value={amount} tone={type === 'INCOME' ? 'income' : 'expense'} />`
  — `<Money>` is correct here, these ARE transaction amounts, unlike the batch-level
  counts above. Plain rows, no click/edit affordance (read-only, per story 3).
- `UNDONE` (transactions array is always `[]` here): render the explicit
  **"transactions removed by undo"** panel, not the generic empty state and not an
  error. Visually distinct from an error: dashed `border-line` on `--paper-sunk`,
  `Undo2`-style icon (or reuse `Trash2` muted), copy: _"These transactions were
  removed when this import was undone on {undoneAt}. If they were also
  recategorized, retyped, or skipped before the undo, those edits are gone too."_
  All muted-ink tones — no `--rose`, this is expected, not broken.
- `ACTIVE` with zero transactions (only reachable if `rowCount > 0` but every row was
  a row-level dup at commit, i.e. `importedCount === 0` — a batch is only created when
  `rowsToImport.length > 0` per step 4, so this state is actually unreachable given the
  architecture; **no separate empty state needed**, included here only to document why
  it's not designed).

---

### 3. Type-filename-to-confirm undo modal — `components/import/undo-batch-modal.tsx`

**Decision: new component, do not extend `ConfirmDialog`.** `ConfirmDialog`'s
`description: string` prop has no slot for a controlled input or per-keystroke
validation, and bolting a `requireTypedConfirmation` mode onto a 45-line primitive
with three existing plain-description callers (rules, categories, transactions delete)
bloats all of them. `UndoBatchModal` composes `Modal` + `Label`/`Input` + `Button`
directly, following the same structural shape `ConfirmDialog` uses internally.

**Props:**

```ts
{
  open: boolean;
  batch: FrontendImportBatch;           // filename, id, importedCount
  transactionCount: number;             // == batch.importedCount, passed explicitly
                                         // so the modal doesn't reach into batch shape
                                         // assumptions beyond what it needs
  onConfirm: () => Promise<void>;       // parent performs the POST /undo call
  onCancel: () => void;
}
```

Parent (`import-history.tsx` or the detail page's client wrapper) owns `pending`/
`error` state for the undo request itself — same split as `RulesView`'s
`confirmDeleteId` + `deletePending` pattern — and passes a fresh `key={undoKey}`
(counter, bumped each time a new undo is initiated) to force remount, **exactly like
`transactions-view.tsx`'s `dialogKey`/`drawerKey` pattern**. This is load-bearing:
unlike `ConfirmDialog` (stateless, no `key` needed by its three existing callers),
this modal holds typed input state — without a fresh `key` per open, a cancelled-then-
reopened modal (same or different batch) shows the previous typed text with Confirm
already enabled.

**Internal state:** `typedFilename: string` (controlled input, starts empty every
mount because of the `key` remount above), `pending: boolean` (mirrors parent's, or
lifted — implementer's call, not load-bearing), `error: string | null`.

**Match rule** `**[flagged, not assumed]**`: typed text matches when
`typedFilename.trim().toLowerCase() === batch.filename.trim().toLowerCase()` — the
same trim + case-insensitive semantics as `normalizeFilename` (decision 3), reimplemented
inline in the component rather than importing `normalizeFilename` from the service
module, to avoid a client component importing from `lib/services/*` (keeps the
client/server boundary conservative even though that particular function has no
Prisma/server-only dependency). Rationale for the semantics themselves: it's already
the app's single definition of "same filename" everywhere else (preview warning, 409
gate); a stricter byte-exact rule here would mean two different definitions of
filename equality in one feature.

**Copy (exact):**

- Title: `Undo import`
- Body paragraph 1: `"This will permanently delete {transactionCount} transaction{s} imported from “{filename}”."`
- Body paragraph 2 (always shown, not conditional — decision 6's known gap applies to
  every undo): `"If any of these were recategorized, retyped as income or expense, or
skipped since they were imported, those changes will be lost — they are not
tracked separately from the import."`
- Label above input: `Type the filename to confirm`
- Input placeholder: the batch filename itself (`placeholder={batch.filename}`), value
  bound to `typedFilename`.
- Confirm button label: `Undo import` (not generic "Confirm" — names the destructive
  action, matches `ConfirmDialog`'s `confirmLabel` convention of naming the verb).
- Cancel button label: `Cancel`.

**States:**

- **Default:** Confirm `Button variant="danger"` `disabled` until typed text matches
  (per the match rule above). No `icon={Trash2}` needed — `Undo2` icon from
  `lucide-react` is more accurate than the delete-icon `ConfirmDialog` defaults to
  (this isn't a delete of the batch, it's an undo).
- **Loading:** Confirm button `loading={pending}` (spinner replaces icon per
  `Button`'s existing loading behavior), both buttons effectively disabled (`Button`
  disables on `loading` internally, Cancel gets explicit `disabled={pending}` matching
  `ConfirmDialog`'s cancel-disable-while-pending pattern).
- **Error:** request fails → `text-rose text-sm` message below the input ("Could not
  undo this import. Try again."), button returns to enabled (not stuck loading), typed
  text preserved (don't clear on error — respect what the user typed).
- **Success:** parent closes the modal (`open: false`) and calls `router.refresh()`;
  no in-modal success state needed since it unmounts on close, matching
  `RulesView.handleDelete`'s pattern exactly.

**Accessibility — where `Modal` doesn't handle it:**

- `Modal`'s `showModal()` focuses the first focusable descendant in DOM order, which
  is the `X` close button (`modal.tsx:44-51`, rendered before `children`), **not** the
  filename input. Spec `autoFocus` on the confirm `Input` explicitly — this is the one
  place default `Modal` focus behavior is wrong for this use case, everywhere else
  (`ConfirmDialog`, delete confirmations) a first-focus on the close button is harmless
  since there's no primary input to reach.
- Native `<dialog>` (via `Modal`) already provides: focus trap, `Escape`→`onCancel`
  (`onCancel` prop wired to `onClose`), backdrop click does nothing (no `onClick` on
  the backdrop pseudo-element, intentional — matches existing `Modal` behavior, no
  accidental-backdrop-dismiss of a destructive action).
- Input `id`/`htmlFor` pairing via `Label` (existing component, no change) for
  screen-reader association.
- Confirm button's `disabled` state is a sufficient a11y signal (native `disabled`,
  announced by AT) — no extra `aria-describedby` needed beyond the visible label text
  already describing what to type.

---

### 4. Transaction batch indicator — `components/transactions/transactions-view.tsx`

**Where:** the transaction row (`transactions-view.tsx:277-312`), between the
category pill and the amount, OR as a small addition inside the existing payee/account
block — **spec: inside the existing left block**, appended as a third line under
`accountName`, to avoid widening the row's fixed-width columns (category pill, amount,
running balance are all `shrink-0` with hardcoded widths already).

**Markup (conceptual):**

```tsx
<div className="min-w-0 flex-1">
  <div className="truncate text-sm font-medium">{t.payee || t.categoryName || 'Transaction'}</div>
  <div className="text-ink-muted mt-0.5 text-xs">{t.accountName}</div>
  {t.importBatchFilename && (
    <div className="text-ink-muted mt-0.5 flex items-center gap-1 text-[11px]">
      <Upload size={11} />
      <span className="truncate">{t.importBatchFilename}</span>
    </div>
  )}
</div>
```

**Nested-interactive resolution** `**[flagged, not assumed]**`: the row `div` already
carries `onClick={() => openDetail(t)}` (opens the edit `Drawer`). A real `<a>`/`Link`
for the batch chip nested inside that `div` is a browser-invalid nested-interactive
pattern requiring `e.stopPropagation()` to avoid triggering both. **Decision: the row-
level batch indicator is a non-interactive text chip, not a link** — clicking it opens
the transaction detail drawer like the rest of the row (existing behavior, unchanged).
The **link to the history entry lives only in the transaction detail `Drawer`**
(`transactions-view.tsx:338-360`), where there's no competing click target: add a row
below the existing amount/category display,
`<Link href={`/import/history/${detail.importBatchId}`} className="text-iris text-sm hover:underline">Imported from {detail.importBatchFilename}</Link>`,
rendered only when `detail.importBatchFilename` is set.

**No indicator for manually-entered transactions** (story 4): the conditional above
(`t.importBatchFilename &&`) already satisfies this — `null` renders nothing, no
placeholder, no "Manual" label. Same null-check gates the Drawer link.

---

### 5. 409-override flow — `components/import/import-view.tsx`

Three visually distinct duplicate-signal registers must coexist without being
confused for one another:

1. **Row-level "possible duplicate"** (existing, unchanged) — muted inline text next
   to the row date, `text-ink-muted text-xs`, no color escalation. Stays exactly as-is
   (`import-view.tsx:281`).
2. **Preview-time filename warning** (new, advisory) — a banner between the upload
   `Card` and the preview `Card`, **not** the row-level muted text and **not** the
   blocking-red 409 treatment (the plan explicitly requires these to look unlike each
   other): `bg-sky-soft text-sky rounded-lg px-4 py-3 text-sm` (same tone family as the
   existing post-commit success banner at `import-view.tsx:303-308`, since this is
   informational, not an error). Copy: `"A file named “{filename}” was already
imported into this account on {batch.createdAt} ({batch.rowCount} rows{, if
rowCountMatches: ', same row count'}{, if dateRangeMatches: ', same date range'}).
You can still import — duplicate rows will be flagged below."` Rendered whenever
   `preview.filenameWarning !== null`; does not block the Preview→commit flow.
3. **Commit-time 409 (blocking)** — replaces today's blanket `text-rose` "Import
   failed." line with a structured error block: `bg-rose-soft border border-rose/40
rounded-lg px-4 py-3` containing:
   - `text-rose text-sm font-medium`: `"“{filename}” was already imported into this
account on {batch.createdAt}."`
   - `text-ink-muted text-xs`: `"{batch.rowCount} rows, {batch.importedCount}
imported."` (names the conflicting batch's date + row count, per the task).
   - `Button variant="danger" icon={Upload}` labeled **"Import anyway"** — resubmits
     `handleCommit` with `overrideDuplicateFilename: true`.

**State/flow change in `import-view.tsx`:** `handleCommit` becomes
`handleCommit(override: boolean = false)` — **the override flag is a call argument,
not persisted component state** `**[flagged, not assumed]**`. Rationale: `handleFile`
already resets `preview`/`error`/`committed` on every new file selection; if
`overrideDuplicateFilename` were separate `useState`, it would need the same reset or
a second file would silently inherit the previous file's override intent and skip a
409 it should have hit. Passing it as an argument makes that bug structurally
impossible — there's nothing to forget to reset.

- On `409` response with `body.code === 'DUPLICATE_FILENAME'`: store `body.batch` in
  a new `duplicateBatch: FrontendImportBatch | null` state, render the block above
  instead of the generic error string, **do not** clear `preview` (rows stay reviewable).
- "Import anyway" click → `handleCommit(true)`, which sends
  `{ ..., overrideDuplicateFilename: true }`. Loading state reuses existing
  `committing`/`loading`.
- Any other non-`409` failure keeps today's generic `"Import failed."` `text-rose`
  line (unchanged fallback) — only the `DUPLICATE_FILENAME` code gets the structured
  treatment.
- Successful override commit clears `duplicateBatch` along with the existing
  full-form reset (`import-view.tsx:144-157`).

`import-view.tsx` also gains `filename: file.name` sent on both `/preview` and
`/commit` requests (currently posts neither) — required by the architecture's changed
request bodies; store it in existing state (e.g. reuse a `fileName` state set in
`handleFile` alongside `rawRows`).

---

### 6. Sidebar nav entry — `components/nav/sidebar.tsx`

Add one entry to `navItems` (`sidebar.tsx:26-64`), positioned after `Rules` and before
`Settings` (import is a data-maintenance action, same tier as Rules, not a primary
daily-use view like Transactions/Budgets — kept out of the top cluster):

```ts
{
  href: '/import',
  label: 'Import',
  icon: <Upload className={navIconClassName} />,
},
```

- No `badge` — `**[flagged, not assumed]**` `getNavCounts` has no import-related count
  today and adding one (e.g. "batches with unresolved warnings") is out of scope for
  this pass; do not invent one.
- `SidebarNav`'s existing `pathname.startsWith(`${item.href}/`)` active-match
  (`sidebar-nav.tsx:25`) already keeps `/import` highlighted while on
  `/import/history` and `/import/history/[id]` — no change needed there.
- `Upload` icon is already imported in `transactions-view.tsx` for the existing
  "Import CSV" link; import it fresh in `sidebar.tsx`'s existing `lucide-react` import
  line (`sidebar.tsx:2-12`).

---

### Summary — deliverable-to-file map

| Task item                   | File(s)                                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| History view                | `app/(protected)/import/history/page.tsx`, `components/import/import-history.tsx` |
| Batch detail + undone state | `app/(protected)/import/history/[id]/page.tsx`                                    |
| Type-to-confirm undo modal  | `components/import/undo-batch-modal.tsx` (new)                                    |
| Transaction batch indicator | `components/transactions/transactions-view.tsx` (modify)                          |
| 409-override flow           | `components/import/import-view.tsx` (modify)                                      |
| Sidebar nav entry           | `components/nav/sidebar.tsx` (modify)                                             |

---

## Test Plan

Written before implementation, per this repo's tester-before-senior-developer workflow.
Targets the Architecture and UI Design sections above as locked -- no design changes here.
Every case named in the section 6 "Tests" and section 8 "Risks" is included below; none dropped.

### Scope notes

- `FrontendImportBatch` has no `Decimal` fields (counts + dates only) -- the money-edge-case
  bar lands on `transactions.ts` (existing `amount` serialization, e.g. `'50.00'`), not on
  batches. Do not invent Decimal cases for `rowCount`/`importedCount`/`skippedDuplicates`.
- e2e login is a single shared seeded dev user (`tests/e2e/*.spec.ts` convention -- no
  per-test user isolation, `playwright.config.ts` runs `fullyParallel: true`). Any e2e
  case that depends on an exact batch count (history empty state, exact pagination count)
  is **not reliably assertable** against the shared account and must be written as a
  relative/conditional check (see History view e2e below), not an exact-count assertion.

---

### A. Unit test plan

#### A1. `tests/unit/validators/import-batches.test.ts` (new)

Not in section 6's file list explicitly for validators, but section 2 states the moved/extended
schemas "need unit coverage" -- cover here rather than only indirectly through service
tests, since Zod stripping is the root cause of the story-2a risk in section 8.

- `importFilenameSchema`: rejects empty string, rejects >255 chars, trims whitespace
  (`'  march.csv  '` -> `'march.csv'`), accepts unicode filename.
- `previewImportSchema`: requires `accountId` + `filename` + non-empty `rows`; rejects
  `rows: []` (`.min(1)`); rejects `rows.length === 2001` (`.max(2000)`).
- `importRowSchema`: `duplicate` defaults to `false` when the key is **absent** from the
  input object (not merely `undefined` set explicitly) -- this is the exact case section 8's
  risk describes (Zod silently stripping an undeclared/legacy payload key). Assert
  `importRowSchema.parse({...withoutDuplicateKey}).duplicate === false`.
- `commitImportSchema`:
  - `overrideDuplicateFilename` defaults to `false` when absent.
  - `.refine` rejects when any row's `accountId` differs from the top-level `accountId`
    (single-account narrowing, decision 10); error path is `['rows']`.
  - accepts `rows.length === 2000`, rejects `2001` (decision 7 cap parity with preview).
- `listImportBatchesQuerySchema`: `limit` defaults to `25` when absent; coerces string
  query-param `"10"` to number `10`; rejects `limit: 0` and `limit: 101`; `cursor`
  optional, rejects empty string (`.min(1)`).

#### A2. `tests/unit/services/importBatches.test.ts` (new)

Hoisted mock shape (mirrors `csvImport.test.ts` / `budgets.test.ts` pattern):

```ts
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    importBatch: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    transaction: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
```

`$transaction` mock invokes its callback with a `tx` object shaped like `prismaMock`
itself (`{ transaction: { deleteMany }, importBatch: { update } }`) -- same technique
needed in A3 for `commitImport`; write it once, share via a local helper if convenient,
but each test file mocks its own hoisted `prismaMock` (no cross-file sharing).

**`normalizeFilename`**

- `'March.CSV'` -> `'march.csv'`.
- `'  march.csv  '` -> `'march.csv'` (trim).
- Already-normalized input is idempotent (`normalizeFilename('march.csv') === 'march.csv'`).

**`findActiveBatchByFilename`**

- Match on same account, `status: 'ACTIVE'` -> returns the mapped `FrontendImportBatch`.
  Assert the `where` passed to `findFirst` is exactly
  `{ userId, accountId, filenameNormalized: 'march.csv', status: 'ACTIVE' }` and
  `orderBy: { createdAt: 'desc' }` -- the ordering is normative (section 3.1), not incidental.
- Same normalized filename on a **different** `accountId` -> not matched (assert the
  `where.accountId` passed to the mock, since the mock itself doesn't filter -- this is
  a call-arguments assertion, not a behavioral one, matching the mocked-Prisma pattern
  used throughout this repo).
- Batch exists but `status: 'UNDONE'` -> `findFirst` is mocked to resolve `null` (i.e.
  the `where` predicate would have excluded it) -> function returns `null`. (Since Prisma
  is mocked, this test really just confirms the `where` includes `status: 'ACTIVE'` and
  that a `null` resolution maps to `null` output, not an exception.)
- Two ACTIVE batches share a normalized filename (legal per decision 1's override path)
  -> mock `findFirst` to return the newer one; assert the service returns it (i.e. relies
  on `orderBy: { createdAt: 'desc' }` + `findFirst`, not `findMany` + manual sort).
- No match -> returns `null`, does not throw.

**`listImportBatches`**

- Page with fewer rows than `limit + 1` returned by the mock -> `nextCursor: null`,
  `batches` unchanged from mock (no row dropped).
- Page with exactly `limit + 1` rows returned by the mock -> last (`limit`-th index + 1)
  row is dropped from `batches`, its `id` becomes `nextCursor`.
- `cursor` param present -> assert `findMany` called with `cursor: { id: cursor }, skip: 1`.
- `cursor` absent -> assert no `cursor`/`skip` keys passed (or passed as `undefined`,
  whichever the implementation chooses -- pin one and assert it, since an accidental
  `skip: 1` with no cursor would silently drop the first row).
- `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]` asserted verbatim (tie-break is
  load-bearing for cursor stability, not cosmetic).
- Includes UNDONE batches in results (mock returns a mix of ACTIVE/UNDONE, both appear
  in output) -- story 3 requires undo-inclusive history, this is the regression guard.
- Last page (`nextCursor: null`) explicitly named per the task -- do not collapse this
  into the "fewer than limit+1" case above without an explicit assertion on `nextCursor`.

**`getImportBatch`**

- Found + owned -> returns mapped `FrontendImportBatch` (assert `undoneAt: null` for an
  ACTIVE batch mock lacking `undoneAt`, and a non-null ISO string for one with it).
- Not found (`findFirst` resolves `null`) -> throws `ServiceValidationError('Import batch not found')`.
- Exists but owned by a different user -> same as not-found (the `where` includes
  `userId`; assert `findFirst` was called with `{ id, userId }` -- this is the entire
  access-control surface for this method per CLAUDE.md).

**`undoImportBatch`**

- Happy path: batch exists, `status: 'ACTIVE'` -> `tx.transaction.deleteMany` called with
  `{ where: { userId, importBatchId: batchId } }` (assert `userId` present, not just
  `importBatchId` -- scoping check), `tx.importBatch.update` called with
  `{ status: 'UNDONE', undoneAt: expect.any(Date) }`; return value
  `{ batch, deletedTransactions: count }` matches the mocked `deleteMany` count.
- Already-undone: pre-transaction lookup (`findFirst`) resolves a batch with
  `status: 'UNDONE'` -> throws `BatchAlreadyUndoneError`, **and** assert the `$transaction`
  mock / `tx.transaction.deleteMany` was **never called** -- the discriminating assertion
  per the advisor note, not just the thrown error type.
- Unowned id: `findFirst({ where: { id, userId } })` resolves `null` (id exists for
  another user, or doesn't exist at all -- same query, same outcome) -> throws
  `ServiceValidationError`, `$transaction` never called.
- Mapper regression: `undoneAt` on the returned batch is `null` for a freshly-created
  mock ACTIVE batch fixture used elsewhere in this file, non-null ISO string post-undo.

#### A3. `tests/unit/services/csvImport.test.ts` (modify existing + new)

Existing-test migration (breaking change, must happen or the whole file fails to compile
against the new return shape):

- Every assertion indexing `result[0]`/`result[1]` -> `result.rows[0]`/`result.rows[1]`.
- Every `previewImport('user-1', [...])` call -> `previewImport('user-1', { accountId, filename, rows: [...] })`.
- Hoisted `prismaMock` gains `importBatch: { findFirst: vi.fn(), create: vi.fn() }` and
  a `$transaction: vi.fn()` that invokes its callback with a tx-shaped mock exposing
  `importBatch.create` and `transaction.createMany`.
- Existing `commitImport(...)` calls gain top-level `accountId`/`filename`; per-row
  `duplicate` field added where the row is meant to hit either dedupe branch (see below --
  omitting it now defaults to `false`/stale-preview per the validator, which changes the
  existing "only creates transactions for rows marked include" case's semantics unless
  `duplicate` is explicitly set false there too, matching original intent).
- `commitImport` return-shape assertions gain `batchId` (`expect.any(String)` for
  non-zero-row commits, `null` for the zero-row case).

New preview cases:

- `filenameWarning: null` when `findActiveBatchByFilename` (mocked at the `importBatch`
  Prisma level, i.e. `prismaMock.importBatch.findFirst.mockResolvedValue(null)`) finds
  nothing.
- `filenameWarning` populated when a matching ACTIVE batch exists on the same account --
  assert `submittedRowCount`, `rowCountMatches`, `dateRangeMatches` computed correctly
  for: (a) same row count + same date range -> both `true`; (b) different row count ->
  `rowCountMatches: false`; (c) different date range -> `dateRangeMatches: false`.
- Preview does not exclude/mutate rows based on the filename warning (advisory-only,
  story 2 requirement) -- row-level `duplicate`/`include` flags unaffected by whether
  `filenameWarning` is populated.

New commit cases:

- **409 path**: mocked active batch exists on the account, `overrideDuplicateFilename`
  omitted (defaults `false`) -> `commitImport` rejects with `DuplicateFilenameError`;
  assert `$transaction` / `importBatch.create` **never called** (no batch
  created on the rejected path).
- **Filename-override path**: same conflict, `overrideDuplicateFilename: true` -> commit
  proceeds, a **new** batch is created (assert `importBatch.create` called, not
  `update`/merge of the prior one -- decision 1's "does not merge").
- **Filename gate ordered before dedupe** (section 3.3 normative ordering, section 8 risk-adjacent):
  every row in the commit is a row-level duplicate (`existingKeys` match for all rows,
  so absent the filename check this would hit the zero-row early-return) **and** an
  active batch with the same filename exists, override omitted -> asserts **409**
  (`DuplicateFilenameError`), not the zero-row `{ batchId: null, imported: 0, ... }`
  shape. This is the case that would silently regress if the filename check were moved
  after step 3/4.
- **Zero-row commit creates no batch**: all rows `include: false` or all row-level
  duplicates, no filename conflict -> `{ batchId: null, imported: 0, skippedDuplicates: N }`;
  assert `importBatch.create` **never called** (story 1's "reserves no filename").
- **Story 2a -- override case**: row with `{ include: true, duplicate: true }` whose key
  matches an existing DB row (`prismaMock.transaction.findMany` returns a matching
  fixture) -> row **is imported** (present in the `createMany` data, counted in
  `imported`, not in `skippedDuplicates`).
- **Story 2a -- stale-preview case** (must not be collapsed into the above): row with
  `{ include: true, duplicate: false }` whose key matches an existing DB row -> row is
  **skipped** (absent from `createMany` data, counted in `skippedDuplicates`, not
  `imported`) -- protection unchanged from today's behavior.
- **Story 2a -- absent `duplicate` field defaults to skip**: row payload omits the
  `duplicate` key entirely (simulating a legacy/malformed client) with a matching DB key
  -> validator default (`false`) applies -> same as the stale-preview case, row skipped.
  This is the direct regression test for section 8's "invisible if `duplicate` is not declared"
  risk, expressed at the service level (validator-level coverage is A1).
- **Metric definitions** (decision 5, section 3.3 "Metric definitions"): 5 submitted rows, 2 of
  them `include: false`, 1 of the remaining 3 is a stale-preview duplicate -> assert
  `rowCount: 5` (all submitted, including excluded), `importedCount: 2`,
  `skippedDuplicates: 1`. Additionally assert `dateFrom`/`dateTo` are computed over all
  5 submitted rows (including the `include: false` ones) -- construct the fixture so an
  excluded row has the min or max date, and assert it still moves the range boundary.
- Batch-then-rows ordering: assert (via mock call order, or by asserting `createMany`'s
  `data` entries carry `importBatchId` equal to the id returned by the mocked
  `importBatch.create`) that transactions reference the created batch's id.
- `randomUUID` no longer imported/called -- if feasible, assert no `importBatchId` value
  in the `createMany` payload looks like a bare UUID unconnected to the mocked batch id
  (soft check; primary regression coverage is the ordering assertion above).

#### A4. `tests/unit/services/transactions.test.ts` (modify)

- `listTransactions` (or equivalent existing list test) -- `batchId` query param passed
  through to `where.importBatchId`; assert the `findMany` `where` includes
  `importBatchId: 'batch-1'` when `query.batchId = 'batch-1'`.
- `batchId` absent from query -> `where.importBatchId` is `undefined`, not `null` and not
  omitted-in-a-way-that-changes-existing-query-shape -- pin exact behavior so an
  accidental `null` (which would filter to manually-entered-only) doesn't regress
  silently. Compare against a snapshot of today's `where` shape for a no-batchId call.
- `toFrontend` mapping: transaction with `importBatch: { id: 'b1', filename: 'march.csv' }`
  -> `importBatchId: 'b1'`, `importBatchFilename: 'march.csv'`.
- `toFrontend` mapping: transaction with `importBatch: null`, `importBatchId: null`
  (manually entered) -> both fields `null` -- this is story 4's "no indicator for manual
  transactions" at the data layer.
- Money/edge-case regression: adding the `importBatch` include does not change existing
  `amount` Decimal serialization (e.g. still `'50.00'`) -- one assertion reusing an
  existing fixture, to catch an accidental `include` collision breaking the select shape.

---

### B. e2e test plan

New spec files under `tests/e2e/`, following the shared-login + `Date.now()`-uniqued
fixture convention (`login` helper duplicated per spec file, matching existing files --
no shared helper module exists in this repo today, don't introduce one here).

#### B1. `tests/e2e/import-duplicate-filename.spec.ts` (new)

Uses `setInputFiles({ name, mimeType: 'text/csv', buffer })` on the file `input[type=file]`
in `import-view.tsx` -- `name` is the filename under test, no real file needed on disk.

1. **Happy path, first import**: upload a uniquely-named CSV (`E2E-{timestamp}.csv`,
   one row) to an existing account -> preview shows the row, no filename warning banner
   -> commit succeeds -> success state shown (existing post-commit banner).
2. **Preview-time warning, non-blocking**: re-select the **same** file (same name) for
   the same account -> preview response includes `filenameWarning` -> assert the
   `bg-sky-soft`/`text-sky` banner is visible with the filename and prior batch's date,
   **and** the primary Import/commit action remains enabled/clickable (advisory, not
   blocking) -- do not stop here, proceed to step 3.
3. **Commit-time 409, blocking**: click Import on the still-open re-preview from step 2
   (all rows preview as `duplicate: true`, checkboxes default unchecked) -> commit
   rejected -> assert the `bg-rose-soft`/`text-rose` structured error block is visible,
   names the filename and the conflicting batch's date, **and** the generic "Import
   failed." text is NOT shown (this is the replaced blanket-error case named in the
   task).
4. **Override succeeds -- checkboxes required first**: from the 409 state, check the
   per-row "include" box(es) for the flagged duplicate row(s) (section 4's stacking behavior --
   confirmed in advisor review: override alone with all rows unchecked hits the
   zero-row path and creates no batch, so this step is not optional in the test), then
   click "Import anyway" -> commit succeeds with `overrideDuplicateFilename: true` ->
   assert success state, and (via `/import/history`) that **two** distinct batches now
   exist for that filename (both visible in history, proving no merge -- decision 1).
5. **Different filename, same content -> no 409**: upload a CSV with identical row data
   but a different filename -> preview shows no `filenameWarning`, commit succeeds
   without a 409 -- proves filename-only matching (no content hashing, per non-goals).
6. **Case/whitespace-insensitive match**: upload a file named
   `E2E-{timestamp}.CSV` (uppercase extension, or leading/trailing space variant of an
   already-imported name) -> still triggers the warning/409 -- end-to-end proof of
   decision 3's normalization, not just the unit-level `normalizeFilename` cases.

#### B2. `tests/e2e/import-history.spec.ts` (new)

1. **List renders after import**: perform one import (unique filename) via `/import`,
   then visit `/import/history` -> the new batch's row is visible with filename,
   account name, `"1 imported"`, and today's date. (Do **not** assert on total row
   count or an empty state here -- shared dev account has accumulated batches across
   prior test runs; assert presence of the new row via `.filter({ hasText: filename })`,
   matching the `confirm-dialogs.spec.ts` pattern.)
2. **Empty state -- not directly e2e-testable against the shared fixture.** Note this
   explicitly rather than writing a flaky/false-passing test: the shared dev user will
   have prior batches from other specs run in the same suite (`fullyParallel: true`).
   If empty-state coverage is required, it must run against a freshly-created signup
   user with zero imports (see `tests/e2e/signup.spec.ts` for the account-creation
   pattern) in its own isolated spec, not reuse the shared login. Flag this to
   senior-developer as a decision point rather than assuming which approach to take.
3. **Pagination -- "Load more"**: seed ~26 batches for the shared user via 26 sequential
   `request.post('/api/import/commit', ...)` calls in a `test.beforeAll` (distinct
   filenames, e.g. `E2E-Page-{n}-{timestamp}.csv`, 1 row each, skip the UI upload for
   this setup to keep it fast) -> visit `/import/history` with `limit` unset (defaults 25) -> assert at most 25 rows initially, "Load more" button visible -> click it ->
   assert the button-seeded batches now visible (e.g. the 26th) and, if that was the
   true last page, the button unmounts. If total account history already exceeds one
   page from other tests, adjust the assertion to "more rows appear after clicking",
   not an exact count.
4. **Load-more failure**: not easily e2e-triggerable without network mocking (out of
   scope for Playwright against a real dev server per this repo's existing e2e specs,
   none of which mock network) -- cover the retry-in-place behavior
   (`loadError` shown, button stays clickable) at a **component-test level if one is
   later introduced**; flag as a gap here rather than write an untestable e2e case.
5. **Batch detail -- active batch with transactions**: click a batch's filename link ->
   navigates to `/import/history/{id}` -> transaction rows visible, no edit affordance
   (read-only, story 3), header shows filename/account/counts/date range.
6. **Batch detail -- undone batch**: undo a batch (see B3), then visit its detail page
   directly (or via the history link) -> assert the "transactions removed by undo" panel
   is visible (copy contains "removed when this import was undone"), **not** a 404 and
   not the generic empty state -- this is the explicit non-404 requirement from story 3.
7. **Batch detail -- unowned/nonexistent id**: navigate to
   `/import/history/does-not-exist` -> assert Next.js `notFound()` page (404), matching
   existing `[id]` route conventions -- not a crash/500.

#### B3. `tests/e2e/import-undo.spec.ts` (new)

1. **Modal confirm stays disabled until exact match**: import a uniquely-named file,
   open history, click "Undo" on the ACTIVE row -> modal visible, title "Undo import",
   body mentions the transaction count and contains "recategorized, retyped as income
   or expense, or skipped" (decision 6's known-gap copy, exact phrase check) -> Confirm
   button (`"Undo import"`) is disabled with the input empty, remains disabled after
   typing a partial/incorrect filename, **becomes enabled** after typing the exact
   filename.
2. **Match rule is trim + case-insensitive**: type the filename in a different case
   (e.g. uppercase) or with leading/trailing whitespace -> Confirm becomes enabled --
   proves the modal reimplements decision 3's semantics, not a byte-exact rule.
3. **Cancel clears state on reopen**: type a partial (non-matching) or even matching
   string, click Cancel -> modal closes, batch still ACTIVE and listed -> reopen the
   modal (same or different batch) -> input is empty, Confirm disabled -- regression
   guard for the `key`-remount behavior called load-bearing in the UI spec.
4. **Confirm succeeds**: type the exact filename, click "Undo import" -> modal closes,
   history row now shows the `UNDONE` pill (`"Undone {date}"`), "Undo" action no longer
   rendered for that row, and (batch detail page) transactions show the removed-by-undo
   panel from B2.6.
5. **Idempotent / already-undone -- not reachable via the UI** (Undo button only renders
   for `ACTIVE` rows per UI section 1) -- cover via a direct API request instead:
   `request.post('/api/import/batches/{undoneBatchId}/undo')` against the batch undone
   in step 4 -> assert `409` with `{ code: 'ALREADY_UNDONE' }` body, not a 500/crash.
6. **Unowned/nonexistent batch id** -- also API-only, same reasoning:
   `request.post('/api/import/batches/does-not-exist/undo')` -> assert `404`.
7. **Deleted transactions actually gone**: before undo, note a transaction's payee from
   the batch (via batch detail or `/transactions`); after undo, confirm that payee no
   longer appears in `/transactions` for that account (not just that the batch flipped
   status) -- proves the `deleteMany` actually ran, not just the status flip.

#### B4. `tests/e2e/transaction-batch-indicator.spec.ts` (new)

Row chip and detail-drawer link are **deliberately different affordances** per UI section 4 --
test both, do not conflate them into one "linking to history" assertion.

1. **Row chip visible, non-interactive**: import a uniquely-named file -> visit
   `/transactions`, filtered/scrolled to an imported row -> the filename chip (with
   upload icon) is visible under the account name -> clicking anywhere on the row
   (including on/near the chip) opens the transaction detail **Drawer** (existing
   row-click behavior), not a navigation to history -- assert `page.url()` is unchanged
   immediately after the click (still `/transactions`) and the Drawer is visible.
2. **Detail Drawer link navigates to history**: with the Drawer open from step 1, assert
   a link reading "Imported from {filename}" is visible and, when clicked, navigates to
   `/import/history/{batchId}` (assert `toHaveURL`), landing on that batch's detail page
   (filename visible in the page header).
3. **No indicator for manual transactions**: create a transaction via the existing
   "Add transaction" drawer (not import) -> its row shows no filename chip, and its
   detail Drawer shows no "Imported from" link -- story 4's explicit non-goal, regression
   guard against a stray "Manual" label or broken null-check.

---

### C. Explicit non-coverage (call out, don't silently skip)

- Raw SQL/migration backfill correctness (the `UPDATE ... SET importBatchId = NULL`
  ordering) -- not unit/e2e testable in this stack; verify manually via
  `npm run prisma:migrate` dry run / SQL review, per section 8's risk note, not via these plans.
- Cross-batch skipped-duplicate-row recovery -- accepted non-goal (decision 8), no test
  needed; `skippedDuplicates` count visibility is covered in A3's metric-definitions
  case and B2.1/B2.5's history/detail rendering.
- Manual-edit-loss on undo (decision 6) -- no `updatedAt` exists to assert against;
  covered only as a **copy** check (B3.1's exact-phrase assertion), not a behavioral one.
