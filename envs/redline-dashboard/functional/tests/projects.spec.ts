import { test, expect } from '@playwright/test';

/**
 * redline-dashboard · projects
 *
 * navigation.spec.ts proves the Projects section renders at all; this file covers
 * what the page is FOR: every project the install knows about gets its own card, and
 * opening one reveals that project's own target/environment form. Before per-project
 * settings existed there was a single shared target, so "project A's card shows
 * project A's settings" is the behaviour worth protecting.
 *
 * READ-ONLY BY DESIGN. This suite runs against a live dashboard with the operator's
 * real config — a test that clicked Save would rewrite state/team-settings.json and
 * .env on the machine running it. Saving is covered instead by tests/team-settings.test.mjs,
 * which drives the same HTTP API against a throwaway repo root.
 */

test.describe('project settings', () => {
  test('every known project gets its own card', async ({ page }) => {
    await page.goto('/#projects');
    await expect(page.locator('[data-screen-label="Projects"]')).toBeVisible({ timeout: 15_000 });

    // The page is built from the same inventory the rest of the dashboard uses, so
    // a project with a baseline or a functional suite must appear here.
    const names = page.locator('.testname');
    await expect(names.first()).toBeVisible();
    const shown = await names.allTextContents();

    const res = await page.request.get('/api/settings');
    expect(res.ok()).toBeTruthy();
    const { teams, locked } = await res.json();
    expect(shown.map((s) => s.trim()).sort()).toEqual(teams.map((t: any) => t.team).sort());

    // Iterations/VUs are fixed by CLAUDE.md hard rule 7 — reported as locked, never
    // offered as a per-team field. If this ever becomes editable, this test should fail.
    expect(locked).toEqual({ iterations: 10, vus: 1, executor: 'per-vu-iterations' });
  });

  test('opening a project reveals its own target and environment form', async ({ page }) => {
    await page.goto('/#projects');
    await expect(page.locator('[data-screen-label="Projects"]')).toBeVisible({ timeout: 15_000 });

    const project = (await page.locator('.testname').first().textContent())?.trim();
    expect(project).toBeTruthy();

    await page.locator(`[data-edit="${project}"]`).click();

    // The field is keyed by project — that key IS the per-project isolation, so assert the
    // id rather than "some url input is visible".
    await expect(page.locator(`#u-${project}`)).toBeVisible();
    await expect(page.locator('.envpick').first()).toBeVisible();
    await expect(page.getByText('Your choice is authoritative')).toBeVisible();

    // Closing collapses it again — no other project's form is open underneath.
    await page.locator(`[data-edit="${project}"]`).click();
    await expect(page.locator(`#u-${project}`)).toHaveCount(0);
  });
});
