# Workflow: perf-run-one

**Type:** Core workflow #2 — "run + judge" / **Trigger:** cron (daily trend, non-blocking) OR per-deploy / canary (blocking gate) / **Status: PARTIAL-LIVE (O0 run-ledger LIVE; O1–O9 live; O10 stub P5)**

A recipe is a fixed, ordered sequence of skills. Skills themselves live in `.github/skills/` and are referenced here by their character-exact registry name. `[DET]` = deterministic skill, no model call. `[MODEL]` = earns a model call. ★ = subagent.

## Inputs

```
team      — e.g. "demo-web"
profile   — e.g. "api-benchmark" | "browser-journey" | "load" | "spike" | "soak" | "stress"
env       — "stg" | "prod"
run_id    — unique string, e.g. "demo-web_api-benchmark_stg_20260609T143022Z"
trigger   — "cron" | "deploy"
deploy_sha — (deploy trigger only)
```

## O0 — idempotency gate (pre-step)

- **[DET] run-ledger (CHECK mode)** ✅ LIVE — idempotency gate. Call the skill in CHECK mode with `workflow`, `team`, `profile`, `env`, `trigger`, `script_path`, `baseline_path`, and `day_bucket` (cron/manual) or `deploy_sha` (deploy). The skill computes `script_sha`, `baseline_sha`, and `dedupe_key`, then scans the ledger.
  - Result `action=skip` → the run is already recorded `done` with the same code. **Return prior result. STOP.**
  - Result `action=proceed` → carry `dedupe_key`, `script_sha`, `baseline_sha` forward into the run.
  - Result `action=fail` → script or baseline path is invalid. **STOP with error.**
  - **Note:** a fix committed to the script changes `script_sha` → new `dedupe_key` → the run is NOT skipped. Dedupe only blocks identical re-fires on unchanged code.
  - Every "write ledger record" below means calling run-ledger in **WRITE mode** with a complete **record schema v1** line (`state/README.md`) — including `dedupe_key`, `script_sha`/`baseline_sha`, and `endpoints[]` per-endpoint p95 on green/red runs.

## Steps (recipe)

1. **[DET] run-k6-script** ✅ LIVE — validate inputs (path guard, prod-gate), detect script type (HTTP vs browser), run `k6 run --summary-export`, scrub HAR on browser runs. Outputs `reports/<run_id>/summary.json`.
   - Script path: `envs/<team>/<profile>/script.js`
   - On exit 97: write `run-error.txt`, mark FAILED, STOP
   - On any non-zero except 99: same

2. **[DET] parse-k6-json-summary** ✅ LIVE — parse k6 v2 JSON summary into canonical contract shape `{ run_id, started_at, duration_s, vu_max, iterations, checks, endpoints[p50/p95/p99/error_rate], errors }`. Fails closed on k6 < 2.0 or malformed. Outputs `reports/<run_id>/contract.json`.

3. **[DET] compare-to-baseline** ✅ LIVE — read `contract.json` + `baselines/<team>.<profile>.json` → apply compare-core verdict rules → write `reports/<run_id>/verdict.json`.
   - `no-baseline` verdict (file absent) → record in ledger, STOP gracefully — not an error
   - Outputs `overall_verdict`: `green` | `red` | `fail` | `no-baseline`

4. **[DET] corroborate-2-sources** ✅ LIVE (2026-06-10 — **confirmation re-run**, Grafana approach dropped) — a red verdict triggers exactly ONE re-execution of O1–O3 with identical script/baseline under `<run_id>_confirm`. Both red → `corroborated: true, sources: 2` → proceed to O5. Confirmation green → flake: record in parent ledger record (`corroborated: false`), STOP — no triage, no Jira. Confirmation fail/no-baseline → cannot corroborate, STOP. **The confirm run does NOT pass through O0** (its dedupe_key would collide with the parent); its result lives in the parent record (`confirm_run_id`, `confirm_verdict`, `sources`).

5. **[MODEL] triage-perf-verdict** ✅ LIVE — draft the Jira regression text. Reads `verdict.json` + `contract.json` (and notes the confirmation run_id from O4); writes `reports/<run_id>/jira-draft.md`. ONE model narration line; rest is templated.

6. **[MODEL] ★ reviewer** ✅ LIVE — independent dual-pass judgment. **Must be spawned in a fresh context window** (not inline) to preserve anti-anchoring. Reads verdict + contract + jira-draft + baseline **+ the confirmation run's verdict/contract** (`reports/<run_id>_confirm/`); re-derives verdict from raw numbers of BOTH runs (Pass 1); independent quality judgment (Pass 2); ticket quality check (Pass 3). Writes `reviewer-decision.json` with machine-checkable `sources` copied from O4 output (2 = confirmed by re-run; 1 = unconfirmed — O4 skipped or legacy). If the two runs disagree wildly in magnitude (both red but deltas differ > 2×), reviewer may REQUEST_CHANGES to flag instability.

7. **[DET] link-grafana-panel** ✅ LIVE (P3 — pure URL-builder, no token) — deep-link to the LGTM `Perf - <team>` dashboard (`/d/perf-<team>/perf-<team>`) filtered to `var-run_id` (+ `<run_id>_confirm` when corroborated) over the run window (start−60s → end+60s); fills `grafana_url` into `jira-draft.md` **before** any filing and feeds the Slack alert. Skips (empty url) when the run didn't export (`OBSERVE != 1`).

8. **[DET] file-perf-regression-jira** ✅ LIVE (P3) — post to Jira (Jira MCP). Four deterministic gates, in order: verdict != green → `decision == "SIGN_OFF"` → `sources >= 2` (P1-era 1-source sign-offs are never auto-filed) → 24h de-dupe (team + endpoint, via ledger). Default `mode=dry-run` (prints payload, files nothing); **`mode=file` only on explicit human approval per draft** (hard rule 10). Filing appends a `type:"jira-filing"` ledger line. Smoke-proven 2026-06-10: RED-SIM-001 → `refused: 1-source`; RED-SIM-002 (2-source fixture) → payload assembled, not filed.

9. **[DET] notify-responsible-team** ✅ LIVE (P3) — one-line ping to the owning team's Slack channel via **incoming webhook** (`state/team-channels.json` maps team → `webhook_env`), only after a real `filed:` result — never on dry-run/skip/refusal. Permanent webhook pending JAD-100; until the env var is set the skill returns the composed line as `skipped: webhook unavailable` for manual paste.

10. **[DET] curate-baselines** 🔲 STUB (P5) — 7-day drift → open a baseline-bump PR. At P1: write `curate-note.txt` + append ledger record.

## Branching / gates

```
O0 idempotency check → dup? STOP
O1 run-k6-script     → exit 97? STOP (FAILED)
O2 parse             → malformed? STOP (FAILED)
O3 compare           → no-baseline? record + STOP (graceful)
                     → GREEN  → emit PASS proof → ledger + report. STOP.
                     → RED    → O4 corroborate (ONE confirmation re-run, <run_id>_confirm)
                                  → confirm GREEN: flake — ledger (corroborated=false, sources=1). STOP.
                                  → confirm FAIL:  cannot corroborate — ledger (corroborated=false). STOP.
                                  → confirm RED (sources=2): O5 triage → O6 reviewer (fresh context)
                                       → SIGN_OFF: O10 curate → ledger. STOP. (Jira: human-gated P3)
                                       → REJECT:   ledger (reviewer_rejected=true). STOP.
                                       → REQUEST_CHANGES: re-run O5+O6 (max 1 retry) → curate/ledger. STOP.
                     → FAIL   → record FAILED in ledger. STOP.
```

**Live path:**
```
GREEN       → print "GREEN — <summary_line>" + write ledger record. STOP.
RED         → O4 corroborate-2-sources: re-run O1–O3 once as <run_id>_confirm
              → confirm green  → print "FLAKE — original red not reproduced (<both summary lines>)"
                                 → ledger (overall_verdict=red, corroborated=false, sources=1,
                                   consecutive_rejects += 1 — repeated same-endpoint flakes hit
                                   the 3-strikes escalation like reviewer REJECTs do). STOP.
              → confirm crashed → print "CONFIRM CRASHED — original red unconfirmed, infra issue"
                                 → ledger (overall_verdict=red, corroborated=false, sources=1,
                                   confirm_verdict="crashed"). STOP.
              → confirm red   → sources=2, continue:
            → O5 triage-perf-verdict → jira-draft.md
            → O6 reviewer (spawn fresh context from .github/agents/reviewer.agent.md)
              → SIGN_OFF:         → O10 curate-baselines (P1: curate-note.txt)
                                  → write ledger record (jira_filed=false, jira_draft=path). STOP (human files Jira).
              → REJECT:           write ledger record (reviewer_decision=REJECT,
                                  consecutive_rejects = prior streak for this endpoint + 1). STOP.
                                  **3-strikes escalation:** if consecutive_rejects >= 3 for the same
                                  endpoint, the noise-margin REJECT rule is overridden — reviewer must
                                  treat the regression as real (persistent sub-10% drift is a signal,
                                  not noise) and decide SIGN_OFF or REQUEST_CHANGES instead.
              → REQUEST_CHANGES:  re-run O5 with reviewer's named corrections → re-run O6 (max 1 retry).
                                  If resolved (SIGN_OFF): O10 curate → ledger. STOP.
                                  If still unresolved:    write ledger record (review_unresolved=true). STOP.
                                  Model-call budget: +2 on one REQUEST_CHANGES retry.
FAIL        → print "FAIL — exit_code=<n>" + write ledger record
no-baseline → print "NO-BASELINE — seed baselines/<team>.<profile>.json to enable compare" + write ledger record
```

## Model-call budget

**2** — `triage-perf-verdict` (1 narration line) + `reviewer` (dual-pass judgment). Everything else is `[DET]`.

## P1 GREEN execution example

```
team=demo-web  profile=api-benchmark  env=stg  trigger=cron
run_id=demo-web_api-benchmark_stg_20260609T143022Z

O0: not in ledger → proceed
O1: run-k6-script envs/demo-web/api-benchmark/script.js → exit 0, summary.json written
O2: parse-k6-json-summary → contract.json written (p95=662ms)
O3: compare-to-baseline baselines/demo-web.api-benchmark.json
    → GET /api/config: p95=662ms ≤ red(900ms)? YES → green
    → overall_verdict: green
    → verdict.json written
→ print "GREEN — GET /api/config p95=662ms (within threshold ≤900ms)"
→ ledger record written. STOP.
```

## P1 RED simulation example (run_id: demo-web_api-benchmark_stg_RED-SIM-001)

```
team=demo-web  profile=api-benchmark  env=stg  trigger=simulation
run_id=demo-web_api-benchmark_stg_RED-SIM-001

O0: not in ledger → proceed
O1: contract.json written (p95=1250ms — simulated)
O2: contract.json parsed ✓
O3: compare-to-baseline
    → GET /api/config: p95=1250ms > red(900ms) → red
    → overall_verdict: red
    → verdict.json written
O4: corroborate-2-sources (added 2026-06-10 — sim predates it; live runs re-execute here)
    → re-run O1–O3 as demo-web_api-benchmark_stg_RED-SIM-001_confirm
    → confirm red → corroborated: true, sources: 2
O5: triage-perf-verdict
    → narration: "GET /api/config p95 climbed to 1250ms (+350ms, +38.9% over 900ms threshold)"
    → jira-draft.md written
O6: reviewer (dual-pass)
    → Pass 1: p95_above_threshold=YES, margin=38.9%>10% YES, iterations=10 YES, errors=clean YES
    → Pass 2: real regression, 38.9% overshoot is user-perceptible on shell bootstrap
    → Pass 3: narration accurate, table complete, no invented data, neutral tone
    → decision: SIGN_OFF (sources=2 — confirmed by re-run)
    → reviewer-decision.json written
O10: curate-baselines (P1 stub)
    → RED run — no threshold bump (regression, not drift)
    → curate-note.txt written
→ ledger record written: overall_verdict=red, reviewer_decision=SIGN_OFF, jira_filed=false
→ print "RED — GET /api/config p95=1250ms (threshold 900ms, +350ms +38.9%) — jira-draft ready for human review"
```

---

Skills referenced live in `.github/skills/`. Full design: `AGENTS.md` in this repo
