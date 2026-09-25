import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { isEmailConfigured, sendEmail } from '@/lib/email/brevo';

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

const hashToken = (rawToken: string): string => createHash('sha256').update(rawToken).digest('hex');

const verifyUrl = (rawToken: string): string => {
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return `${base}/api/auth/verify?token=${rawToken}`;
};

const verificationEmailHtml = (rawToken: string): string =>
  `<p>Confirm your email for Ledger by clicking the link below. It expires in 24 hours.</p>` +
  `<p><a href="${verifyUrl(rawToken)}">Verify email address</a></p>` +
  `<p>If you didn't create a Ledger account, you can ignore this email.</p>`;

export const isEmailVerificationConfigured = (): boolean => isEmailConfigured();

/**
 * Issues a fresh token (replacing any existing one for this user — a token
 * row is `@unique` on `userId`) and emails it. Failures are thrown, not
 * swallowed here: whether a caller treats a provider outage as fatal (a
 * dedicated "resend" click) or best-effort (signup shouldn't fail because
 * Brevo is down) is the caller's call, not this function's.
 */
export const issueAndSendVerificationEmail = async (
  userId: string,
  email: string,
): Promise<void> => {
  if (!isEmailVerificationConfigured()) {
    return;
  }

  const rawToken = randomBytes(TOKEN_BYTES).toString('hex');
  await prisma.emailVerificationToken.upsert({
    where: { userId },
    create: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
    update: { tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  });

  await sendEmail({
    to: email,
    subject: 'Verify your Ledger email address',
    html: verificationEmailHtml(rawToken),
  });
};

export type ResendResult = { ok: true } | { ok: false; retryAfterMs: number };

/**
 * Resend is a common, expected outcome, not an exception — a cooldown hit
 * returns a discriminated result instead of throwing, same shape as the AI
 * suggestion path's provider-outage handling.
 */
export const resendVerificationEmail = async (
  userId: string,
  email: string,
): Promise<ResendResult> => {
  const existing = await prisma.emailVerificationToken.findUnique({ where: { userId } });
  if (existing) {
    const elapsed = Date.now() - existing.createdAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      return { ok: false, retryAfterMs: RESEND_COOLDOWN_MS - elapsed };
    }
  }

  await issueAndSendVerificationEmail(userId, email);
  return { ok: true };
};

export type ConsumeResult = 'verified' | 'invalid' | 'expired';

/**
 * Public by design — the link is clicked from an email client with no
 * session cookie. Token validity is the only credential; a valid, unexpired
 * token proves control of the mailbox regardless of the browser it's opened
 * in.
 */
export const consumeVerificationToken = async (rawToken: string): Promise<ConsumeResult> => {
  const token = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (!token) {
    return 'invalid';
  }
  if (token.expiresAt.getTime() < Date.now()) {
    return 'expired';
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: token.userId }, data: { emailVerified: new Date() } }),
    prisma.emailVerificationToken.delete({ where: { userId: token.userId } }),
  ]);
  return 'verified';
};

export type EmailVerificationStatus = { verified: boolean; configured: boolean };

export const getEmailVerificationStatus = async (
  userId: string,
): Promise<EmailVerificationStatus> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerified: true },
  });
  return { verified: Boolean(user?.emailVerified), configured: isEmailVerificationConfigured() };
};
