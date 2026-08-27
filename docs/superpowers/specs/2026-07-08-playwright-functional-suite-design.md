# Design: Playwright functional suite — RedLine becomes a QA-eng agent

**Date:** 2026-07-08 · **Status:** APPROVED (brainstorming session, section-by-section)
**Decision trail:** pilot = local RedLine dashboard · red path = full parity with perf loop ·
full QA repositioning of docs · approach = "parallel suite, shared spine" (A).

## 1. Goal

Expand RedLine from a performance-engineering agent into a QA-engineering agent with **two
suites sharing one spine**: functional/automation (Playwright) and performance (k6). The
global `~/.claude/skills/playwright-tester/SKILL.md` is **decomposed** into RedLine-shaped
pieces (workflows + one-job skills + one justified subagent) — not moved in whole. RedLine's
AI-routing doctrine (`[DET]`/`[MODEL]`/`[MODEL grounded]`/`[MODEL bounded]`/`[HUMAN]` labels,
declared model budgets, corroborate-before-AI-spend, bounded fix loops) applies unchanged.

Rejected alternatives: (B) `suite` input forking inside perf-author/perf-run-one — 6 of 10
run steps would fork, re-introducing the branchy pattern the v1→v2 collapse removed;
(C) dropping playwright-tester in as one monolith skill — bypasses ledger, reviewer,
graduation, and mixes MODEL+DET in one unit.

## 2. Architecture

```
WORKFLOWS (.claude/workflows/)
│  PERFORMANCE (k6)                    FUNCTIONAL (Playwright)         ← new
│  perf-author · perf-run-one          func-author · func-run-one
│  perf-sweep · parity · onboarding    (fleet workflows later, after pilot)
│
└── SKILLS (.github/skills/)
      suite-specific (existing):        suite-specific (new):
      run-k6-script                     run-playwright-suite      [DET]
      parse-k6-json-summary             parse-playwright-summary  [DET]
      compare-to-baseline (p95)         func-verdict (pass/fail)  [DET]
      verify-k6-script                  verify-playwright-suite   [MODEL bounded]
      triage-perf-verdict               triage-func-verdict       [MODEL]
      k6-profile-* (5)                  (no profiles — one suite per team)
      │
      shared, reused as-is: run-ledger · corroborate-2-sources · scope-review ·
      explore-product-structure · scrub-har-secrets · open-draft-pr ·
      notify-responsible-team · file-perf-regression-jira
      │
      └── SUBAGENTS: reviewer (SHARED — judges both suites) ·
                     script-author (k6) · spec-author (Playwright)   ← new, 3rd subagent
                     │
                     └── DATA
                         live/<team>/functional/   ← specs as a profile-shaped folder
                         state/run-ledger.jsonl    ← same ledger + suite field
                         reports/<run_id>/         ← same layout & filenames
                         (no baselines for functional — verdict is pass/fail)
```

Baked-in decisions:
- Functional suites are a **profile-shaped folder** (`live/<team>/functional/`) so graduation,
  path guards, run_id conventions, and the ledger work unchanged.
- **Reviewer subagent is shared** — independent judgment on a drafted ticket is suite-agnostic.
- **`spec-author` is a new subagent** (3rd) — justified by the same clause as `script-author`:
  large-context generation. AGENTS.md's "only 2 qualify" becomes 3, justification in writing.
- Verdicts stay **green/red only**: all tests pass = green; any corroborated failure = red.
  No p95 baselines for functional — k6 owns performance.

## 3. Workflow: `func-author` (mirror of perf-author)

| # | Step | Label |
|---|---|---|
| 0 | `resolve-entry-mode` — author-first \| run-existing | `[HUMAN]` |
| 1 | `explore-product-structure` — live Playwright MCP pass: confirm flows, discover locators that resolve, observe async/redirect states | `[MODEL grounded]` |
| 2 | `scrub-har-secrets` — if a HAR was captured | `[DET]` |
| 3 | ★ `spec-author` — generate `playwright.config.ts` + `tests/*.spec.ts` from live-confirmed locators | `[MODEL]` |
| 3a | `scope-review` — human confirms flows, exclusions, auth handling | `[HUMAN]` |
| 4 | `verify-playwright-suite` — run suite, fix ≤3 rounds, flakes corroborated not chased | `[MODEL bounded]` |
| 5 | `graduate-script` — `drafts/<team>/functional/` → `live/<team>/functional/` | `[DET]` |
| 6 | `open-draft-pr` — P5+, skipped in building phase | `[DET]` |

**Model-call budget: 1** (`spec-author`) **+ 2 bounded grounded helpers** — identical to
perf-author. No `apply-ws2-conventions` twin in v1: Playwright conventions (getByRole over
CSS, independent tests, one behavior per test, expect() on outcomes) live in the spec-author
prompt; a separate conventions skill appears only when a second consumer needs it.

## 4. Workflow: `func-run-one` (mirror of perf-run-one)

| # | Step | Label |
|---|---|---|
| O0 | `run-ledger` CHECK — dedupe key hashes tests dir + config | `[DET]` |
| O1 | `run-playwright-suite` — `npx playwright test --reporter=json` → `reports/<run_id>/results.json` | `[DET]` |
| O2 | `parse-playwright-summary` — canonical contract; fails closed on malformed/empty | `[DET]` |
| O3 | `func-verdict` — green \| red \| fail → `verdict.json` | `[DET]` |
| O4 | `corroborate-2-sources` — red → ONE re-run of failures only (`--last-failed`) as `<run_id>_confirm`; confirm pass → FLAKE, record, STOP; confirm fail → `sources: 2` | `[DET]` |
| O5 | `triage-func-verdict` — Jira draft, one narration line, rest templated | `[MODEL]` |
| O6 | ★ `reviewer` — shared, fresh context, dual-pass over BOTH runs' raw results | `[MODEL]` |
| O7 | `file-perf-regression-jira` — reused; four gates (≠green → SIGN_OFF → sources≥2 → 24h dedupe); dry-run default, filing human-gated | `[DET]` |
| O8 | `notify-responsible-team` — reused; only after a real filing | `[DET]` |

**Model-call budget: 2** — identical to perf-run-one (+2 on one REQUEST_CHANGES retry).
`link-grafana-panel` is skipped in v1 (no OTLP export from functional runs yet; slot reserved).
The `_confirm` run bypasses O0 (dedupe collision with parent); its result lives in the parent
ledger record — same rule as perf.

## 5. Data layer

- **Suite location:** `drafts/<team>/functional/` (authoring) → `live/<team>/functional/`
  (graduated). Self-contained: `playwright.config.ts` (`testDir: ./tests`, `webServer`/`baseURL`)
  + `tests/*.spec.ts`. `run-playwright-suite` enforces the same `live/`-only path guard as k6.
- **Dependencies:** new root `package.json`, sole devDependency `@playwright/test`;
  one `npx playwright install chromium`; `node_modules/` gitignored. One install serves all
  teams (`npx playwright test -c live/<team>/functional/playwright.config.ts`).
  The dashboard itself stays zero-dep and untouched.
- **Pilot:** team `redline-dashboard`; `webServer` auto-starts `node dashboard/server.mjs
  --no-open`; `baseURL: http://127.0.0.1:4242`.
- **Environments:** functional allows `env: local | stg`. **PROD is forbidden entirely for
  functional in v1** (stricter than k6's 1-VU benchmark carve-out; restated as a hard rule).
- **run_id:** `<team>_functional_<env>_<timestamp>` — "functional" occupies the profile slot.
- **Artifacts** (same filenames as perf → reviewer/filing skills need zero path changes):

```
reports/<run_id>/
  results.json               raw Playwright JSON reporter output
  contract.json              canonical parsed shape
  verdict.json               green | red | fail
  jira-draft.md              red path only
  reviewer-decision.json     red path only
reports/<run_id>_confirm/    corroboration re-run
```

- **Contract shape (O2):** `{ run_id, started_at, duration_s, tests_total, passed, failed,
  skipped, failures[{ test, file, error }] }`.
- **Ledger:** `state/run-ledger.jsonl` record schema v1 + `suite: "functional"` field
  (absent = k6; existing lines stay valid). Spec fix → new hash → new dedupe_key → run re-arms.
- **Traces/secrets:** `--trace on-first-retry`; traces can embed auth headers (same risk class
  as HARs). Local pilot: traces kept. Any suite pointing at staging with real auth: raw traces
  deleted after the run unless passed through a scrub step — the same interim rule
  `run-k6-script` applies to HARs today.

## 6. Error handling

Exit-code normalization, split exactly like the k6 pair: `run-playwright-suite` (O1) catches
crashes and STOPs before any verdict logic runs (as `run-k6-script` does for exit 97/other);
`func-verdict` (O3) maps clean runs to green/red:

| Playwright exit | Meaning | Verdict |
|---|---|---|
| 0 | all tests passed | **green** → ledger, STOP |
| 1 | ≥1 test failure | **red** → O4 corroborate |
| other / no `results.json` / zero tests found | runner crash, config error, webServer failed | **fail** → `run-error.txt`, ledger, STOP. A broken runner is not a regression — never enters the red path. |

- **Flake:** confirm re-run passes → `corroborated: false, sources: 1`, print FLAKE, STOP —
  zero model tokens. Repeated flakes of the same test increment the same `consecutive_rejects`
  streak as perf; at 3 strikes the noise rule is overridden — reviewer must treat it as a real
  signal (persistently flaky test earns a fix, not silence).
- **Reviewer:** SIGN_OFF → ledger + human-gated Jira draft; REJECT → ledger + streak;
  REQUEST_CHANGES → one retry max (+2 budget) → `review_unresolved` if still stuck.
- **Authoring:** `verify-playwright-suite` hard-stops at 3 rounds → FAIL + root cause +
  `[HUMAN]` gate. Diagnosis order: read failure output → Playwright MCP live pass on the
  failing flow → categorize **test bug vs app bug** → fix the right thing.

## 7. Doc repositioning (full QA shift)

- `CLAUDE.md` — identity: "**QA Engineering agent** — two suites: functional (Playwright) +
  performance (k6)"; tree diagram gains the functional column; hard rules amended:
  rule 2 + "functional suites never run on PROD (v1)"; rule 6 + functional verdict rule
  (all pass = green, any corroborated failure = red); rule 7 stays k6-only.
- `AGENTS.md` — subagent count 2 → **3**; `spec-author` justification in writing
  (large-context generation, same clause as `script-author`).
- `README.md` / `PRODUCT.md` — repositioned to two-suite QA agent.
- `baselines/README.md` — functional has no baseline files by design.

## 8. Dashboard UI redesign (added 2026-07-08 after spec review)

**FULL visual redesign** of the dashboard (Anton, 2026-07-08: "full redesign with 2 paths"),
**executed with the repo's `impeccable` skill** (`.github/skills/impeccable/`, v3.9.1 — its
flow reads PRODUCT.md/DESIGN.md and the existing tokens; canvas/void themes may be evolved,
not necessarily preserved verbatim).

- **Two-path information architecture:** the Start screen forks into the two suites —
  **Functional (Playwright)** and **Performance (k6)** — as the top-level choice. Everything
  downstream (wizard steps, status views, results cards) lives under one of the two paths.
- **Functional path wizard:** mirrors the k6 onboarding — team slug → what to test (URL +
  journey in plain words) → "Create the test" drives `func-author` headlessly (`claude -p`)
  exactly the way k6 authoring is driven today → first results as friendly pass/fail cards.
- **Status views:** runs/verdicts from both suites (suite badge + green/red), fed from the
  same ledger via the new `suite` field.
- **Order:** the redesign lands **before** the pilot proofs, so the pilot's functional suite
  is authored against the redesigned UI — the pilot then doubles as the redesign's regression
  net.

## 9. Verification (in build order)

1. **Fixture checks** — `parse-playwright-summary` + `func-verdict` get fixture-driven checks
   (green / red / crash / empty JSON) wired into the existing `tests/smoke.ps1` pattern.
   Fails-closed proven, not claimed.
2. **Pilot GREEN** — author the dashboard suite via `func-author` (human gates scope at 3a),
   graduate, `func-run-one` → green verdict recorded in the ledger.
3. **FUNC-SIM-001 RED** — deliberately broken fixture → corroborate → triage → reviewer →
   Jira draft in dry-run. Functional twin of RED-SIM-001.
4. **FLAKE-SIM** — once-failing test that passes on `--last-failed` → FLAKE path,
   `sources: 1`, zero model calls spent.

**Build order:** (1) root `package.json` + chromium · (2) the 8 new files — 5 skills
(`run-playwright-suite`, `parse-playwright-summary`, `func-verdict`,
`verify-playwright-suite`, `triage-func-verdict`), 1 subagent (`spec-author.agent.md`),
2 workflows (`func-author`, `func-run-one`) · (3) doc repositioning · (4) dashboard UI
redesign via `impeccable` (§8) · (5) pilot proofs against the redesigned UI.

**Expansion gate:** demo-web functional (or any real team) starts only after the pilot passes
and a human signs off — the same rule the perf loop lived by.
