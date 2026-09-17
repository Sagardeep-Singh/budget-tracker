import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      /** UTC epoch ms of this token's last live, interactive Google
       * sign-in (including a `prompt: 'login'` re-auth) — `null` for a
       * credentials session or a Google session that hasn't refreshed
       * since. Only meaningful for a Google-only (no-password) account
       * deleting itself; see lib/services/accountDeletion.ts. */
      reauthenticatedAt: number | null;
    } & DefaultSession['user'];
  }
}
