import { test, expect } from '@playwright/test';

// The dashboard ships three themes (brass / canvas / void) chosen with a toggle in
// the rail; the choice is stored in localStorage and must survive a page reload.
const CSS_FOR: Record<string, string> = {
  brass: 'app.css',
  canvas: 'app-theme-canvas.css',
  void: 'app-theme-void.css',
};

test('theme choice persists across a reload and drives the stylesheet', async ({ page }) => {
  await page.goto('/');

  // Cycle the theme once and capture what it became.
  await page.locator('#themetoggle').click();
  const chosen = await page.evaluate(() => localStorage.getItem('redline-theme'));
  expect(chosen && CSS_FOR[chosen]).toBeTruthy();

  await page.reload();

  const after = await page.evaluate(() => localStorage.getItem('redline-theme'));
  expect(after).toBe(chosen);

  const href = await page.locator('#theme-css').getAttribute('href');
  expect(href).toContain(CSS_FOR[after as string]);
});
