import { test, expect, Page } from '@playwright/test';

// The RedLine dashboard forks at the Start screen into two suites — Functional
// (Playwright) and Performance (k6). These tests confirm that fork and the first
// screen of each path. The dashboard keeps its wizard state server-side, so every
// test returns to the Start screen first via the always-present "Start" rail step,
// which makes the tests independent of whatever suite a previous test selected.

async function gotoStart(page: Page) {
  // HEALED 2026-07-17 (run redline-dashboard_functional_local_20260717T174107Z):
  // the 2026-07-15 IA rework moved the wizard behind the "Create test" section —
  // the sections nav owns #nav now, and the wizard's Start step lives in the
  // "Wizard steps" rail inside #create. /Start/ matches both its "✓ Start" (done)
  // and "1 Start" (current) accessible names.
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Create test' }).click();
  await page.getByRole('navigation', { name: 'Wizard steps' }).getByRole('button', { name: /Start/ }).click();
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

  test('performance path reaches the environment-check step', async ({ page }) => {
    // HEALED 2026-08-06: the "Set up a test, or run one you have?" fork was
    // removed (see wizard.mjs — Create test authors a new test, the #run nav
    // entry operates an existing one), so the performance path now lands
    // straight on 'ready'. No Next click here: unlike func-intro (always
    // advanceable), 'ready' is gated on the k6 / Claude Code environment
    // checks, which a bare runner fails.
    await page.getByRole('button', { name: /Is it fast\?/ }).click();
    await expect(page.getByRole('heading', { name: "Let's set up performance testing for your team." })).toBeVisible();
    await expect(page.getByText('k6 — the tool that runs performance tests')).toBeVisible();
  });
});
