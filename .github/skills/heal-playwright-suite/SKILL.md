# heal-playwright-suite
> Heal a PROVEN suite that broke in production use — locator/timing repairs only, proposed as a graduation diff, never masking a product bug.

**Type:** skill (MODEL bounded — ≤2 fix rounds) · **Used by:** func-run-one (O4.5, corroborated red only) · **Status:** LIVE (2026-07-17)

**Model-call justification (hard rule 4):** classifying a corroborated failure as test-bug vs
product-bug and rewriting a locator against the live DOM is open-ended judgment on unbounded
page structure — the same justification `verify-playwright-suite` carries at authoring time.
This skill extends that earned call to the proven tier, where Mabl-class competitors run
auto-healing continuously; without it a renamed button files a product-regression Jira.

---

## Prompt

A **graduated** suite in `envs/<team>/functional/` went corroborated-red (`sources: 2`).
Before the run escalates to a product-regression draft, decide: did the **product** break,
or did the **test** rot (selector drift, timing, new overlay)? Heal only the second kind.
Hard cap: **2 fix rounds** — production healing is more conservative than authoring's 3.

### 0 — Copy, never touch the proven tier

Copy `envs/<team>/functional/` → `workbench/<team>/functional-heal/`. Every edit below
happens in that copy. `envs/` is written only via graduation (hard rule 3) — this skill
**proposes**; a human graduates.

### 1 — Diagnose at the live failure point

For each corroborated failing test, in order of preference:

1. `test_debug` (playwright-test MCP) — run the failing test and pause at the failure:
   inspect the real page state at the exact failing step. This beats reading a stale
   report; the page you see is the page the test saw.
2. `browser_snapshot` (accessibility tree) on the failing flow — diff what the spec
   expects against what the tree actually holds now. The tree names what *moved*
   (role/name changed, section relocated) vs what is *gone*.
3. Classify, per test — same taxonomy as `verify-playwright-suite`:
   - **test bug** — element exists but the locator no longer resolves (renamed label,
     added duplicate, new overlay intercepting, lazy-load timing) → healable.
   - **app bug** — the element/feature is genuinely absent from the live DOM → NOT
     healable. Never `test.fixme()` here (that's authoring); the product path handles it.

**Every corroborated failure is an app bug → return `NOT_HEALABLE` immediately** — the
workflow continues to triage/reviewer/Jira unchanged. A healer that "fixes" tests around a
real regression is worse than no healer.

### 2 — Fix round (≤2 total, test-bug failures only)

The playbook is `author-resilient-playwright` — same rules as `verify-playwright-suite`
step 3, of which this is the production edition:

1. Prefer `browser_generate_locator` for the replacement — Playwright's own robust
   locator over hand-guessing. Measure it against the live DOM before writing it into
   the spec: exactly one *visible* match (`count()` / `isVisible()` probe).
2. Overlay intercepting → fix the overlay-guard fixture (delete the node in the
   init-script), not the individual test.
3. Timing → web-first assertion with explicit `{ timeout }`; **`retries: 0` stays `0`**.
4. Edit → run the healed copy (`npx playwright test -c workbench/<team>/functional-heal/playwright.config.ts --reporter=line`).
   One cycle per round.

### 3 — Prove it, then propose it (or graduate it, per policy)

- Healed suite must pass **twice consecutively** (one green run doesn't rule out the
  flake you just created).
- Write to `reports/<run_id>/heal/` (both policies):
  - `heal-report.md` — per test: classification, what changed on the page, old → new
    locator, rounds used.
  - `suite.diff` — `git diff --no-index envs/<team>/functional workbench/<team>/functional-heal`.
- The ledger `heal` object MUST include a **`plain`** field — 1–3 sentences for a
  non-technical reader (the dashboard shows this verbatim as the story of the heal):
  what changed on the page in everyday words ("the Start button moved into the
  Create-test page"), what was fixed, and what (if anything) still needs a person.
  No selectors, no file paths, no jargon.
  Full ledger shape: `heal: { outcome, policy, healed, escalated, diff, plain }`.
- Read the team's policy from `state/heal-policy.json` (`"<team>"` key, else `"default"`;
  missing or unparseable file → `ask`. Fail-safe: any doubt = `ask`).

**Policy `ask` (default):**
- **The healed copy stays in workbench.** A human reviews `suite.diff` in the dashboard
  and clicks Approve — the same human gate as any proven-tier change (hard rule 10).
- Return `HEALED` or `PARTIAL` (test-bugs healed, app-bugs listed — the workflow
  continues to triage for those).

**Policy `trust` (opt-in per team):**
- After green ×2, copy the healed suite over `envs/<team>/functional/` — this is a
  sanctioned graduation (green-verified, policy-opted), the same lifecycle moment as
  func-author's graduation step.
- **This skill itself NEVER `git commit`s**, under either policy. The uncommitted
  working-tree diff is the audit surface until a human acts.
- Return `HEALED_AUTO` or `PARTIAL_AUTO`.

**What happens after this skill returns (both policies):** the dashboard's run detail page
shows the plain-language story and one button — "Approve the fix" (`ask`) or "Review
complete — save this fix permanently" (`trust`). That click hits `POST
/api/heal/graduate`, deterministic server code (not this skill, not a model call), which
copies the file (ask only — trust already copied above) **and commits**, scoped to just the
healed suite's files. The target audience is non-technical: there is no terminal step. See
CLAUDE.md hard rule 3 for why this one commit path is sanctioned.

### 4 — Exhaustion

Still failing after round 2 → return `NOT_HEALED` with per-test root cause and what was
tried. The workflow continues to triage — an unhealable corroborated red is treated as
real.

---

## Tools

Bash (`npx playwright test`, `git diff`), Read, Write, Edit, playwright-test MCP
(`test_debug`, `browser_generate_locator`, `browser_verify_element_visible`), Playwright MCP
(`browser_navigate`, `browser_snapshot`, `browser_evaluate`) — no jira/slack/github.

## Data

- Reads: `envs/<team>/functional/` (copy source), `reports/<run_id>/` + `reports/<run_id>_confirm/` (failure evidence), `state/heal-policy.json` (ask | trust per team)
- Writes: `workbench/<team>/functional-heal/` (the healed copy), `reports/<run_id>/heal/` (report + diff); `envs/<team>/functional/` **only** under policy `trust` after green ×2 (graduation write, never committed)

## Hard rules

1. **2 rounds maximum.** Round 3 does not exist — production healing is conservative.
2. **Never heal around an app bug.** Element genuinely gone → `NOT_HEALABLE`, escalate — a
   healed test that hides a regression is the worst outcome this skill can produce.
3. **This skill never `git commit`s, under either policy.** `envs/` is written only as a
   policy-`trust` graduation after green ×2, or (under `ask`) not at all — the healed
   suite is a workbench proposal + diff. The commit happens later, only via an explicit
   human click in the dashboard (`POST /api/heal/graduate`) — see CLAUDE.md hard rule 3.
4. `retries: 0` stays `0` — a repair that needs retries is not a repair.
5. Triggered **only** on corroborated reds (`sources: 2`) — flakes never reach this skill
   (corroborate already filtered them).
6. **Fail-safe on policy:** unreadable/missing `state/heal-policy.json` or unknown value →
   behave as `ask`.

---
Complements `verify-playwright-suite` (authoring-time, workbench drafts) — this is the
proven-tier edition, one tier later in the same lifecycle. Playbook shared via
`author-resilient-playwright`.
