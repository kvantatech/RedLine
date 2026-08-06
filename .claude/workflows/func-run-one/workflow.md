# Workflow: func-run-one

**Type:** Core workflow #4 — "run + judge", functional edition / **Trigger:** manual · dashboard · cron (later) / **Status: LIVE (2026-07-08)**

Labels as in perf-run-one: `[DET]` deterministic · `[MODEL]` earns a model call · ★ subagent.

## Inputs

```
team      — e.g. "redline-dashboard"
env       — "local" | "stg"        (PROD is forbidden for functional suites — hard rule)
run_id    — e.g. "redline-dashboard_functional_local_20260708T143022Z"
trigger   — "cron" | "deploy" | "manual"
deploy_sha — (deploy trigger only)
```

`profile` is always `functional` — it fills the profile slot in run_id, ledger, and dedupe key.

## O0 — idempotency gate

- **[DET] run-ledger (CHECK mode)** — `suite: "functional"`; `script_sha` = suite hash
  (config + sorted specs, see run-ledger SKILL). `action=skip` → return prior result, STOP.
  `action=fail` → invalid path, STOP. Else carry `dedupe_key` + shas forward.

## Steps (recipe)

1. **[DET] run-playwright-suite** — path guard (`envs/` or `workbench/` only), prod-gate (reject), run
   `npx playwright test --reporter=json` → `reports/<run_id>/results.json`.
   Crash (exit ∉ {0,1} or results.json missing) → `run-error.txt`, ledger FAILED, STOP.
2. **[DET] parse-playwright-summary** — `parse.mjs` → `reports/<run_id>/contract.json`.
   Fails closed → ledger FAILED, STOP.
3. **[DET] func-verdict** — `verdict.mjs` → `reports/<run_id>/verdict.json` (green | red).
4. **[DET] corroborate-2-sources** — red only: ONE re-run of the failures (`--last-failed`)
   as `<run_id>_confirm` (bypasses O0 — result lives in the parent record).
   Confirm green → FLAKE, STOP. Confirm fail → cannot corroborate, STOP. Confirm red →
   `sources: 2`, continue.
4.5. **[MODEL] heal-playwright-suite** — corroborated red on an `envs/` (proven) suite only;
   workbench runs skip this (authoring has its own verify loop). Classifies each failure
   test-bug vs app-bug at the live failure point (`test_debug` + `browser_snapshot`), heals
   test-bugs in a **workbench copy** (≤2 rounds, green ×2 required), writes
   `reports/<run_id>/heal/` (heal-report.md + suite.diff). Never writes `envs/` — a human
   graduates the healed diff.
   - `HEALED` (all failures were test rot) → ledger (`heal: proposed`, jira_filed=false,
     no draft — there is no product bug to file). STOP.
   - `HEALED_AUTO` (team policy `trust` in `state/heal-policy.json`) → healed suite already
     graduated to `envs/` (files copied, NOT committed — the uncommitted diff is the audit
     surface) → ledger (`heal: auto_graduated`). STOP.
   - `PARTIAL` / `PARTIAL_AUTO` → continue to O5 **for the app-bug failures only**; healed
     test-bugs noted in the draft's evidence section.
   - `NOT_HEALABLE` / `NOT_HEALED` → continue to O5 unchanged.
5. **[MODEL] triage-func-verdict** — one narration line + templated draft → `jira-draft.md`.
6. **[MODEL] ★ reviewer** — spawned in a **fresh context** (anti-anchoring). Reads verdict +
   contract + draft **for BOTH runs** (`reports/<run_id>/`, `reports/<run_id>_confirm/`);
   re-derives the verdict from raw pass/fail counts (Pass 1); independent quality judgment —
   is this failure worth a human's time (Pass 2); ticket quality (Pass 3). Writes
   `reviewer-decision.json` with `sources` copied from O4.
7. **[DET] file-perf-regression-jira** — same four gates: verdict ≠ green → SIGN_OFF →
   `sources ≥ 2` → 24h de-dupe (functional: `failures[0].test`). Default `mode=dry-run`;
   `mode=file` only on explicit per-draft human approval (hard rule).
8. **[DET] notify-responsible-team** — only after a real `filed:` result.

(No `link-grafana-panel` — functional runs don't export OTLP in v1; slot reserved.
No `curate-baselines` — functional has no baselines by design.)

## Live path

```
GREEN → print "GREEN — <summary_line>" + ledger record. STOP.
RED   → O4 corroborate (ONE confirmation re-run, failures only)
          → confirm green  → print "FLAKE — original red not reproduced (<both summary lines>)"
                             → ledger (overall_verdict=red, corroborated=false, sources=1,
                               consecutive_rejects += 1 — same-test flakes hit the 3-strikes
                               escalation like reviewer REJECTs do). STOP.
          → confirm crashed → print "CONFIRM CRASHED — infra issue" → ledger
                               (corroborated=false, confirm_verdict="crashed"). STOP.
          → confirm red (sources=2):
        → O4.5 heal (envs/ suites only)
          → HEALED       → print "HEALED — test rot repaired, diff awaits graduation
                            (reports/<run_id>/heal/)" → ledger (heal=proposed). STOP —
                            no Jira: nothing product-side broke.
          → HEALED_AUTO  → print "HEALED — test rot repaired and auto-graduated (team
                            policy: trust); review the uncommitted envs/ diff" → ledger
                            (heal=auto_graduated). STOP.
          → PARTIAL(_AUTO) → continue below for the remaining app-bug failures.
          → NOT_HEALABLE → continue below unchanged (real regression).
        → O5 triage-func-verdict → jira-draft.md
        → O6 reviewer (fresh context, .github/agents/reviewer.agent.md)
          → SIGN_OFF:        ledger (jira_filed=false, jira_draft=path). STOP (human files).
          → REJECT:          ledger (reviewer_decision=REJECT, streak += 1). STOP.
                             3-strikes: ≥3 consecutive REJECTs/flakes on the same test →
                             reviewer must treat it as real (persistent failure is signal).
          → REQUEST_CHANGES: re-run O5+O6 once (max 1 retry, budget +2) → ledger. STOP.
FAIL  → print "FAIL — <reason>" + ledger record. STOP.
```

## Model-call budget

**2** — `triage-func-verdict` (1 narration line) + `reviewer` (dual-pass) — **+1 bounded**
(`heal-playwright-suite`, ≤2 fix rounds) only on a corroborated red against a proven
`envs/` suite. Everything else [DET].

---

Skills referenced live in `.github/skills/`. Design: `docs/superpowers/specs/2026-07-08-playwright-functional-suite-design.md`.
