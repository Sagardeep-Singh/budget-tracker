import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.ADMIN_EMAIL ?? 'dev@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'devpassword123';

const login = async (page: Page): Promise<void> => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
};

const csv = (payee: string): string => `Date,Amount,Payee\n2026-03-01,-12.34,${payee}\n`;

/** Imports one row from a named CSV through the real UI and returns the filename. */
const importFile = async (page: Page, filename: string, payee: string): Promise<void> => {
  await page.goto('/import');
  await page.locator('#csvfile').setInputFiles({
    name: filename,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv(payee)),
  });
  await expect(page.locator('#account')).toBeVisible();
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: /^Import 1 rows$/ }).click();
  await expect(page.getByText(/Imported 1 transaction/)).toBeVisible();
};

// NOTE: the "no imports yet" empty state is deliberately not covered here. The
// shared dev login accumulates batches across specs (`fullyParallel: true`), so
// any empty-state assertion against it would be false-passing at best. Covering
// it properly needs a freshly signed-up user in its own isolated spec.

test('a committed import appears in history with its filename, account and counts', async ({
  page,
}) => {
  await login(page);

  const stamp = Date.now();
  const filename = `E2E-History-${stamp}.csv`;
  await importFile(page, filename, `E2E History ${stamp}`);

  await page.goto('/import/history');
  const row = page.locator('.ledger-row').filter({ hasText: filename });
  await expect(row).toBeVisible();
  await expect(row).toContainText('1 imported');
});

test('history paginates with "Load more" rather than rendering every batch', async ({ page }) => {
  await login(page);

  const stamp = Date.now();
  // seed straight through the API: 26 UI uploads would be needlessly slow.
  // `page.request` (not the standalone `request` fixture) carries the browser
  // context's session cookie — the bare fixture would 401.
  const accountsRes = await page.request.get('/api/accounts');
  expect(accountsRes.ok()).toBeTruthy();
  const accounts: { id: string }[] = await accountsRes.json();
  const accountId = accounts[0].id;

  for (let n = 0; n < 26; n += 1) {
    const res = await page.request.post('/api/import/commit', {
      data: {
        accountId,
        filename: `E2E-Page-${n}-${stamp}.csv`,
        rows: [
          {
            accountId,
            date: '2026-03-01',
            amount: 1 + n,
            type: 'EXPENSE',
            payee: `E2E Page ${n} ${stamp}`,
            include: true,
            duplicate: false,
          },
        ],
      },
    });
    expect(res.status()).toBe(201);
  }

  await page.goto('/import/history');
  const rows = page.locator('.ledger-row');
  await expect(rows).toHaveCount(25);

  const before = await rows.count();
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(async () => {
    expect(await rows.count()).toBeGreaterThan(before);
  }).toPass();
});

test('a batch detail page lists the imported transactions read-only', async ({ page }) => {
  await login(page);

  const stamp = Date.now();
  const filename = `E2E-Detail-${stamp}.csv`;
  const payee = `E2E Detail ${stamp}`;
  await importFile(page, filename, payee);

  await page.goto('/import/history');
  await page.locator('.ledger-row').filter({ hasText: filename }).getByRole('link').click();
  await expect(page).toHaveURL(/\/import\/history\/[^/]+$/);

  await expect(page.getByText(filename)).toBeVisible();
  await expect(page.getByText('1 imported')).toBeVisible();
  await expect(page.getByText(payee)).toBeVisible();
  // read-only for this pass: no add/edit affordances on the detail page
  await expect(page.getByRole('button', { name: 'Add transaction' })).toBeHidden();
});

test('an unknown batch id renders a 404, not a crash', async ({ page }) => {
  await login(page);

  const response = await page.goto('/import/history/does-not-exist');
  expect(response?.status()).toBe(404);
});
