import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, sendEmailMock, isEmailConfiguredMock } = vi.hoisted(() => ({
  prismaMock: {
    emailVerificationToken: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  sendEmailMock: vi.fn(),
  isEmailConfiguredMock: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/email/brevo', () => ({
  sendEmail: sendEmailMock,
  isEmailConfigured: isEmailConfiguredMock,
}));

const {
  issueAndSendVerificationEmail,
  resendVerificationEmail,
  consumeVerificationToken,
  getEmailVerificationStatus,
} = await import('@/lib/services/emailVerification');

beforeEach(() => {
  vi.clearAllMocks();
  isEmailConfiguredMock.mockReturnValue(true);
  prismaMock.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
});

describe('issueAndSendVerificationEmail', () => {
  it('does nothing when email is not configured', async () => {
    isEmailConfiguredMock.mockReturnValue(false);

    await issueAndSendVerificationEmail('user-1', 'a@b.com');

    expect(prismaMock.emailVerificationToken.upsert).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('upserts a token keyed by userId and sends the email', async () => {
    prismaMock.emailVerificationToken.upsert.mockResolvedValue({});
    sendEmailMock.mockResolvedValue(undefined);

    await issueAndSendVerificationEmail('user-1', 'a@b.com');

    expect(prismaMock.emailVerificationToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.com', subject: expect.stringContaining('Verify') }),
    );
  });

  it('propagates a send failure to the caller', async () => {
    prismaMock.emailVerificationToken.upsert.mockResolvedValue({});
    sendEmailMock.mockRejectedValue(new Error('brevo down'));

    await expect(issueAndSendVerificationEmail('user-1', 'a@b.com')).rejects.toThrow('brevo down');
  });
});

describe('resendVerificationEmail', () => {
  it('sends immediately when there is no prior token', async () => {
    prismaMock.emailVerificationToken.findUnique.mockResolvedValue(null);
    prismaMock.emailVerificationToken.upsert.mockResolvedValue({});
    sendEmailMock.mockResolvedValue(undefined);

    const result = await resendVerificationEmail('user-1', 'a@b.com');

    expect(result).toEqual({ ok: true });
    expect(sendEmailMock).toHaveBeenCalled();
  });

  it('rejects with retryAfterMs inside the cooldown window', async () => {
    prismaMock.emailVerificationToken.findUnique.mockResolvedValue({
      createdAt: new Date(Date.now() - 5_000),
    });

    const result = await resendVerificationEmail('user-1', 'a@b.com');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('sends again once the cooldown has elapsed', async () => {
    prismaMock.emailVerificationToken.findUnique.mockResolvedValue({
      createdAt: new Date(Date.now() - 120_000),
    });
    prismaMock.emailVerificationToken.upsert.mockResolvedValue({});
    sendEmailMock.mockResolvedValue(undefined);

    const result = await resendVerificationEmail('user-1', 'a@b.com');

    expect(result).toEqual({ ok: true });
    expect(sendEmailMock).toHaveBeenCalled();
  });
});

describe('consumeVerificationToken', () => {
  it('returns invalid for an unknown token', async () => {
    prismaMock.emailVerificationToken.findUnique.mockResolvedValue(null);

    await expect(consumeVerificationToken('nope')).resolves.toBe('invalid');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns expired for a token past its expiresAt, without consuming it', async () => {
    prismaMock.emailVerificationToken.findUnique.mockResolvedValue({
      userId: 'user-1',
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(consumeVerificationToken('stale')).resolves.toBe('expired');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('marks the user verified and deletes the token on success', async () => {
    prismaMock.emailVerificationToken.findUnique.mockResolvedValue({
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 1000),
    });
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.emailVerificationToken.delete.mockResolvedValue({});

    await expect(consumeVerificationToken('good')).resolves.toBe('verified');
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
    expect(prismaMock.emailVerificationToken.delete).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });
});

describe('getEmailVerificationStatus', () => {
  it('reports verified true when emailVerified is set', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ emailVerified: new Date() });

    await expect(getEmailVerificationStatus('user-1')).resolves.toEqual({
      verified: true,
      configured: true,
    });
  });

  it('reports verified false when emailVerified is null', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ emailVerified: null });

    await expect(getEmailVerificationStatus('user-1')).resolves.toEqual({
      verified: false,
      configured: true,
    });
  });
});
