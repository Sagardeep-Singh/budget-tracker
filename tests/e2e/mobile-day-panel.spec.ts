import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 402, height: 874 } });

const EMAIL = process.env.ADMIN_EMAIL ?? 'dev@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'devpassword123';

// A month far enough back that it has no seeded or e2e-created transactions,
// so the empty-day state and the day-1/day-31 clamps are deterministic.
const QUIET_MONTH = 202001;

const login = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
};

const dayPanel = (page: import('@playwright/test').Page) => page.getByTestId('day-panel-mobile');

/**
 * Guarantees the current month isn't empty — the Overview's pre-existing
 * empty state replaces the card grid (and so the by-day chart) when it is.
 * Created through the desktop drawer, which is fixture setup, not the
 * subject, so the viewport is widened for it and restored afterwards.
 */
const ensureCurrentMonthHasData = async (page: import('@playwright/test').Page): Promise<void> => {
  const original = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add transaction' });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel('Payee').fill(`E2E Day Panel ${Date.now()}`);
  await drawer.locator('#amount').fill('6.50');
  await drawer.getByRole('button', { name: 'Save transaction' }).click();
  await expect(drawer).toBeHidden();

  if (original) await page.setViewportSize(original);
};

test('?day= turns the Day panel into the whole screen below lg', async ({ page }) => {
  await login(page);
  await ensureCurrentMonthHasData(page);

  await page.goto('/dashboard?day=12');
  await expect(dayPanel(page)).toBeVisible();

  // The Overview body (header, hero ring, by-day chart) collapses away.
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'By day' })).toBeHidden();
  await expect(page.getByTestId('day-panel-desktop')).toBeHidden();
});

test('the Overview stays intact when no ?day= is present', async ({ page }) => {
  await login(page);

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(dayPanel(page)).toHaveCount(0);
});

test('a day with nothing logged shows the empty state', async ({ page }) => {
  await login(page);

  await page.goto(`/dashboard?month=${QUIET_MONTH}&day=12`);
  await expect(dayPanel(page).getByText('Nothing logged this day.')).toBeVisible();
});

test('the back link clears ?day= and returns to the Overview', async ({ page }) => {
  await login(page);

  await page.goto(`/dashboard?month=${QUIET_MONTH}&day=12`);
  await dayPanel(page)
    .getByRole('link', { name: /Back to Overview/ })
    .click();

  await expect(page).toHaveURL(new RegExp(`/dashboard\\?month=${QUIET_MONTH}$`));
  await expect(dayPanel(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
});

test('prev/next step through days and clamp at both ends of the month', async ({ page }) => {
  await login(page);

  await page.goto(`/dashboard?month=${QUIET_MONTH}&day=12`);
  await dayPanel(page).getByRole('link', { name: 'Next day' }).click();
  await expect(page).toHaveURL(/day=13/);

  await dayPanel(page).getByRole('link', { name: 'Previous day' }).click();
  await expect(page).toHaveURL(/day=12/);

  // Clamping is on the href, so the link at an edge points back at that edge.
  await page.goto(`/dashboard?month=${QUIET_MONTH}&day=1`);
  await dayPanel(page).getByRole('link', { name: 'Previous day' }).click();
  await expect(page).toHaveURL(/day=1$/);
  await expect(dayPanel(page)).toBeVisible();

  // January has 31 days.
  await page.goto(`/dashboard?month=${QUIET_MONTH}&day=31`);
  await dayPanel(page).getByRole('link', { name: 'Next day' }).click();
  await expect(page).toHaveURL(/day=31$/);
  await expect(dayPanel(page)).toBeVisible();
});

test('the sticky "Log a spend" CTA is still reachable from the Day screen', async ({ page }) => {
  await login(page);

  await page.goto(`/dashboard?month=${QUIET_MONTH}&day=12`);
  const cta = page.getByRole('link', { name: /Log a spend/ });
  await expect(cta).toBeVisible();

  await cta.click();
  await expect(page.getByTestId('log-a-spend-mobile')).toBeVisible();
  // Pre-existing Phase 1 CTA behaviour: href="?overlay=add" replaces the whole
  // query string, so month/day are dropped and closing lands on the collapsed
  // Overview rather than back on the Day screen.
  await expect(page).toHaveURL(/\/dashboard\?overlay=add$/);
});

test('at desktop width ?day= leaves the Overview in place', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);

  await page.goto(`/dashboard?month=${QUIET_MONTH}&day=12`);
  // No collapse at lg: the Overview stays, and the full-screen mobile
  // presentation of the panel stays hidden. (A month with no data renders
  // the pre-existing Overview empty state instead of the card grid, so the
  // side panel itself isn't asserted here — see the current-month case.)
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByTestId('day-panel-mobile')).toBeHidden();
  await expect(page.getByRole('link', { name: /Back to Overview/ })).toBeHidden();
});

test('at desktop width the current month keeps the by-day chart and side panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await ensureCurrentMonthHasData(page);

  await page.goto('/dashboard?day=12');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'By day' })).toBeVisible();
  await expect(page.getByTestId('day-panel-desktop')).toBeVisible();
  await expect(page.getByTestId('day-panel-mobile')).toBeHidden();
});
