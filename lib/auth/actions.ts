'use server';

import { headers } from 'next/headers';
import { signIn, signOut } from '@/auth';
import { AuthError } from 'next-auth';
import { createUser } from '@/lib/services/users';
import { signUpSchema } from '@/lib/validators/signup';
import { ServiceValidationError } from '@/lib/services/common';
import { checkRateLimit, RateLimitedError } from '@/lib/services/rateLimit';
import { clientIpFromHeaders } from '@/lib/http/clientIp';
import { AuthRateLimitedError } from '@/lib/auth/errors';

const TOO_MANY_ATTEMPTS = 'Too many attempts. Try again in a few minutes.';

// Account-creation abuse guard: bounds how many accounts one source can spin
// up, independent of the tighter per-login-attempt limits in
// lib/auth/config.ts (signup is a rarer action than login, so a looser
// window with a lower cap is enough).
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const SIGNUP_IP_LIMIT = 5;

// See lib/auth/config.ts's matching flag — same reasoning, the e2e suite
// creates far more accounts per run than any real signup source would.
const rateLimitDisabled = process.env.E2E_DISABLE_RATE_LIMIT === '1';

export const signOutAction = async (): Promise<void> => {
  await signOut({ redirectTo: '/login' });
};

export const signOutAfterPasswordChange = async (): Promise<void> => {
  await signOut({ redirectTo: '/login?passwordChanged=1' });
};

export const signOutAfterAccountDeletion = async (): Promise<void> => {
  await signOut({ redirectTo: '/login?accountDeleted=1' });
};

/**
 * Forces Google to re-show its authentication screen even when its own IdP
 * session cookie is still active — `prompt: 'login'` is what makes this a
 * real "prove you still control this account" step rather than a no-op
 * redirect that `select_account` alone would be. The `jwt` callback stamps
 * `token.reauthenticatedAt` on every completed Google sign-in, this one
 * included, which is what `deleteUserAccount` checks for a Google-only user
 * (lib/services/accountDeletion.ts).
 */
export const reauthenticateWithGoogleAction = async (): Promise<void> => {
  await signIn('google', { redirectTo: '/settings' }, { prompt: 'login' });
};

export const signInAction = async (
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> => {
  try {
    await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirectTo: '/dashboard',
    });
  } catch (error) {
    if (error instanceof AuthRateLimitedError) {
      return TOO_MANY_ATTEMPTS;
    }
    if (error instanceof AuthError) {
      return 'Incorrect email or password.';
    }
    throw error;
  }
};

export const signInWithGoogleAction = async (): Promise<void> => {
  await signIn('google', { redirectTo: '/dashboard' });
};

export const signUpAction = async (
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> => {
  const parsed = signUpSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? 'Check the form and try again.';
  }

  if (!rateLimitDisabled) {
    const ip = clientIpFromHeaders(await headers());
    try {
      await checkRateLimit('signup:ip', ip, SIGNUP_IP_LIMIT, SIGNUP_WINDOW_MS);
    } catch (error) {
      if (error instanceof RateLimitedError) {
        return TOO_MANY_ATTEMPTS;
      }
      throw error;
    }
  }

  try {
    await createUser(parsed.data);
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return error.message;
    }
    throw error;
  }

  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: '/dashboard',
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return 'Account created — sign in from the login page.';
    }
    throw error;
  }
};
