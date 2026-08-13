import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Every top-level route the dashboard's own nav exposes (from shell.js NAV + router).
const ROUTES = [
  { hash: '#home', name: 'Home' },
  { hash: '#tests', name: 'Tests' },
  { hash: '#insights', name: 'Insights' },
  { hash: '#runs', name: 'Executions' },
  { hash: '#schedules', name: 'Schedules' },
  { hash: '#projects', name: 'Projects' },
  { hash: '#run', name: 'Run test' },
  { hash: '#create', name: 'Create test' },
];

// WCAG 2.1 A + AA — the tags the Front-End Checklist accessibility rules map to.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

for (const route of ROUTES) {
  test(`a11y: ${route.name} (${route.hash})`, async ({ page }) => {
    await page.goto(`/${route.hash}`);
    // The SPA renders into #page after the module boots — wait for real content.
    await page.locator('#page').waitFor({ state: 'attached', timeout: 10_000 });
    await page.waitForTimeout(800); // let async fetches (runs/teams) settle

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    // Report every violation with the impacted node count — this is the payload.
    if (results.violations.length) {
      const lines = results.violations.map((v) =>
        `  [${v.impact}] ${v.id}: ${v.help} — ${v.nodes.length} node(s)`,
      );
      console.log(`\n${route.name} (${route.hash}) — ${results.violations.length} violation type(s):\n${lines.join('\n')}`);
    } else {
      console.log(`\n${route.name} (${route.hash}) — clean`);
    }

    // Gate on serious/critical only — moderate/minor are reported but don't fail.
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, `serious/critical a11y violations on ${route.name}`).toEqual([]);
  });
}
