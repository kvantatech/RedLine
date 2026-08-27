import { test, expect } from '@playwright/test';

/**
 * redline-dashboard · navigation
 *
 * happy-path.spec.ts covers the wizard entry paths and theme.spec.ts covers theming;
 * neither asserts that every section in the left rail actually loads. This file is
 * that net — "a section stopped rendering" is the most user-visible way the
 * dashboard can break, and it is currently invisible to the suite.
 *
 * Locator strategy: each screen renders `data-screen-label` on its root <article>
 * (see dashboard/public/*.js). That attribute exists specifically to identify a
 * screen, so it is stable in a way a heading string or CSS class is not.
 *
 * Note on '#run' vs '#runs': shell.js matches the hash precisely so that
 * 'Run test' (#run) does not swallow 'Executions' (#runs). Both are asserted
 * below because that distinction is easy to break and silent when it does.
 */

// hash → the label in the rail, and the screen-label its renderer emits.
// screenLabel null = a wizard-driven section that carries its own step title,
// so we assert the main pane rendered instead.
const SECTIONS = [
  { hash: '#home',      nav: 'Home',        screenLabel: 'Home' },
  { hash: '#tests',     nav: 'Tests',       screenLabel: 'Tests' },
  { hash: '#insights',  nav: 'Insights',    screenLabel: 'Insights' },
  { hash: '#runs',      nav: 'Executions',  screenLabel: 'Results' },
  { hash: '#schedules', nav: 'Schedules',   screenLabel: 'Schedules' },
  { hash: '#run',       nav: 'Run test',    screenLabel: null },
  { hash: '#create',    nav: 'Create test', screenLabel: null },
];

test.describe('dashboard navigation', () => {
  test('the shell and the left rail render', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/RedLine/);
    await expect(page.locator('.wordmark')).toHaveText('RedLine');

    for (const { nav } of SECTIONS) {
      await expect(page.locator('#nav').getByText(nav, { exact: true })).toBeVisible();
    }
  });

  for (const { hash, nav, screenLabel } of SECTIONS) {
    test(`${nav} (${hash}) loads without error`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', (e) => consoleErrors.push(String(e)));

      await page.goto(`/${hash}`);

      // The rail marks the active section — proves the route resolved rather than
      // silently falling through to Home.
      await expect(page.locator('#nav').getByText(nav, { exact: true })).toBeVisible();

      if (screenLabel) {
        await expect(page.locator(`[data-screen-label="${screenLabel}"]`))
          .toBeVisible({ timeout: 15_000 });
      } else {
        await expect(page.locator('#page')).not.toBeEmpty({ timeout: 15_000 });
      }

      // A section that renders but throws is still broken.
      expect(consoleErrors, `console errors on ${hash}`).toEqual([]);
    });
  }

  test('Executions (#runs) is not swallowed by Run test (#run)', async ({ page }) => {
    await page.goto('/#runs');
    await expect(page.locator('[data-screen-label="Results"]')).toBeVisible({ timeout: 15_000 });

    await page.goto('/#run');
    await expect(page.locator('[data-screen-label="Results"]')).toHaveCount(0);
  });
});
