import { test, expect } from '@playwright/test';

const EMAIL = process.env.ADMIN_EMAIL ?? 'dev@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'devpassword123';

const login = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
};

const trigger = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /\w+ \d{4}$/ }).first();

const sheet = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: 'Period' });

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the period picker is still an anchored popover, not a sheet', async ({ page }) => {
    await login(page);
    await trigger(page).click();

    const presets = page.getByRole('button', { name: 'This month' });
    await expect(presets).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);

    const triggerBox = await trigger(page).boundingBox();
    const presetBox = await presets.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(presetBox).not.toBeNull();
    // Anchored under the trigger, not pinned to the bottom of the viewport.
    expect(presetBox!.y).toBeGreaterThan(triggerBox!.y);
    expect(presetBox!.y).toBeLessThan(triggerBox!.y + 200);
  });

  test('an outside click still closes the popover, and the page still scrolls', async ({
    page,
  }) => {
    await login(page);
    await trigger(page).click();
    await expect(page.getByRole('button', { name: 'This month' })).toBeVisible();

    // A hidden mobile sheet must not lock body scroll at desktop width.
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');

    await page.mouse.click(1100, 600);
    await expect(page.getByRole('button', { name: 'This month' })).toBeHidden();
  });
});

test.describe('mobile width', () => {
  test.use({ viewport: { width: 402, height: 874 } });

  test('the period picker opens as a bottom sheet with the same content', async ({ page }) => {
    await login(page);
    await trigger(page).click();

    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByRole('button', { name: 'This month' })).toBeVisible();
    await expect(sheet(page).getByRole('button', { name: 'Last month' })).toBeVisible();
    await expect(sheet(page).getByRole('button', { name: '07', exact: true })).toBeVisible();

    const box = await sheet(page).boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.x).toBe(0);
    expect(box!.width).toBe(viewport!.width);
    // Flush with the bottom edge.
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewport!.height - 1);
  });

  test('Escape closes the sheet and releases the scroll lock', async ({ page }) => {
    await login(page);
    await trigger(page).click();
    await expect(sheet(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });

  test('a backdrop tap closes the sheet', async ({ page }) => {
    await login(page);
    await trigger(page).click();
    await expect(sheet(page)).toBeVisible();

    await page.mouse.click(200, 40);
    await expect(sheet(page)).toHaveCount(0);
  });

  test('picking a month updates the URL and the trigger label', async ({ page }) => {
    await login(page);
    const year = new Date().getUTCFullYear();

    await trigger(page).click();
    await sheet(page).getByRole('button', { name: '01', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`month=${year}01`));
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: `January ${year}` })).toBeVisible();
  });
});
