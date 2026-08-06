# author-resilient-playwright
> The anti-flake playbook for authoring and healing Playwright suites — so a re-run on unchanged content passes.

**Type:** skill (reference / grounding) · **Used by:** spec-author, verify-playwright-suite · **Status:** LIVE (2026-07-09)

This is the Playwright twin of `learn-via-k6-docs`: the agent's own, owned resilience
knowledge. It is not vendored from anywhere — it distills Playwright's official
best-practices, the community skills (currents-dev/playwright-best-practices-skill,
testdino-hq/playwright-skill), and RedLine's own proven overlay-removal pattern (which
neither community skill covers). A suite that fails five minutes after it was authored,
on a page that did not change, is a defect of the **suite**, not the app — this skill is
how we stop that.

---

## Prompt

Apply every rule below when authoring (`spec-author`) or healing (`verify-playwright-suite`)
a functional suite.

### 1 — Locators: unique, role-first, and MEASURED

- Priority: `getByRole` → `getByLabel` / `getByText` → `getByTestId` → CSS (last resort).
  Role/label/text survive redesigns and pierce shadow DOM; CSS breaks on a class rename.
- **`exact: true` for any short label that is a substring of another name.** A role-name
  match is a substring by default, so `getByRole('link', { name: 'Hourly' })` also matches
  "Hourly Roles". This is the single most common authored flake.
- **Scope repeated content; never trust a broad locator to be unique.** Pages nest lists
  and render responsive (mobile + desktop) duplicates, so `.filter({ hasText })` or a bare
  `getByText` silently resolves to 2+ elements → `strict mode violation`. Prefer a unique
  role+exact-name locator over scoping through a container; use `.first()` only with a
  comment explaining why the first occurrence is the right one.
- **Measure before you commit — do not guess twice.** Before writing a locator, confirm it
  resolves to exactly one *visible* element on the live page: a throwaway `count()` /
  `isVisible()` probe, or `browser_generate_locator` (playwright-test MCP), which returns
  Playwright's own robust locator. Guessing a locator, watching it fail, and guessing again
  is the slow path; measure once.

### 2 — Overlays: delete the node, never gate on `isVisible()`

Cookie-consent banners and third-party chat widgets load **asynchronously**. A
point-in-time `if (await x.isVisible()) x.click()` races that load and silently misses it —
then the overlay sits on top of a real control and intercepts the click on a later run.
CSS hiding also loses: the widget injects its own `#id { …!important }` rule after yours.

**The fix is a fixture that removes the overlay nodes before every navigation.** A removed
node can't intercept and can't be re-styled. Every spec imports `{ test, expect }` from
`./fixtures`, not from `@playwright/test`:

```ts
// tests/fixtures.ts — overlay guard (anti-flake spine of every suite)
import { test as base, expect } from '@playwright/test';

// Verify each selector against the live accessibility snapshot; never guess them.
const OVERLAY_SELECTORS =
  '#chatWidgetWrapper, .chat-widget-wrapper, [role="dialog"][aria-label*="cookie" i]';

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript((selector) => {
      const kill = () => document.querySelectorAll(selector).forEach((el) => el.remove());
      const start = () => {
        kill();
        new MutationObserver(kill).observe(document.documentElement, { childList: true, subtree: true });
      };
      if (document.documentElement) start();
      else document.addEventListener('DOMContentLoaded', start);
    }, OVERLAY_SELECTORS);
    await use(page);
  },
});

export { expect };
```

Tailor `OVERLAY_SELECTORS` to the target site's real widgets, confirmed from a live
`browser_snapshot` — not from memory.

### 3 — Waits: web-first, never arbitrary

- Use auto-retrying web-first assertions: `await expect(locator).toBeVisible()`.
- A section that lazy-loads gets a longer assertion timeout — `toBeVisible({ timeout: 15000 })`
  — **not** a fixed `waitForTimeout`, **not** a retry, **not** `waitForLoadState('networkidle')`.
- `retries: 0` stays `0`. Flake detection is the workflow's `corroborate-2-sources` gate;
  never paper over a flake with Playwright retries.

### 4 — Classify failures honestly

| Symptom | Cause | Action |
|---|---|---|
| `… subtree intercepts pointer events` (chat/consent widget) | overlay | test bug → fix the `fixtures.ts` guard |
| `strict mode violation: resolved to N elements` | unscoped/substring locator | test bug → `exact: true` / scope / unique locator |
| element genuinely absent from the live DOM | the app changed | **app finding** → `test.fixme('…', …)` with a one-line comment naming what's missing; report it — never a silent pass, never a silent drop, never patch the app |

### 5 — Done bar

A suite is DONE only when it passes on **two consecutive runs**. A single green run does
not rule out the flake you just fixed.

---

## Tools

Read-only reference (no execution of its own). The consumers use: Bash (`npx playwright test`),
Playwright MCP (`browser_snapshot`, `browser_navigate`), and playwright-test MCP
(`browser_generate_locator`, `test_run`, `test_debug`).

## Data

- Reads: nothing at runtime — this skill is guidance the spec-author and verify-playwright-suite
  consult.
- Writes: nothing. The `fixtures.ts` template is copied into each `workbench/<team>/functional/tests/`.

## Hard rules

1. Overlays are removed, never CSS-hidden and never gated on a no-wait `isVisible()`.
2. Every locator is confirmed to resolve to exactly one visible element before it is committed.
3. `retries: 0` stays `0`; lazy content gets a web-first timeout, never `networkidle`.
4. A genuine app finding is `test.fixme()`'d with a comment — never faked green, never dropped.
