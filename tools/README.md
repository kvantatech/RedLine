# tools/ — publish results into RedLine from any runner

RedLine is the **judgment layer, not the runner**. Its dashboard merges results from
anywhere into one view (Executions, Tests, Insights) — local agent runs, CI gates in
other repos, other clusters, even other test tools. Anything that can append one JSON
line to a file can publish.

Two ways in:

1. **From a `run-k6-action` gate** — convert the gate's verdict.json:
   `node tools/verdict-to-ledger.mjs --verdict verdict.json --trigger deploy >> feed.jsonl`
2. **From any other runner** (Jenkins, GitHub Actions, Testkube, a cron script…) —
   emit one JSON line per run matching the contract below. No RedLine code needed.

Host the growing `.jsonl` file anywhere the dashboard can read (raw repo file, S3/GCS
object, network share), then list it in `state/remote-ledgers.json`:

```json
[{ "name": "eu-cluster", "url": "https://…/feed.jsonl" }]
```

Feeds are read-only visibility: a duplicate `run_id` keeps the local record, a dead
feed degrades to a `remote_errors` note, and operational gates (filing, schedules)
stay strictly local.

## The ledger-line contract (schema v1, read side)

One JSON object per line. **Only `run_id` is required** — every other field degrades
to "—" in the UI; a malformed line is counted and skipped, never breaks the page.

| Field | Type | Meaning |
|---|---|---|
| `run_id` | string | **Required.** Unique per run — the de-dupe key across all feeds. Convention: `<team>_<profile>_<env>_<UTC-stamp>Z`. |
| `schema` | `"v1"` | Contract version. |
| `recorded_at` | ISO 8601 string | Sort key — newest first everywhere. |
| `team` | string | Which team's test (folder slug, e.g. `demo-web`). |
| `profile` | string | Which test (e.g. `api-benchmark`, `browser-journey`, `functional`). |
| `env` | `"stg"` \| `"prod"` | Where it ran. |
| `suite` | `"functional"` or omit | Omitted (or `profile: "functional"`) → performance. |
| `trigger` | `"deploy"` \| `"cron"` \| `"manual"` | What started the run. |
| `overall_verdict` | `"green"` \| `"red"` | The two-verdict rule. Anything else renders as "didn't finish" (crash), not a verdict. |
| `summary_line` | string | One human-readable line shown on the run row. |
| `deploy_sha` | string | Optional — the commit a deploy-triggered run gated. |

**Performance runs** add per-endpoint samples (drives the p95 charts and Insights step
panels):

```json
"endpoints": [{ "name": "GET /api/config", "metric": "config_health",
                "p95_ms": 829, "p95_red_ms": 1000, "verdict": "green" }]
```

**Functional runs** add pass/fail counts and failures (drives the counts chip and the
failure list):

```json
"tests_total": 16, "passed": 14, "failed": 1, "skipped": 1,
"failures": [{ "test": "job-detail.spec.ts > shows the description",
               "file": "job-detail.spec.ts", "error": "expect(locator).toBeVisible() failed" }]
```

**Flake corroboration** (optional — only the agentic loop produces these; plain gate
runs omit them and render as plain green/red):

| Field | Meaning |
|---|---|
| `sources` | `2` = red confirmed by re-run, `1` = not reproduced |
| `confirm_run_id`, `confirm_verdict` | The confirmation re-run and its verdict. `confirm_verdict: "green"` on a red marks it a **flake** in the UI. |

### Minimal valid examples

```json
{"schema":"v1","run_id":"demo-web_api-benchmark_stg_20260716T090000Z","recorded_at":"2026-07-16T09:00:00Z","team":"demo-web","profile":"api-benchmark","env":"stg","trigger":"deploy","overall_verdict":"green","summary_line":"GREEN — p95 829ms (threshold 1000ms)","endpoints":[{"name":"GET /api/config","p95_ms":829,"p95_red_ms":1000,"verdict":"green"}]}
```

```json
{"schema":"v1","run_id":"saucedemo-team_functional_stg_20260716T091500Z","recorded_at":"2026-07-16T09:15:00Z","team":"saucedemo-team","profile":"functional","suite":"functional","env":"stg","trigger":"cron","overall_verdict":"red","summary_line":"RED — 1/16 failed","tests_total":16,"passed":15,"failed":1,"skipped":0,"failures":[{"test":"home.spec.ts > shows hero","file":"home.spec.ts","error":"expect(locator).toBeVisible() failed"}]}
```

### Verify your feed before wiring CI

Point a local dashboard at the file and look:

```json
// state/remote-ledgers.json
[{ "name": "my-feed", "url": "C:/path/to/feed.jsonl" }]
```

`node dashboard/server.mjs` → Executions — your runs appear tagged `my-feed`. What the
dashboard reads is normalized in `dashboard/runs-lib.mjs` (`normalizeRecord`), the one
place the contract is executable.
