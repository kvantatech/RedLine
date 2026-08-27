# verify-playwright-suite
> Validate → run → fix a drafted functional suite. Bounded rounds; flakes recorded, never chased.

**Type:** skill (MODEL bounded — ≤3 fix rounds) · **Used by:** func-author · **Status:** LIVE (2026-07-08)

---

## Prompt

You will verify a drafted Playwright suite in `drafts/<team>/functional/`. Hard cap:
**3 fix rounds**, then stop. The anti-flake playbook you apply while healing —
locators, the overlay-guard fixture, wait strategy, failure classification — is the
`author-resilient-playwright` skill; the fix-round steps below are its operational form.

### 1 — Run

```
npx playwright test -c drafts/<team>/functional/playwright.config.ts --reporter=line
```

All pass → return PASS with the summary line. Done.

### 2 — Corroborate before fixing (zero-token gate)

Any failure: re-run only the failures once — `npx playwright test -c <config> --last-failed --reporter=line`.
- Re-run passes → **flake**. Record it (test name + both outcomes) for the final report.
  During authoring a flaky test is a defect of the test: rewrite the wait/assertion to be
  deterministic — that rewrite counts as a fix round.
- Re-run fails → real failure → fix round.

### 3 — Fix round (≤3 total)

1. Read the failure output (expected vs actual, failing locator, page snippet).
2. Cause unclear → live Playwright MCP pass on the failing flow only:
   `browser_navigate` → `browser_snapshot` (accessibility tree) → `browser_click` to confirm
   the locator before writing it into the spec. (Shadow DOM: snapshot pierces it; prefer
   role/label locators which also pierce.) Where available, `browser_generate_locator`
   (playwright-test MCP) returns Playwright's own robust locator — prefer it over hand-guessing.
3. **Before rewriting a locator, MEASURE it against the live DOM — never guess twice.** A
   `strict mode violation: resolved to N elements` is an *unscoped locator*, not an app
   change: the page nests lists or renders responsive (mobile+desktop) duplicates. Confirm
   the replacement resolves to exactly one *visible* element (`count()` / `isVisible()`
   probe) before committing. Common deterministic fixes: add `exact: true` to a short label
   that substring-matches a longer name; drop a `.filter({ hasText })` that matches nested
   lists in favour of a unique role+exact-name locator; give a lazy-loading section a
   web-first `{ timeout }` instead of a retry.
4. **An overlay intercepting a click is a TEST bug, not an app bug.** `<div> … subtree
   intercepts pointer events` from a chat/consent widget → fix the suite's overlay guard
   (delete the node via the `fixtures.ts` init-script, don't CSS-hide it), then re-run.
5. Categorize explicitly: **test bug** (wrong/unscoped locator, timing, overlay, wrong
   expectation) → fix the spec. **App bug** (element genuinely absent from the live DOM) →
   `test.fixme()` with a one-line comment naming what's missing, then report it — never a
   silent pass, never a silent drop, never patch the app.
6. Edit → re-run (step 1). One cycle per round. A suite is only DONE when it passes on
   **two consecutive runs** — a single green run doesn't rule out the flake you just fixed.

### 4 — Exhaustion `[HUMAN]`

Still failing after round 3 → return FAIL with: failing tests, root cause per test,
test-bug/app-bug label, and what was tried. A human decides next.

---

## Tools

Bash (`npx playwright test`), Read, Write, Edit, Playwright MCP (`browser_navigate`,
`browser_snapshot`, `browser_click`, `browser_evaluate`) — no jira/slack/github.

## Data

- Reads/edits: `drafts/<team>/functional/` only — never `live/`.
- Writes: nothing outside the drafts suite.

## Hard rules

1. **3 rounds maximum.** Round 4 does not exist.
2. **Flakes are recorded, never dropped** — and during authoring, a flaky test gets rewritten, not retried.
3. **App bugs stop the loop** — verification fixes tests, not the product.
4. `retries: 0` stays `0` — never "fix" a failure by adding retries.
