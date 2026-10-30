import { expect, test } from '@playwright/test';

test('built baseline renders without remote requests or runtime errors', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const remoteRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4173') await route.continue();
    else {
      remoteRequests.push(url.origin);
      await route.abort();
    }
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Repository health' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Baseline established' })).toBeVisible();
  await expect(page.getByText('No GitHub account is connected.', { exact: false })).toBeVisible();
  await expect(page.getByText('Developer beta release approval is pending.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  expect(remoteRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('baseline.png'), fullPage: true });
});
