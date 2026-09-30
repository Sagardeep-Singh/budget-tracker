import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    rateLimitBucket: {
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { checkRateLimit, RateLimitedError } = await import('@/lib/services/rateLimit');

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.rateLimitBucket.deleteMany.mockResolvedValue({ count: 0 });
});

describe('checkRateLimit', () => {
  it('allows an attempt within the limit', async () => {
    prismaMock.rateLimitBucket.upsert.mockResolvedValue({ count: 3 });

    await expect(checkRateLimit('login:email', 'a@b.com', 10, 60_000)).resolves.toBeUndefined();
  });

  it('rejects once the count exceeds the limit', async () => {
    prismaMock.rateLimitBucket.upsert.mockResolvedValue({ count: 11 });

    await expect(checkRateLimit('login:email', 'a@b.com', 10, 60_000)).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it('scopes the bucket by scope + key + window, not just key', async () => {
    prismaMock.rateLimitBucket.upsert.mockResolvedValue({ count: 1 });

    await checkRateLimit('signup:ip', '1.2.3.4', 5, 3_600_000);

    expect(prismaMock.rateLimitBucket.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scope_key_windowStart: expect.objectContaining({ scope: 'signup:ip', key: '1.2.3.4' }),
        }),
        create: expect.objectContaining({ scope: 'signup:ip', key: '1.2.3.4', count: 1 }),
        update: { count: { increment: 1 } },
      }),
    );
  });

  it('prunes buckets older than the previous window before counting', async () => {
    prismaMock.rateLimitBucket.upsert.mockResolvedValue({ count: 1 });

    await checkRateLimit('login:ip', '1.2.3.4', 30, 900_000);

    expect(prismaMock.rateLimitBucket.deleteMany).toHaveBeenCalledWith({
      where: { windowStart: { lt: expect.any(Date) } },
    });
  });

  it('reports a positive retryAfterMs on rejection', async () => {
    prismaMock.rateLimitBucket.upsert.mockResolvedValue({ count: 999 });

    try {
      await checkRateLimit('login:email', 'a@b.com', 10, 60_000);
      throw new Error('expected checkRateLimit to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitedError);
      expect((error as InstanceType<typeof RateLimitedError>).retryAfterMs).toBeGreaterThan(0);
    }
  });
});
