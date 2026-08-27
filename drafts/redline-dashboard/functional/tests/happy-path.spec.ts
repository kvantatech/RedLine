import { test, expect, Page } from '@playwright/test';

// The RedLine dashboard forks at the Start screen into two suites — Functional
// (Playwright) and Performance (k6). These tests confirm that fork and the first
// screen of each path. The dashboard keeps its wizard state server-side, so every
// test returns to the Start screen first via the always-present "Start" rail step,
// which makes the tests independent of whatever suite a previous test selected.

async function gotoStart(page: Page) {
  await page.goto('/');
  await page.locator('#nav').getByRole('button', { name: /Start/ }).click();
  await expect(page.getByRole('heading', { name: 'What do you want to check?' })).toBeVisible();
}

test.describe('two-path dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStart(page);
  });

  test('start screen offers both the functional and performance paths', async ({ page }) => {
    // Each path card's accessible name carries its plain-language question.
    await expect(page.getByRole('button', { name: /Does it work\?/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Is it fast\?/ })).toBeVisible();
  });

  test('functional path reaches the describe-the-flow step', async ({ page }) => {
    await page.getByRole('button', { name: /Does it work\?/ }).click();
    await expect(page.getByRole('heading', { name: 'Check that your app works.' })).toBeVisible();
    await page.getByRole('button', { name: /Next/ }).click();
    await expect(page.getByRole('heading', { name: 'Describe the journey to check.' })).toBeVisible();
    await expect(page.getByPlaceholder('e.g. demo-web')).toBeVisible();
  });

  test('performance path reaches the set-up-or-run step', async ({ page }) => {
    await page.getByRole('button', { name: /Is it fast\?/ }).click();
    await expect(page.getByRole('heading', { name: 'Set up a test, or run one you have?' })).toBeVisible();
    await expect(page.getByText('Set up a new test')).toBeVisible();
    await expect(page.getByText('Run & judge a test')).toBeVisible();
  });
});
