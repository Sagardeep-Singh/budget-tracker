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

test('the undo modal stays disabled until the filename is retyped, and cancelling clears it', async ({
  page,
}) => {
  await login(page);

  const stamp = Date.now();
  const filename = `E2E-Undo-Gate-${stamp}.csv`;
  await importFile(page, filename, `E2E Undo Gate ${stamp}`);

  await page.goto('/import/history');
  const row = page.locator('.ledger-row').filter({ hasText: filename });
  await row.getByRole('button', { name: 'Undo' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Undo import');
  await expect(dialog).toContainText('permanently delete 1 transaction');
  await expect(dialog).toContainText('recategorized, retyped as income or expense, or skipped');

  const confirm = dialog.getByRole('button', { name: 'Undo import' });
  const input = dialog.getByLabel('Type the filename to confirm');
  await expect(confirm).toBeDisabled();

  await input.fill(filename.slice(0, 5));
  await expect(confirm).toBeDisabled();

  // trim + case-insensitive, matching the app's single definition of "same filename"
  await input.fill(`  ${filename.toUpperCase()}  `);
  await expect(confirm).toBeEnabled();

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(row.getByRole('button', { name: 'Undo' })).toBeVisible();

  // reopening must not resurrect the typed text (fresh key remounts the modal)
  await row.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('dialog').getByLabel('Type the filename to confirm')).toHaveValue('');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Undo import' }),
  ).toBeDisabled();
});

// `page.request` throughout, not the standalone `request` fixture: only the
// former carries the logged-in browser context's session cookie.
test('confirming undo removes the transactions and marks the batch undone', async ({ page }) => {
  await login(page);

  const stamp = Date.now();
  const filename = `E2E-Undo-${stamp}.csv`;
  const payee = `E2E Undo ${stamp}`;
  await importFile(page, filename, payee);

  await page.goto('/transactions');
  await expect(page.getByText(payee)).toBeVisible();

  await page.goto('/import/history');
  const row = page.locator('.ledger-row').filter({ hasText: filename });
  await row.getByRole('button', { name: 'Undo' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Type the filename to confirm').fill(filename);
  await dialog.getByRole('button', { name: 'Undo import' }).click();
  await expect(dialog).toBeHidden();

  await expect(row).toContainText('Undone');
  await expect(row.getByRole('button', { name: 'Undo' })).toBeHidden();

  // the transactions are really gone, not just the batch flag flipped
  await page.goto('/transactions');
  await expect(page.getByText(payee)).toBeHidden();

  // batch detail shows the explicit removed-by-undo panel, never a 404
  await page.goto('/import/history');
  await page.locator('.ledger-row').filter({ hasText: filename }).getByRole('link').click();
  await expect(page.getByText('removed when this import was undone')).toBeVisible();

  const batchId = page.url().split('/').pop() ?? '';
  const undoAgain = await page.request.post(`/api/import/batches/${batchId}/undo`);
  expect(undoAgain.status()).toBe(409);
  expect((await undoAgain.json()).code).toBe('ALREADY_UNDONE');
});

test('undoing an unknown batch id is a 404, not a crash', async ({ page }) => {
  await login(page);

  const res = await page.request.post('/api/import/batches/does-not-exist/undo');
  expect(res.status()).toBe(404);
});
