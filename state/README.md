# state/ — durable agent state

Holds the agent's durable, machine-readable state. The primary artifact is the
**run ledger**, owned by the `run-ledger` skill (LIVE since P1).

## `run-ledger.jsonl` — append-only run ledger

One JSON object per line (JSON Lines). **Append-only**: never rewrite or
reorder existing lines. Each line records one performance run and its verdict.
The file is committed (it is durable state, not transient output).

The ledger is read and written **only** through the `run-ledger` skill
(`.github/skills/run-ledger/SKILL.md`), which has two entry points:

- **CHECK** — called at O0 before a run: computes `script_sha`, `baseline_sha`,
  and `dedupe_key`, scans the ledger, and returns `skip` (already recorded
  `done` on identical code), `proceed`, or `fail`.
- **WRITE** — called after the verdict: validates the schema-v1 record and
  appends it as one minified JSON line.

> JSONL has no comment syntax — the file contains data lines only. This README
> is the schema documentation.

### Dedupe key

Every run carries a `dedupe_key` so the same logical run is recorded once. It is
the SHA-256 of a fixed field ordering:

```
dedupe_key = sha256(
    workflow + team + profile + env + script_sha + baseline_sha + (day_bucket | deploy_sha)
)
```

- `workflow`     — which workflow produced the run (e.g. `pre-merge-perf-gate`).
- `team`         — owning team (e.g. `demo-web`).
- `profile`      — load profile (e.g. `benchmark`).
- `env`          — environment (e.g. `stg`).
- `script_sha`   — content hash of the k6 script that ran.
- `baseline_sha` — content hash of the baseline file used for classification.
- `day_bucket | deploy_sha` — **the last component is one or the other:**
  - **scheduled / nightly** runs use `day_bucket` (e.g. `2026-06-05`) so one run
    per day per (workflow, team, profile, env, script, baseline) is recorded.
  - **deploy-triggered** runs use `deploy_sha` so each distinct deploy is
    recorded once (idempotent re-triggers collapse to the same key).

The `run-ledger` skill computes this key (including `script_sha` / `baseline_sha` —
the SHA-256 of the script file and baseline file as run) and skips appending a
duplicate line.

### Record schema (v1 — required for every new line)

```jsonc
{
  "schema": "v1",
  "run_id": "demo-web_api-benchmark_stg_20260610T090000Z",
  "dedupe_key": "<sha256 — see formula above>",
  "workflow": "perf-run-one",
  "team": "demo-web",
  "profile": "api-benchmark",
  "env": "stg",
  "trigger": "cron" | "deploy" | "manual",
  "script_sha": "<sha256 of script.js>",
  "baseline_sha": "<sha256 of baseline json>",
  "day_bucket": "2026-06-10",          // OR "deploy_sha" for deploy-triggered runs
  "exit_code": 0,
  "overall_verdict": "green" | "red" | "fail" | "no-baseline",
  "endpoints": [                        // REQUIRED on green/red — feeds curate-baselines
    { "name": "GET /api/config", "metric": "demo_web_config_health",
      "p95_ms": 662, "p95_red_ms": 1000, "verdict": "green" }
  ],
  "checks_passed": 20,
  "checks_failed": 0,
  "iterations": 10,                     // 10-iteration standard for benchmark/browser
  "summary_line": "<one line>",
  "recorded_at": "<ISO 8601>",
  "status": "done" | "failed" | "skipped",
  // red runs only:
  "corroborated": true,                 // O4 confirmation re-run also red? (false = flake or confirm-fail)
  "confirm_run_id": "<run_id>_confirm", // null if O4 never ran (legacy / fail-before-O4)
  "confirm_verdict": "red",             // verdict of the confirmation run
  "reviewer_decision": "SIGN_OFF" | "REJECT" | "REQUEST_CHANGES",
  "sources": 2,                         // independent red RUNS behind the decision: 2 = confirmed by re-run, 1 = unconfirmed
  "consecutive_rejects": 0,             // same-endpoint reject/flake streak — feeds the 3-strikes escalation
  "jira_filed": false,
  "jira_key": null,                     // set by file-perf-regression-jira (P3)
  "report_path": "reports/<run_id>/"
}
```

### v1.1 additions (2026-07-08 — functional suite)

- `suite`: `"k6" | "functional"` — absent means `"k6"` (all pre-2026-07-08 lines).
- Functional records: `endpoints` may be `[]`; instead `tests_total` / `passed` / `failed`
  are required, plus `failures[]` (`{test, file, error}`) on red. `iterations` does not
  apply and is omitted. Example:

```jsonc
{ "schema": "v1", "suite": "functional",
  "run_id": "redline-dashboard_functional_local_20260708T150000Z",
  "workflow": "func-run-one", "team": "redline-dashboard", "profile": "functional",
  "env": "local", "trigger": "manual", "tests_total": 8, "passed": 8, "failed": 0,
  "endpoints": [], "overall_verdict": "green", "...": "remaining v1 fields unchanged" }
```

Why these fields are mandatory: `endpoints[]` (per-endpoint p95) is the data source
for `curate-baselines` 7-day drift math and `file-perf-regression-jira`'s 24h
de-dupe (team + endpoint name for k6; team + first failing test for functional);
`dedupe_key`/`script_sha`/`baseline_sha` make the O0
idempotency gate operative; `sources` lets the Jira filing skill refuse unconfirmed
reds (2 = original + confirmation re-run both red — see `corroborate-2-sources`);
`consecutive_rejects` powers the sub-margin escalation rule (reviewer REJECTs and
unreproduced flakes both count toward the streak).

> The confirmation run (`<run_id>_confirm`) gets **no ledger line of its own** — it is an
> internal step of `corroborate-2-sources` (its dedupe_key would collide with the parent).
> Its outcome lives in the parent record's `confirm_*` fields.

> Records written before 2026-06-10 predate schema v1 — read them defensively.

### Jira-filing lines

When `file-perf-regression-jira` successfully files a ticket (`mode=file`), it appends one
line of this shape (never edits the original run record):

```jsonc
{
  "schema": "v1",
  "type": "jira-filing",
  "run_id": "<the run_id that was filed>",
  "team": "<team>",
  "profile": "<profile>",
  "env": "<env>",
  "endpoint": "<worst-endpoint name — flat string, matches endpoints[].name in the run record>",
  "jira_key": "PERF-NNNN",
  "sources": 2,              // always 2 — Gate 3 enforces sources >= 2 before any filing
  "recorded_at": "<ISO 8601>",
  "status": "done"
}
```

Gate 4 in `file-perf-regression-jira` scans for this line type to enforce the 24h
team+endpoint de-dupe. The `endpoint` field (flat string) must exactly match
`endpoints[].name` in the corresponding run record for the de-dupe to fire correctly.

> `jira_filed` on run records stays `false` permanently — the ledger is append-only. This
> `type:"jira-filing"` line is the sole authoritative record of a filing event.

### Corrective lines

A wrong record is never edited in place. Append a correction line instead:

```jsonc
{ "schema": "v1", "type": "correction",
  "corrects_run_id": "<run_id of the bad record>",
  "field": "<field name>", "corrected_value": "<right value>",
  "recorded_at": "<ISO 8601>", "status": "correction",
  "_note": "<what was wrong and why>" }
```

`status: "correction"` keeps these lines out of the O0 dedupe scan (which only
matches `status == "done"`). Consumers reading a corrected field should prefer
the latest correction line for that `run_id`.

## `team-settings.json` — per-team dashboard settings

Written by the dashboard's Projects page. Maps a team to the settings that used
to live in the single wizard session — which meant onboarding a second team
overwrote the first team's target:

```jsonc
{ "<team>": {
    "url":  "https://your-app.staging.example.com/api/health",
    "env":  "stg",            // stg | prod | local — the operator's explicit choice
    "path": "api",            // api | browser
    "login": { "required": true, "credsSet": true } } }
```

**Never holds secrets.** `credsSet` is a flag; the account itself lives in the
gitignored `.env` as `PERF_USERNAME_<TEAM>` / `STAGING_PASSWORD_<TEAM>` (team
name uppercased, non-alphanumerics → `_`). When the dashboard launches an agent
for a team it maps that team's pair onto the plain `PERF_USERNAME` /
`STAGING_PASSWORD` the scripts read, so a script never learns which team it
belongs to and one team's account never leaks into another team's run. Installs
that predate per-team credentials keep working: an unsuffixed pair is the
fallback.

Iteration and VU counts are deliberately **not** here — 10 iterations at 1 VU is
fixed by CLAUDE.md hard rule 7, because a single sample gives no meaningful p95.

Alert channels stay in `team-channels.json` and heal policy in
`heal-policy.json`; the Projects page shows both read-only.
