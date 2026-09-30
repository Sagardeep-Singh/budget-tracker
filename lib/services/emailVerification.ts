import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { isEmailConfigured, sendEmail } from '@/lib/email/brevo';
import { buildVerificationEmail } from '@/lib/email/verification-email';
import { appBaseUrl } from '@/lib/http/appUrl';
import { checkRateLimit, RateLimitedError } from '@/lib/services/rateLimit';

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
// The cooldown alone still allowed ~1,440 sends a day per user; this caps the
// Brevo quota one account can burn.
const RESEND_HOURLY_LIMIT = 5;
const RESEND_WINDOW_MS = 60 * 60 * 1000;

const hashToken = (rawToken: string): string => createHash('sha256').update(rawToken).digest('hex');

const verifyUrl = (rawToken: string): string => `${appBaseUrl()}/api/auth/verify?token=${rawToken}`;

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
    ...buildVerificationEmail({
      appUrl: appBaseUrl(),
      verifyUrl: verifyUrl(rawToken),
      hoursValid: TOKEN_TTL_MS / (60 * 60 * 1000),
    }),
  });
};

export type ResendResult = { ok: true } | { ok: false; retryAfterMs: number };

/**
 * Resend is a common, expected outcome, not an exception — a cooldown or
 * hourly-limit hit returns a discriminated result instead of throwing, same
 * shape as the AI suggestion path's provider-outage handling.
 *
 * The 60s cooldown is checked first so a click inside it doesn't use up one
 * of the hour's {@link RESEND_HOURLY_LIMIT} sends.
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

  try {
    await checkRateLimit('verify-resend:user', userId, RESEND_HOURLY_LIMIT, RESEND_WINDOW_MS);
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return { ok: false, retryAfterMs: error.retryAfterMs };
    }
    throw error;
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
