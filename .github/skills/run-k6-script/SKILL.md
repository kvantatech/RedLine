# run-k6-script
> Execute one k6 script and save the raw JSON summary artifact.

**Type:** skill (deterministic) · **Used by:** perf-run-one, perf-sweep · **Status:** LIVE (P1)

---

## Prompt

You will execute a single k6 test script and save its output. Follow these steps exactly.

### 1 — Validate inputs

Required inputs (caller must supply all three):
- `script_path` — path to the .js script file
- `run_id` — a unique string identifier for this run (e.g. `demo-web_benchmark_stg_20260605T143022Z`)
- `env` — `stg` or `prod` (case-insensitive)

Reject and STOP if any of the following are true:
- `script_path` does not start with `envs/` (absolute or `../` paths are forbidden)
- The resolved file does not exist under the `envs/` directory
- `env` is `prod` AND the script is not a `benchmark` profile (1-VU benchmark is the only prod-allowed profile — check the filename for `benchmark` or check the caller's profile field)
- `run_id` is empty or missing

### 2 — Prepare the output directory

Create `reports/<run_id>/` if it does not exist. **Do this as part of the same command that
invokes k6** (step 4's `mkdir -p reports/<run_id> &&` prefix) — never as a separate step run
first, since a separate step is easy to skip and `k6 run --summary-export=...` fails outright
(cannot open the export path) if the directory isn't there yet.

### 3 — Detect script type

Inspect the script file for browser test indicators:
- `import { browser } from 'k6/browser'` — browser script
- `import { chromium } from 'k6/browser'` — browser script  
- Any other `.js` — HTTP script

### 4 — Build and run the k6 command

**HTTP script:**
```
mkdir -p reports/<run_id> && \
k6 run \
  --summary-export=reports/<run_id>/summary.json \
  --tag run_id=<run_id> \
  --tag env=<env> \
  <script_path>
```

**Browser script** (add env var for headless + HAR capture):
```
mkdir -p reports/<run_id> && \
K6_BROWSER_HEADLESS=true \
K6_BROWSER_HAR_EXPORT=reports/<run_id>/trace.har \
k6 run \
  --summary-export=reports/<run_id>/summary.json \
  --tag run_id=<run_id> \
  --tag env=<env> \
  <script_path>
```

Use the `k6 x mcp` tool to execute k6 commands when available. If the MCP tool is unavailable, fall back to a Bash call with the same command.

Capture stdout, stderr, and the exit code.

### 5 — Handle exit codes

| Exit code | Meaning | Action |
|-----------|---------|--------|
| 0 | All thresholds passed | Continue |
| 97 | k6 abort / crash (exit-97=FAIL per compare-core rule) | Write `reports/<run_id>/run-error.txt` with stderr; mark run as FAILED; STOP |
| 99 | Thresholds failed (k6 threshold violation) | Continue — `parse-k6-json-summary` will surface these |
| Any other non-zero | Unexpected error | Write `reports/<run_id>/run-error.txt` with stderr; mark run as FAILED; STOP |

> **Gate parity:** `run-k6-action` enforce mode also uses `exit_code_on_red: 99` (perf-gate.yaml). 99 always means "red verdict", 97 always means "crash" — on both delivery surfaces. 97 is never used to signal red.

### 6 — HAR scrub (ALL browser runs — unconditional)

If this was a browser script AND `reports/<run_id>/trace.har` exists (regardless of exit code):
- **P4+:** Pass the HAR file to the `scrub-har-secrets` skill before persisting anywhere. Save the scrubbed result as `reports/<run_id>/trace.scrubbed.har`. Delete the raw `trace.har`.
- **P1–P3 interim (scrub-har-secrets not yet live):** Delete `reports/<run_id>/trace.har` unconditionally. Do NOT persist a raw HAR. Record the deletion in `reports/<run_id>/run-error.txt` with note `HAR deleted (scrub-har-secrets not yet live at this phase)`.

If `K6_BROWSER_SCREENSHOTS_OUTPUT` was set and screenshots exist, save them under `reports/<run_id>/screenshots/`.

### 7 — Confirm output

Verify `reports/<run_id>/summary.json` exists and is valid JSON. If the file is missing or empty, mark the run as FAILED with an error message.

### 8 — Return

Return a summary object:
```json
{
  "run_id": "<run_id>",
  "script_path": "<script_path>",
  "env": "<env>",
  "exit_code": <n>,
  "status": "ok" | "failed",
  "summary_path": "reports/<run_id>/summary.json",
  "artifacts": ["reports/<run_id>/trace.scrubbed.har"]  // only if present
}
```

---

## Tools

- `k6 x mcp` — preferred executor (MCP, stdio)
- `Bash` — fallback if MCP unavailable

---

## Data

- **Reads:** `envs/<team>/<script>.js` (the test script; a plain in-repo folder by default, or a git submodule if the team is pinned to an external repo)
- **Writes:**
  - `reports/<run_id>/summary.json` — raw k6 JSON summary (primary output)
  - `reports/<run_id>/run-error.txt` — stderr on fatal exit (only on FAILED)
  - `reports/<run_id>/trace.scrubbed.har` — scrubbed HAR (browser scripts, any exit code; P4+)
  - `reports/<run_id>/screenshots/` — browser screenshots on failure (if captured)

---

## Hard rules

1. **REFUSE any `script_path` outside `envs/`** — no exceptions, no relative traversals. This is the
   operational + gate path, which runs only **proven/merged** scripts. In-flight authoring against a
   `workbench/**` script is a different path owned by `verify-k6-script` (see planning
   `agent/DELIVERY-MODEL.md` §2) — `run-k6-script` never runs a workbench script.
2. **Never retain the raw `.har` from any browser run.** At P4+ pass it through `scrub-har-secrets` (save scrubbed, delete raw). At P1–P3 delete the raw HAR unconditionally — no raw HAR may persist on disk at any phase.
3. **Exit code 97 = FAIL** — never treat a k6 abort as a successful (even threshold-failing) run.
4. **p95 is the percentile everywhere** — do not report or act on p50/p99 as the primary metric.
5. **PROD is 1-VU benchmark only** — if `env=prod` and the profile is not `benchmark`, refuse.

---

Frozen skill registry: `AGENTS.md` in this repo
