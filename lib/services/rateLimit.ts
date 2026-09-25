import { prisma } from '@/lib/db/prisma';

/**
 * Thrown when a scope/key pair has exceeded its window limit. Carries
 * `retryAfterMs` so a caller can surface "try again in N minutes" instead of
 * a generic failure.
 */
export class RateLimitedError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super('Too many attempts. Try again later.');
    this.name = 'RateLimitedError';
  }
}

/**
 * Fixed-window counter backed by `RateLimitBucket`. DB-backed rather than
 * in-memory because the app runs as multiple serverless instances with no
 * shared process state (same reasoning as `AI_DAILY_SUGGEST_LIMIT` in
 * `aiCategorize.ts`, which this mirrors).
 *
 * Every call opportunistically prunes buckets from two windows ago or
 * older — cheap (indexed on `windowStart`) and means this table never needs
 * its own cleanup job.
 *
 * Throws `RateLimitedError` when the caller's attempt would push `key` over
 * `limit` within `windowMs`; otherwise records the attempt and returns.
 */
export const checkRateLimit = async (
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> => {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);

  await prisma.rateLimitBucket.deleteMany({
    where: { windowStart: { lt: new Date(windowStart.getTime() - windowMs) } },
  });

  const bucket = await prisma.rateLimitBucket.upsert({
    where: { scope_key_windowStart: { scope, key, windowStart } },
    create: { scope, key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });

  if (bucket.count > limit) {
    const retryAfterMs = windowStart.getTime() + windowMs - now;
    throw new RateLimitedError(retryAfterMs);
  }
};
