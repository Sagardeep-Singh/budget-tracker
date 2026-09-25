// Imported from `@auth/core/errors` rather than `next-auth` itself: the
// `next-auth` package index pulls in `next/server`, which breaks Vitest
// module resolution for anything that imports this file transitively
// (lib/auth/config.ts, tests/unit/lib/auth-config.test.ts).
import { CredentialsSignin } from '@auth/core/errors';

/** Surfaced when `lib/services/rateLimit.ts` rejects a login attempt. */
export class AuthRateLimitedError extends CredentialsSignin {
  code = 'rate_limited';
}
