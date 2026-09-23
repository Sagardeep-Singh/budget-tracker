import { prisma } from '@/lib/db/prisma';
import {
  AI_DAILY_SUGGEST_LIMIT,
  AI_TIMEOUT_MS,
  getAiProviderClient,
  getFallbackModel,
} from '@/lib/ai';
import {
  AiDisclosureRequiredError,
  AiInvalidResponseError,
  AiRateLimitedError,
  AiUnavailableError,
} from '@/lib/ai/errors';
import { buildSuggestionPayload } from '@/lib/ai/prompt';
import type { AiSuggestionRequest } from '@/lib/ai/types';
import { isSecretEncryptionConfigured } from '@/lib/crypto/secrets';
import { matchCategoryRule } from '@/lib/services/categorize';
import { loadAiCredentials } from '@/lib/services/aiSettings';
import { ServiceValidationError } from '@/lib/services/common';

/**
 * Orchestration for the per-row "Suggest with AI" action. No HTTP, no crypto
 * primitives — it composes `lib/ai/` (transport), `lib/services/aiSettings.ts`
 * (key lifecycle) and the *existing* `matchCategoryRule` (rule gate) rather
 * than reimplementing any of them.
 */

export type AiSuggestion =
  { outcome: 'match'; categoryId: string; categoryName: string } | { outcome: 'none' };

export type AiDisclosurePreview = {
  fields: Array<{ label: string; value: string }>;
  categoryCount: number;
  exampleFromRealTransaction: boolean;
};

/**
 * The single money-formatting path for this feature. Both the outbound request
 * and the disclosure preview call it, which is what makes "the disclosure
 * cannot drift from what is actually sent" true for the amount too — same
 * `Number(x).toFixed(2)` rounding the rest of the app uses for display.
 */
export const formatAiAmount = (amount: unknown): string => Number(amount).toFixed(2);

/** UTC calendar day as a `YYYYMMDD` int — the `Budget.month` idiom. */
const utcDateKey = (now: Date): number =>
  now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();

/**
 * Exactly `getCategorizeQueue`'s where-clause. Eligibility has one definition:
 * a transfer leg, a card payment, an already-categorized row or a skipped row
 * is not in the queue, so it cannot be suggested on.
 */
const queueScope = (userId: string) => ({
  userId,
  categoryId: null,
  skippedAt: null,
  isTransfer: false,
  isPayment: false,
});

const QUEUE_MISS = 'That transaction is no longer in the categorize queue.';
const RULE_MATCHED = 'A rule already categorizes this transaction.';
const NO_KEY = 'Add an API key in Settings first.';

type TransactionShape = {
  payee: string | null;
  note: string | null;
  type: 'INCOME' | 'EXPENSE';
  amount: unknown;
};

const buildRequest = (
  transaction: TransactionShape,
  categories: Array<{ id: string; name: string }>,
  toggles: { sendNote: boolean; sendAmount: boolean },
): AiSuggestionRequest => {
  const request: AiSuggestionRequest = {
    // Never falls back to the note: that would route opted-out data into the
    // payload through the back door.
    payee: transaction.payee ?? '',
    type: transaction.type,
    categories,
  };
  if (toggles.sendNote && transaction.note !== null) {
    request.note = transaction.note;
  }
  // Gated on the toggle, never on truthiness — an amount of 0 is a legitimate
  // value that must render as "0.00", not disappear.
  if (toggles.sendAmount) {
    request.amount = formatAiAmount(transaction.amount);
  }
  return request;
};

/** The disclosure's field list, derived from the same request object the
 * payload builder renders, so the two cannot disagree. */
const previewFields = (request: AiSuggestionRequest): Array<{ label: string; value: string }> => {
  const fields = [
    { label: 'Payee', value: request.payee },
    { label: 'Type', value: request.type },
  ];
  if (request.note !== undefined) {
    fields.push({ label: 'Note', value: request.note });
  }
  if (request.amount !== undefined) {
    fields.push({ label: 'Amount', value: request.amount });
  }
  return fields;
};

export const suggestCategoryWithAi = async (
  userId: string,
  transactionId: string,
): Promise<AiSuggestion> => {
  // 1. The deployment has no master key: the feature is off, not broken.
  if (!isSecretEncryptionConfigured()) {
    throw new AiUnavailableError();
  }

  // 2. No key saved.
  const credentials = await loadAiCredentials(userId);
  if (!credentials) {
    throw new ServiceValidationError(NO_KEY);
  }

  // 3. Disclosure gate — before anything is read, let alone sent.
  if (!credentials.disclosureAccepted) {
    throw new AiDisclosureRequiredError(credentials.provider);
  }

  // 4. DB-backed daily cap. Two conditional `updateMany`s, atomic at the row
  // level, deliberately not wrapped in `$transaction` — the provider fetch must
  // never sit inside an open DB transaction. The slot is claimed *before* the
  // outbound call, so a hung provider still spends quota: the limiter protects
  // the user's provider spend, not our latency. This is also what makes "no
  // bulk suggestions" server-enforced rather than a UI choice.
  const today = utcDateKey(new Date());
  await prisma.userAiSettings.updateMany({
    // The `null` arm is load-bearing, not defensive: a row that has never been
    // suggested from has `suggestCountDate = NULL`, and SQL's `NULL <> today`
    // is NULL, not true — so a bare `{ not: today }` would silently skip the
    // rollover and leave the claim below with nothing to match, rate-limiting
    // every user on their very first suggestion.
    where: { userId, OR: [{ suggestCountDate: null }, { suggestCountDate: { not: today } }] },
    data: { suggestCountDate: today, suggestCount: 0 },
  });
  const claimed = await prisma.userAiSettings.updateMany({
    where: { userId, suggestCountDate: today, suggestCount: { lt: AI_DAILY_SUGGEST_LIMIT } },
    data: { suggestCount: { increment: 1 } },
  });
  if (claimed.count === 0) {
    throw new AiRateLimitedError({ reason: 'cap', limit: AI_DAILY_SUGGEST_LIMIT });
  }

  // 5. Eligibility, scoped by userId — another user's id simply misses.
  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, ...queueScope(userId) },
  });
  if (!transaction) {
    throw new ServiceValidationError(QUEUE_MISS);
  }

  // 6. AI is only for rows no rule matched, and that is server-enforced.
  const rules = await prisma.categoryRule.findMany({
    where: { userId },
    select: { categoryId: true, matchText: true, priority: true },
  });
  if (matchCategoryRule(rules, `${transaction.payee ?? ''} ${transaction.note ?? ''}`) !== null) {
    throw new ServiceValidationError(RULE_MATCHED);
  }

  // 7. The candidate set.
  const categories = await prisma.category.findMany({
    where: { userId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  if (categories.length === 0) {
    // Nothing to pick from — short-circuit before any network call. The rate
    // limit slot is already spent by design (it is claimed at step 4), but the
    // user is charged nothing by the provider.
    return { outcome: 'none' };
  }

  // 8. Opt-ins are read from the stored row; the client cannot influence them.
  const request = buildRequest(transaction, categories, credentials);

  // 9. One outbound call, with the hard timeout applied here and nowhere else.
  // The effective model is resolved from the row alone — no list call — so this
  // step stays a single provider request. The fallback is reached only when no
  // list fetch has ever succeeded for this key.
  const model = credentials.modelId ?? getFallbackModel(credentials.provider);
  let result;
  try {
    result = await getAiProviderClient(credentials.provider).suggestCategory(
      credentials.apiKey,
      model,
      request,
      AbortSignal.timeout(AI_TIMEOUT_MS),
    );
  } catch (error) {
    // AiModelRejectedError deliberately falls through to the rethrow below: it
    // is actionable ("pick a different model"), so the route must surface it as
    // a 400 rather than have it read as "no confident match". The stored
    // modelId is *not* cleared here — auto-repair was never asked for, and
    // silently mutating a user's setting on an error path is worse than the
    // error.
    if (error instanceof AiInvalidResponseError) {
      // Per the PM: "named a nonexistent category" reads to the user as "no
      // confident match". Logged as a signal — name and provider only, never
      // the body.
      console.warn(`[ai] ${error.name} from ${credentials.provider}`);
      return { outcome: 'none' };
    }
    throw error;
  }

  // 10. Resolve the name from the already-loaded list: a second line of defence
  // against an id outside the user's set, and no second round trip. Nothing is
  // written to the transaction — applying a suggestion stays the user's
  // existing explicit category-set action.
  if (result.outcome === 'none') {
    return { outcome: 'none' };
  }
  const category = categories.find((c) => c.id === result.categoryId);
  if (!category) {
    console.warn(`[ai] AiInvalidResponseError from ${credentials.provider}`);
    return { outcome: 'none' };
  }
  return { outcome: 'match', categoryId: category.id, categoryName: category.name };
};

const SYNTHETIC_EXAMPLE: TransactionShape = {
  payee: 'Blue Bottle Coffee',
  note: 'oat latte before the standup',
  type: 'EXPENSE',
  amount: '5.75',
};

/**
 * What the user reviews *before* accepting. Deliberately checks no gate: it is
 * callable before acceptance (that is the point), consumes no rate-limit slot
 * and makes no provider call. Built by the same `buildSuggestionPayload` the
 * real request uses, over a real queue row where one exists, so the disclosure
 * is provably accurate rather than hand-written UI copy.
 */
export const getAiDisclosurePreview = async (userId: string): Promise<AiDisclosurePreview> => {
  const [settings, categories, rules, queue] = await Promise.all([
    prisma.userAiSettings.findUnique({ where: { userId } }),
    prisma.category.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.categoryRule.findMany({
      where: { userId },
      select: { categoryId: true, matchText: true, priority: true },
    }),
    prisma.transaction.findMany({
      where: queueScope(userId),
      select: { payee: true, note: true, type: true, amount: true },
      orderBy: { date: 'desc' },
      take: 25,
    }),
  ]);

  const toggles = {
    sendNote: settings?.sendNote ?? false,
    sendAmount: settings?.sendAmount ?? false,
  };

  const example =
    queue.find((tx) => matchCategoryRule(rules, `${tx.payee ?? ''} ${tx.note ?? ''}`) === null) ??
    null;

  const request = buildRequest(example ?? SYNTHETIC_EXAMPLE, categories, toggles);
  // Run through the identical builder the real request uses — that shared call
  // is what makes the disclosure incapable of drifting from reality, and its
  // `categoryIds` is the authoritative count of what actually leaves.
  const payload = buildSuggestionPayload(request);

  return {
    fields: previewFields(request),
    categoryCount: payload.categoryIds.length,
    exampleFromRealTransaction: example !== null,
  };
};
