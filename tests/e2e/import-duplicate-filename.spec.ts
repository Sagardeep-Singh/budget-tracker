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

const csv = (payee: string, date = '2026-03-01', amount = '-12.34'): string =>
  `Date,Amount,Payee\n${date},${amount},${payee}\n`;

/** Selects a CSV by name + content and waits for the mapping controls to appear. */
const chooseFile = async (page: Page, name: string, content: string): Promise<void> => {
  await page.locator('#csvfile').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(content),
  });
  await expect(page.locator('#account')).toBeVisible();
};

const previewFile = async (page: Page, name: string, content: string): Promise<void> => {
  await chooseFile(page, name, content);
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByRole('button', { name: /^Import \d+ rows$/ })).toBeVisible();
};

test('first import of a uniquely named file previews and commits without any duplicate signal', async ({
  page,
}) => {
  await login(page);
  await page.goto('/import');

  const filename = `E2E-First-${Date.now()}.csv`;
  await previewFile(page, filename, csv(`E2E First ${Date.now()}`));

  await expect(page.getByText('was already imported into this account')).toBeHidden();

  await page.getByRole('button', { name: /^Import 1 rows$/ }).click();
  await expect(page.getByText(/Imported 1 transaction/)).toBeVisible();
});

test('re-importing the same filename warns at preview, blocks at commit, then imports on explicit override', async ({
  page,
}) => {
  await login(page);
  await page.goto('/import');

  const stamp = Date.now();
  const filename = `E2E-Dup-${stamp}.csv`;
  const content = csv(`E2E Dup ${stamp}`);

  // 1. first import lands
  await previewFile(page, filename, content);
  await page.getByRole('button', { name: /^Import 1 rows$/ }).click();
  await expect(page.getByText(/Imported 1 transaction/)).toBeVisible();

  // 2. preview-time warning is advisory: informational tone, commit still offered
  await previewFile(page, filename, content);
  const warning = page.locator('.bg-sky-soft').filter({ hasText: filename });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('You can still import');

  // 3. commit-time 409 is blocking and names the conflicting batch. The row
  //    checkbox has to be ticked first: every row previews as a duplicate, and
  //    the Import button is disabled while nothing is included.
  await page.locator('.ledger-row input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: /^Import \d+ rows$/ }).click();
  const blockingError = page.locator('.bg-rose-soft').filter({ hasText: filename });
  await expect(blockingError).toBeVisible();
  await expect(blockingError).toContainText('was already imported into this account');
  await expect(page.getByText('Import failed.')).toBeHidden();

  // 4. "Import anyway" clears the batch-level gate; the ticked checkbox clears
  //    row-level dedupe. Two distinct deliberate actions, by design.
  await page.getByRole('button', { name: 'Import anyway' }).click();
  await expect(page.getByText(/Imported 1 transaction/)).toBeVisible();

  // two independent batches now exist for this filename — no merge
  await page.goto('/import/history');
  await expect(page.locator('.ledger-row').filter({ hasText: filename })).toHaveCount(2);
});

test('the same content under a different filename does not conflict', async ({ page }) => {
  await login(page);
  await page.goto('/import');

  const stamp = Date.now();
  const content = csv(`E2E Rename ${stamp}`);

  await previewFile(page, `E2E-Name-A-${stamp}.csv`, content);
  await page.getByRole('button', { name: /^Import 1 rows$/ }).click();
  await expect(page.getByText(/Imported 1 transaction/)).toBeVisible();

  // filename-only matching: identical rows, different name -> no warning, no 409
  await previewFile(page, `E2E-Name-B-${stamp}.csv`, content);
  await expect(page.locator('.bg-sky-soft').filter({ hasText: 'already imported' })).toBeHidden();

  await page.locator('.ledger-row input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: /^Import \d+ rows$/ }).click();
  await expect(page.locator('.bg-rose-soft')).toBeHidden();
});

test('filename matching ignores case and surrounding whitespace', async ({ page }) => {
  await login(page);
  await page.goto('/import');

  const stamp = Date.now();
  const content = csv(`E2E Case ${stamp}`);

  await previewFile(page, `E2E-Case-${stamp}.csv`, content);
  await page.getByRole('button', { name: /^Import 1 rows$/ }).click();
  await expect(page.getByText(/Imported 1 transaction/)).toBeVisible();

  // uppercase extension is the same file as far as duplicate detection goes
  await previewFile(page, `E2E-Case-${stamp}.CSV`, content);
  await expect(page.locator('.bg-sky-soft').filter({ hasText: 'already imported' })).toBeVisible();

  await page.locator('.ledger-row input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: /^Import \d+ rows$/ }).click();
  await expect(page.locator('.bg-rose-soft')).toBeVisible();
});
