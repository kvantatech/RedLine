# link-grafana-panel
> Build a URL-encoded Grafana deep-link to the exact run window for the ticket / proof.

**Type:** skill (deterministic — pure string construction, no network, no token) · **Used by:** perf-run-one, perf-sweep · **Status:** LIVE (P3 — links the LGTM `Perf - <team>` dashboard; no `GRAFANA_SERVICE_ACCOUNT_TOKEN` needed)

## Prompt

You are the `link-grafana-panel` skill. You construct a deep-link to the per-project LGTM
dashboard (`Perf - <team>`, uid `perf-<team>` by convention), pre-filtered to the exact
run(s) and time window, for embedding in the Jira draft (`grafana_url`) and the Slack alert.
This is **pure URL construction** — no Grafana API call, no auth, no model call.

**Inputs** (from the workflow):
- `team`, `profile`, `env`, `run_id`
- `started_at` (ISO) + `duration_s` — from `reports/<run_id>/contract.json`
- `observe` — whether the run exported OTLP (`OBSERVE=1`)
- optional: `confirm_run_id` + its `started_at`/`duration_s` (corroborated reds — from `reports/<run_id>_confirm/contract.json`)

### Steps

1. **Gate.** If `observe` is not `1` → return `{ "grafana_url": "", "reason": "run not exported (OBSERVE off) — no data in Mimir to link" }`.
   A link to an empty panel is worse than no link.

2. **Resolve the Grafana host** (where the run's OTLP export landed):

   | env | host |
   |---|---|
   | `stg` | `https://grafana.example.com` |
   | `prod` | `https://grafana.example.com` |

3. **Dashboard path by convention:** `/d/perf-<team>/perf-<team>` (per-project dashboard rule —
   one dashboard per project, uid `perf-<project>`, lives in the `team-perf` folder).

4. **Time window:** `from = epoch_ms(started_at) − 60000`; `to = epoch_ms(started_at) + duration_s×1000 + 60000`.
   If a confirm run is supplied, extend `to` to the confirm run's end + 60s (one window covering both runs).

5. **Variables** (must match the dashboard's templating + the script tag contract):
   - `var-environment` — map env: `stg` → `staging`, `prod` → `prod-us`
   - `var-test_file` — `<profile>` (e.g. `api-benchmark`)
   - `var-run_id` — `<run_id>`; if a confirm run exists, repeat the param
     (`&var-run_id=<run_id>&var-run_id=<run_id>_confirm` — multi-select shows both bars side by side)

6. **Assemble + URL-encode** each value:

   ```
   <host>/d/perf-<team>/perf-<team>?orgId=1&from=<from_ms>&to=<to_ms>&var-environment=<env_tag>&var-test_file=<profile>&var-run_id=<run_id>[&var-run_id=<confirm_run_id>]
   ```

7. **Return** `{ "grafana_url": "<url>" }`. The workflow fills it into `jira-draft.md`
   (evidence section) **before** any filing, and passes it to `notify-responsible-team`.

## Example (corroborated red)

```
https://grafana.example.com/d/perf-demo-web/perf-demo-web?orgId=1&from=1781102342000&to=1781103062000&var-environment=staging&var-test_file=api-benchmark&var-run_id=demo-web_api-benchmark_stg_20260610T143022Z&var-run_id=demo-web_api-benchmark_stg_20260610T143022Z_confirm
```

## Hard rules

- **No Grafana API, no token, no network.** A deep-link is a string. (The
  `GRAFANA_SERVICE_ACCOUNT_TOKEN` is NOT needed here — it only unlocks the reviewer's
  optional Grafana-MCP context enrichment.)
- **Never link a run that didn't export** (`observe != 1` → empty url + reason).
- **p95 is the percentile of any panel this links to.**
- **uid by convention only** (`perf-<team>`) — no per-baseline override; one convention,
  zero drift. (The stale `grafana` block in pre-P3 baselines was removed 2026-06-10.)

## Tools

none — deterministic (plain string construction)

## Data

- Reads: `reports/<run_id>/contract.json` (`started_at`, `duration_s`) and, when present,
  `reports/<run_id>_confirm/contract.json`
- Writes: nothing (returns the URL to the caller)

---
Frozen skill registry: `AGENTS.md` in this repo
(2026-06-10: implemented as a pure URL-builder against the LGTM `Perf - demo-web` dashboard — the planned Grafana-API approach needed a token for zero benefit.)
