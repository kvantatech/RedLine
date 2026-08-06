# corroborate-2-sources
> Confirm a red verdict with an independent re-run before it can escalate.

**Type:** skill (deterministic — re-executes O1–O3, no model call) · **Used by:** perf-run-one, perf-sweep, func-run-one · **Status:** LIVE (P3 — confirmation re-run; Grafana approach dropped)

## Prompt

You are the `corroborate-2-sources` skill. A single red run is never grounds to escalate —
it may be a flake (network blip, cold cache, noisy neighbor on STG). Before any red verdict
reaches triage, you **re-execute the same test once** and require the second run to also be
red. Two consecutive independent red runs = corroborated (`sources: 2`). A green second run
= flake; the red does not escalate (no triage, no reviewer, no Jira).

**Why re-run, not Grafana:** Grafana/Mimir holds the *same data* k6 exported via OTLP — a
second pipe, not a second sample. A confirmation re-run is a genuinely independent
measurement, uses only our own runner, and has zero external dependencies (no token, no
VPN-only endpoint, works on any runner).

**Inputs** (from the workflow, after O3 returned red):
- `run_id` — the original red run
- `team`, `profile`, `env` — same values the original run used
- `exit_code` — original run's exit code

### Steps

1. **Gate.** Read `reports/<run_id>/verdict.json`. If `overall_verdict != "red"` → return
   `{ "corroborated": false, "reason": "nothing to corroborate: verdict is <verdict>" }` and STOP.
   Only red needs confirmation.

2. **Build the confirmation run_id:** `<run_id>_confirm`. Never reuse the original run_id —
   artifacts must stay separate in `reports/`.

3. **Re-execute the O1–O3 chain** with identical inputs (same script, same baseline, same env):
   - `run-k6-script` → `reports/<run_id>_confirm/summary.json`
   - `parse-k6-json-summary` → `reports/<run_id>_confirm/contract.json`
   - `compare-to-baseline` → `reports/<run_id>_confirm/verdict.json`

   **Do NOT call run-ledger O0 for the confirmation run.** It is an internal step of this
   skill, not a new workflow entry — its dedupe_key would collide with the parent run
   (same shas, same day_bucket) and be wrongly skipped. The confirmation result is recorded
   in the **parent run's** ledger record (`confirm_run_id`, `confirm_verdict`, `sources`).

**Functional runs** (parent `verdict.json` has `"suite": "functional"`): step 3 re-executes
the functional O1–O3 chain instead, re-running **only the failed tests**:

- `run-playwright-suite` with `extra_args: --last-failed` → `reports/<run_id>_confirm/results.json`
  (`--last-failed` needs Playwright ≥ 1.44 and reads the last-run marker from the suite's own
  `test-results/` output directory — resolved relative to the suite's `playwright.config.ts`,
  not the process cwd. The confirm re-run therefore MUST use the same `suite_path`/config as
  the parent run, with no intervening run of that same suite between parent and confirm.)
- `node .github/skills/parse-playwright-summary/parse.mjs … <run_id>_confirm …` → `contract.json`
- `node .github/skills/func-verdict/verdict.mjs …` → `verdict.json`

The verdict table (step 4) applies unchanged: red/red → `sources: 2`; red/green → flake;
red/fail → cannot corroborate. `no-baseline` cannot occur for functional runs.

4. **Compare the two verdicts:**

   | Original | Confirmation | Output |
   |---|---|---|
   | red | **red** | `corroborated: true`, `sources: 2` → escalate to O5 triage |
   | red | **green** | `corroborated: false`, `sources: 1`, reason `"flake: confirmation run green"` → STOP, no escalation |
   | red | **fail / no-baseline** | `corroborated: false`, `sources: 1`, reason `"confirmation run <verdict> — cannot corroborate"` → STOP, no escalation, no alert (crash = infra noise, not a performance signal; 3-strikes handles persistence) |

5. **Return:**
```json
{
  "corroborated": true | false,
  "sources": 1 | 2,
  "confirm_run_id": "<run_id>_confirm",
  "confirm_verdict": "red" | "green" | "fail" | "no-baseline",
  "confirm_summary_line": "<one line from the confirmation verdict.json>",
  "reason": "<only when corroborated: false>"
}
```

## Hard rules

- **Exactly one re-run.** Never best-of-three, never loop until red — that is p-hacking in
  reverse. One confirmation, deterministic table above, done.
- **The confirmation run uses the identical script + baseline shas.** If either file changed
  between the runs, abort with `"refused: script/baseline changed mid-corroboration"`.
  For functional runs the "script sha" is the suite hash (config + specs — see run-ledger);
  the no-baseline sha is constant by design.
- **A flake still leaves a trace:** the parent run's ledger record keeps
  `overall_verdict: "red"` with `corroborated: false` — the 3-strikes escalation counts these
  (persistent "flakes" on the same endpoint are a signal).
- **No model calls, no MCP.** This is two file reads, one k6 re-run, and a table lookup.
- **PROD:** the re-run inherits the original run's prod constraints (1-VU benchmark +
  operator token only, hard rule 2). If the original ran on prod, the confirm run is subject
  to the same gate — token must still be present.
- **Functional confirm re-runs only the failures** (`--last-failed`) — a passing test that
  passed again adds no information; the failed set is the signal being corroborated.

## Tools

Read, Write, Bash (k6 re-run via the same `run-k6-script` path) — no MCP, no model calls.

## Data

- Reads: `reports/<run_id>/verdict.json`, `envs/<team>/<profile>/script.js`, `baselines/<team>.<profile>.json`
- Writes: `reports/<run_id>_confirm/` (summary.json, contract.json, verdict.json)

---
Frozen skill registry: `AGENTS.md` in this repo
(2026-06-10: semantics changed from Grafana corroboration to confirmation re-run — user decision; Grafana echoes the same OTLP data and is not an independent source.)
