import { flag } from 'flags/next';
import { vercelAdapter } from '@flags-sdk/vercel';

/**
 * Vercel-managed feature flag controlling demo mode: whether the demo
 * account's credentials are shown on /login, and whether the
 * /api/admin/reseed-demo cron route actually reseeds. Toggle it from the
 * Vercel dashboard (or `vercel flags set enable-demo`) — no redeploy, no
 * env var to edit. Create it once with `vercel flags create enable-demo`.
 */
export const enableDemoFlag = flag<boolean>({
  key: 'enable-demo',
  adapter: vercelAdapter(),
});

/**
 * Safe wrapper — the Flags SDK throws (not just resolves false) when flag
 * definitions aren't available (no `vercel dev`/prepared datafile, e.g.
 * local `next dev` or a build that hasn't run `vercel flags prepare`).
 * Demo mode is not something a login-page render or a cron job should
 * ever 500 over, so any evaluation failure is treated as "off".
 */
export const isDemoEnabled = async (): Promise<boolean> => {
  try {
    return await enableDemoFlag();
  } catch {
    return false;
  }
};
