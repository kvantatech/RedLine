# func-author — Workflow Recipe

**Type:** CORE workflow #3 ("write a new functional suite") / **Trigger:** manual · dashboard wizard / **Status: LIVE (2026-07-08)**

A recipe is a fixed, ordered sequence of skills (`.github/skills/`, character-exact names).
`[DET]` = deterministic, zero tokens. `[MODEL]` = earns a model call. `[MODEL grounded]` =
model call grounded in live tools. `[MODEL bounded]` = hard round limit. `[HUMAN]` = human gate.
★ = subagent. Doctrine source: perf-author / perf-run-one.

**Entry:** `resolve-entry-mode` — one question: `author-first | run-existing`.
(No `api | browser` fork — a functional suite is always browser-driven; k6 owns API perf.)
`run-existing` short-circuits to `func-run-one`.

## Steps (recipe)

0. [HUMAN] `resolve-entry-mode` — `author-first | run-existing`
1. [MODEL grounded] `explore-product-structure` — live Playwright MCP pass: confirm the flows
   work now, build the locator inventory (locators that actually resolve), observe
   async/loading/redirect states
2. [DET] `scrub-har-secrets` — only if a HAR was captured during exploration
3. [MODEL] ★ `spec-author` (SUBAGENT) — generate `playwright.config.ts` (retries: 0,
   webServer) + `tests/*.spec.ts` from the inventory → `workbench/<team>/functional/`
3a. [HUMAN] `scope-review` — agent presents flows covered, exclusions, auth handling,
   open questions; human confirms or redirects. **No verify rounds are spent until scope
   is approved.**
4. [MODEL bounded] `verify-playwright-suite` — run → corroborate failures → fix (≤3 rounds;
   app bugs stop the loop)
5. [DET] `graduate-script` — copy proven `workbench/<team>/functional/` →
   `envs/<team>/functional/`; extend the pre-commit `envs/` allow-list if needed.
   **Building phase only** — replaced by `open-draft-pr` when GitHub MCP (P5) is wired.
6. [DET] `open-draft-pr` — P5+; skipped in building phase (graduation IS delivery)

## Branching / gates

- **Scope gate [HUMAN] — step 3a:** flows, exclusions, auth placement. Redirected → revise
  and re-present before any verify round.
- **App-bug gate:** `verify-playwright-suite` stops on app bugs — authoring never patches
  the product silently.
- **Close-out:** graduation + `run-ledger` WRITE (`suite: "functional"`, authoring record)
  close the recipe.

## Model-call budget

**1 model call** (`spec-author`) **+ 2 bounded grounded helpers** (`explore-product-structure`,
`verify-playwright-suite`). Everything else is [DET]. Human gates: entry (0), scope (3a).

---

Skills referenced live in `.github/skills/`. Design: `docs/superpowers/specs/2026-07-08-playwright-functional-suite-design.md`.
