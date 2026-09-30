const LOCAL_URL = 'http://localhost:3000';

const withScheme = (host: string): string => `https://${host.replace(/\/$/, '')}`;

/**
 * The app's public origin, for absolute links that leave the app (emails).
 *
 * `NEXTAUTH_URL` wins when set. On Vercel it is usually unset (NextAuth
 * doesn't need it there), so this falls back to Vercel's system env vars:
 * the production domain in production, the deployment's own URL on a
 * preview. localhost is only the last resort, for local dev.
 *
 * Deliberately never derived from the request's Host header: a spoofed Host
 * would let someone send a victim a verification link pointing at another
 * domain.
 */
export const appBaseUrl = (env: NodeJS.ProcessEnv = process.env): string => {
  if (env.NEXTAUTH_URL) return env.NEXTAUTH_URL.replace(/\/$/, '');
  if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return withScheme(env.VERCEL_PROJECT_PRODUCTION_URL);
  }
  if (env.VERCEL_URL) return withScheme(env.VERCEL_URL);
  return LOCAL_URL;
};
