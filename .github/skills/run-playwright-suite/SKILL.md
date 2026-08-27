# run-playwright-suite
> Execute one team's Playwright functional suite and save the raw JSON results artifact.

**Type:** skill (deterministic) · **Used by:** func-run-one, corroborate-2-sources · **Status:** LIVE (2026-07-08)

---

## Prompt

You will execute a single Playwright functional suite and save its output. Follow these steps exactly.

### 1 — Validate inputs

Required inputs (caller must supply all three):
- `suite_path` — e.g. `live/redline-dashboard/functional` or `drafts/saucedemo-team/functional` (a directory containing `playwright.config.ts` and `tests/`)
- `run_id` — unique string, e.g. `redline-dashboard_functional_local_20260708T143022Z`
- `env` — `local` or `stg` (case-insensitive)

Optional:
- `extra_args` — extra CLI args (e.g. `--last-failed`, passed by corroborate-2-sources)

Reject and STOP if any of the following are true:
- `suite_path` does not start with `live/` or `drafts/` (absolute or `../` paths are forbidden)
- `<suite_path>/playwright.config.ts` does not exist
- `env` is `prod` — **functional suites NEVER run on PROD (v1 hard rule — no carve-out, stricter than k6)**
- `run_id` is empty or missing

**`drafts/` is a valid, first-class run location — not a fallback for a missing feature.**
A freshly-authored suite that never gets committed to `live/` is still a real, runnable suite;
"graduating" to `live/` only matters for putting a script under source control / CI, and is
never required just to see whether a test passes. Prefer `live/<team>/functional` when it
exists (it's the reviewed, committed version); otherwise run `drafts/<team>/functional`
directly — the caller decides which path to pass.

### 2 — Prepare the output directory

Create `reports/<run_id>/` if it does not exist.

### 3 — Run the suite

```powershell
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = "reports/<run_id>/results.json"
npx playwright test -c <suite_path>/playwright.config.ts --reporter=json <extra_args>
```

The suite's `webServer` config auto-starts the app under test — do not start it manually.
Capture stdout, stderr, and the exit code.

### 4 — Handle exit codes

| Exit code | Meaning | Action |
|-----------|---------|--------|
| 0 | all tests passed | Continue |
| 1 | ≥1 test failed | Continue — `parse-playwright-summary` will surface the failures |
| any other, OR `results.json` missing/empty | runner crash, config error, webServer failed to start | Write `reports/<run_id>/run-error.txt` with stderr; mark run as FAILED; STOP |

A broken runner is a **fail**, never a red — it must not enter the regression path.

### 5 — Artifacts (screenshots + traces, secret hygiene)

After the run, look in `test-results/` at the **repo root** — Playwright's default `outputDir`
resolves to `<nearest-package.json-directory>/test-results` — the repo root in this project's
layout — not relative to `<suite_path>`. (A suite that ships its own `package.json` would move
it; none do today.)

- **Screenshots** (`**/*.png`): copy each to `reports/<run_id>/artifacts/`, flattening the
  name to `<parent-dir-name>--<file>` so the test identity survives. Kept on BOTH envs —
  a screenshot of the failing page carries no auth headers and is the primary debugging
  artifact the dashboard's Results view shows.
- **Traces** (`**/trace.zip`) — the hygiene rule is UNCHANGED:
  - `env=local` → move them to `reports/<run_id>/traces/`.
  - `env=stg` → **DELETE them unconditionally** and write `reports/<run_id>/trace-note.txt`
    with `traces deleted (may embed auth headers; scrub step not yet live)` — the same
    interim rule `run-k6-script` applies to HARs.

### 6 — Return

Return `{ "results_path": "reports/<run_id>/results.json", "exit_code": <n> }`.

---

## Tools

Bash (`npx playwright test`), Read, Write — no MCP, no model calls.

## Data

- Reads: `live/<team>/functional/` or `drafts/<team>/functional/` (config + specs)
- Writes: `reports/<run_id>/results.json`, `reports/<run_id>/run-error.txt`, `reports/<run_id>/artifacts/`, `reports/<run_id>/traces/`, `reports/<run_id>/trace-note.txt`

## Hard rules

1. PROD is rejected before anything runs. No exceptions in v1.
2. Never persist a trace from a non-local env.
3. Exit 1 is a signal (test failures), not an error — only "other" codes are crashes.
