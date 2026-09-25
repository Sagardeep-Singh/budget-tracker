import { defineConfig, devices } from '@playwright/test';

/**
 * The BYOK AI specs need the Next.js server's *outbound* provider calls pointed
 * at a local fixture (see tests/e2e/fixtures/ai-provider-server.ts) —
 * `page.route()` cannot reach those, since they happen server-side. The two
 * base URLs and the encryption master key are therefore supplied to the dev
 * server here. Both are test-only values; `SECRET_ENCRYPTION_KEY` below is a
 * throwaway, deliberately not a real secret.
 *
 * Heads up: `reuseExistingServer` is on outside CI, so a dev server you started
 * by hand gets reused *without* these vars — the AI specs would then try to
 * reach the real provider APIs. Stop any hand-started `npm run dev` before
 * running the suite.
 */
const AI_FIXTURE_PORT = Number(process.env.AI_FIXTURE_PORT ?? 4599);
const AI_FIXTURE_URL = `http://127.0.0.1:${AI_FIXTURE_PORT}`;
const E2E_SECRET_ENCRYPTION_KEY =
  process.env.SECRET_ENCRYPTION_KEY ?? 'ZTJlLW9ubHktdGhyb3dhd2F5LWtleS0zMmJ5dGVzISE=';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx tests/e2e/fixtures/ai-provider-server.ts',
      url: `${AI_FIXTURE_URL}/__control/health`,
      reuseExistingServer: !process.env.CI,
      env: { AI_FIXTURE_PORT: String(AI_FIXTURE_PORT) },
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      env: {
        AI_ANTHROPIC_BASE_URL: AI_FIXTURE_URL,
        AI_OPENAI_BASE_URL: AI_FIXTURE_URL,
        SECRET_ENCRYPTION_KEY: E2E_SECRET_ENCRYPTION_KEY,
        // The suite logs in as the same dev user across many specs — far more
        // attempts per run than the login/signup rate limiter (lib/auth/) is
        // meant to catch. Without this, a full run trips the limiter partway
        // through and every later spec is stuck on a disabled login form.
        E2E_DISABLE_RATE_LIMIT: '1',
      },
    },
  ],
});
