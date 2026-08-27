# run-ledger
> Append-only idempotency ledger — makes every run exactly-once and feeds all downstream consumers.

**Type:** skill (deterministic) · **Used by:** all workflows · **Status:** LIVE (P1)

## Prompt

You are the `run-ledger` skill. You have two entry points: **CHECK** (called at O0, before the run) and **WRITE** (called at the end of the run, after verdict is known). The calling workflow tells you which mode to use.

---

### Entry point A — CHECK (O0, before run)

**Inputs** (passed by the workflow):
- `workflow`, `team`, `profile`, `env`, `trigger` (`cron` | `deploy` | `manual`)
- `script_path` — e.g. `live/demo-web/api-benchmark/script.js`
- `suite` — `"k6"` (default when absent) | `"functional"`. For functional runs `script_path`
  is the suite directory (e.g. `live/redline-dashboard/functional`); `script_sha` is the
  SHA-256 of the concatenation of `playwright.config.ts` + every `tests/*.spec.ts` sorted
  by path (a spec fix → new sha → new dedupe_key → run re-arms). `baseline_path` is omitted:
  use the empty-string SHA-256 and note `no-baseline-by-design`.
- `baseline_path` — e.g. `baselines/demo-web.api-benchmark.json`
- `day_bucket` — ISO date `YYYY-MM-DD` (for cron/manual runs)
- `deploy_sha` — git SHA of the deploy commit (for deploy-triggered runs; omit for cron)

**Steps:**

1. **Compute `script_sha`**: SHA-256 of the file at `script_path`. Use the Read tool to read the file content, then compute SHA-256. If the file does not exist, return `{ "action": "fail", "reason": "script not found: <path>" }` — do not proceed. **Functional suites** (`suite: "functional"`): `script_path` is the suite directory — compute `script_sha` as the SHA-256 of the concatenation of `playwright.config.ts` + every `tests/*.spec.ts` sorted by path (read in that order, concatenate contents, hash once).

2. **Compute `baseline_sha`**: SHA-256 of the file at `baseline_path`. If the baseline file does not exist, use the empty-string SHA-256 (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`) and note `no-baseline`. **Functional suites:** `baseline_path` is omitted — use the empty-string SHA-256 and note `no-baseline-by-design`.

3. **Assemble the dedupe input string** (pipe-delimited, exact order):
   ```
   <workflow>|<team>|<profile>|<env>|<script_sha>|<baseline_sha>|<day_bucket OR deploy_sha>
   ```
   Use `day_bucket` for `trigger=cron` or `trigger=manual`; use `deploy_sha` for `trigger=deploy`.

4. **Compute `dedupe_key`**: SHA-256 of the assembled string above.

5. **Read `state/run-ledger.jsonl`** line by line. Look for any line where `dedupe_key` matches AND `status == "done"`.
   - **Match found** → return `{ "action": "skip", "run_id": "<prior run_id>", "verdict": "<prior verdict>", "dedupe_key": "<key>" }`. The workflow stops here and returns the prior result.
   - **No match** → return `{ "action": "proceed", "dedupe_key": "<key>", "script_sha": "<sha>", "baseline_sha": "<sha>" }`. The workflow continues to O1.

---

### Entry point B — WRITE (after verdict)

**Inputs** (passed by the workflow — all fields from CHECK plus run results):
- Everything from CHECK output (`dedupe_key`, `script_sha`, `baseline_sha`)
- `run_id` — the run identifier (e.g. `demo-web_api-benchmark_stg_20260610T131126Z`)
- `exit_code` — integer (0=green, 99=red, 97=crash)
- `overall_verdict` — `"green"` | `"red"` | `"fail"` | `"no-baseline"`
- `summary_line` — one-line human summary (e.g. `"GREEN — GET /api/config p95=829ms (threshold 1000ms)"`)
- `endpoints[]` — array of per-endpoint results (REQUIRED on green/red; empty array on fail/no-baseline):
  ```json
  { "name": "GET /api/config", "metric": "demo_web_config_health",
    "p95_ms": 829, "p95_red_ms": 1000, "verdict": "green" }
  ```
- `checks_passed`, `checks_failed` — integers
- `iterations` — integer (10 for standard benchmark/browser)
- `report_path` — path to the reports folder for this run
- **Red runs also require:**
  - `sources` — `1` at P1 (Grafana not yet wired); `2` at P2+
  - `consecutive_rejects` — read from the most recent ledger record for the same `team+profile+endpoint`; if no prior record exists, use `0`
  - `reviewer_decision` — `"SIGN_OFF"` | `"REJECT"` | `"REQUEST_CHANGES"` | `null` (if reviewer not yet called)
  - `jira_filed` — boolean (default `false`)
  - `jira_key` — string | `null`

**Steps:**

1. **Assemble the complete schema-v1 record** using ALL inputs above. Fields `schema`, `recorded_at` (current ISO 8601 timestamp), and `status: "done"` are added by this skill. For red runs: if `consecutive_rejects` is not provided by the caller, look up the most recent ledger line for the same `team + profile + endpoints[0].name` (k6) — or `team + profile + failures[0].test` for functional records, where `endpoints` is empty — where `reviewer_decision == "REJECT"` — count the consecutive streak from the bottom of the file; if the streak is broken by any non-REJECT record, reset to 0.

2. **Validate required fields** before writing:
   - `schema`, `run_id`, `dedupe_key`, `workflow`, `team`, `profile`, `env`, `trigger` — all must be present and non-null
   - `script_sha`, `baseline_sha` — must be 64-char hex strings
   - `endpoints[]` — must be a non-empty array on green/red **for k6 records**. For
     `suite: "functional"` records `endpoints: []` is valid; instead `tests_total`, `passed`,
     `failed` must be present, and red records must carry `failures[]` (name/file/error) —
     the 24h Jira dedupe and 3-strikes streak key on `failures[0].test` for functional.
     For k6 records an empty array remains valid only on `fail` or `no-baseline`.
   - On `overall_verdict == "red"`: `sources` must be an integer ≥ 1
   - If any required field is missing → return `{ "action": "fail", "reason": "missing field: <name>" }` and do NOT write

3. **Append** the record as a single minified JSON line to `state/run-ledger.jsonl`. Use the Write tool to append (read the current file first, append the new line, write back). Never rewrite or reorder existing lines.

4. Return `{ "action": "written", "run_id": "<run_id>", "dedupe_key": "<key>" }`.

---

## Hard rules

- **Append-only.** Never rewrite or delete prior lines. If a record has an error, add a new corrective line — never edit in place.
- **The dedupe_key is the only identity.** Two records with the same key are a bug (CHECK should have caught it). If a duplicate is detected at WRITE time, skip and return `{ "action": "skip", "reason": "duplicate key" }`.
- **Script fix → SHA changes → new key → runs again.** A changed script or baseline always produces a new dedupe_key, so re-runs after fixes are never blocked.
- **Cron dedupes per day per (workflow, team, profile, env, script, baseline).** One record per day is correct — re-triggers within the same UTC day on the same code collapse to the same key.
- **Deploy dedupes per deploy SHA.** Re-triggering CI on the same commit is a no-op.
- **Pre-v1 records** (before 2026-06-10) have no `schema` field — read them defensively; never update them.

## Tools

Read, Write (plain file I/O only — no MCP, no model call)

## Data

- Reads/writes: `state/run-ledger.jsonl`
- Reads (for SHA computation): `live/<team>/<profile>/script.js`, `baselines/<team>.<profile>.json`

## Downstream consumers and their field dependencies

| Consumer | Fields required |
|---|---|
| `curate-baselines` | `endpoints[].p95_ms`, `overall_verdict`, `recorded_at`, `team`, `profile` |
| `file-perf-regression-jira` | `endpoints[].name` (k6) / `failures[0].test` (functional) — 24h dedupe; `sources`; `reviewer_decision` |
| 3-strikes escalation (reviewer) | `consecutive_rejects`, `team`, `profile`, `endpoints[].name` (k6) / `failures[0].test` (functional) |
| O0 idempotency gate | `dedupe_key`, `status` |
| perf-sweep aggregate | `overall_verdict`, `run_id`, `team`, `profile`, `env` |

---
Frozen skill registry: `AGENTS.md` in this repo
