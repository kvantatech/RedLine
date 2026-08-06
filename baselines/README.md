# baselines/ — baseline grammar (green/red only)

Per-team, per-profile performance baselines. One file per
`<team>.<profile>.json`. These define the single `p95_red_ms` threshold that
`compare-to-baseline` classifies runs against.

> Baseline *values* are updated only via a reviewed proposal (see the
> `curate-baselines` skill) — never edited silently in place.

## File naming

```
baselines/<team>.<profile>.json          # stg (default env — no suffix)
baselines/<team>.<profile>.<env>.json    # any other env, e.g. prod
```

e.g. `baselines/demo-web.api-benchmark.json` (team `demo-web`, profile `api-benchmark`, env stg);
a prod benchmark baseline would be `baselines/demo-web.api-benchmark.prod.json`.

`compare-to-baseline` verifies the file's `env` field against the run's env and refuses
cross-env comparison (`no-baseline` verdict on mismatch) — stg thresholds never score a prod run.

## Schema

```jsonc
{
  "team":    "demo-web",          // owning team
  "env":     "stg",             // environment the thresholds were measured in
  "profile": "api-benchmark",   // load profile this baseline applies to
  "updated": "2026-06-09",      // ISO date of last reviewed update
  "source":  "...",             // provenance (run id / PR)
  "endpoints": [
    {
      "name":           "GET /api/config",  // endpoint label (matches k6 tag)
      "metric":         "demo_web_config_health",  // k6 Trend metric name (optional)
      "p95_red_ms":     900,    // p95 > this → red; p95 <= this → green
      "error_rate_red": 0.02    // error_rate > this → red (override)
    }
  ],
  "grafana": {
    "dashboard_uid": "demo-dash-uid",  // Grafana dashboard UID for evidence/snapshot
    "panel_id":      12          // panel within that dashboard
  }
}
```

Browser-journey baselines use a top-level `metrics` object keyed by metric name
instead of an `endpoints` array (see `demo-web.browser-journey.json`).

### Conventions

- **p95 everywhere.** All latency thresholds are p95 in milliseconds (`*_ms`).
- **Two verdicts only: green | red.** `p95 <= p95_red_ms` → green; `p95 > p95_red_ms` → red.
- `error_rate > error_rate_red` → red override regardless of p95.
- `grafana.dashboard_uid` + `panel_id` link a verdict to its evidence snapshot.

## Baseline seeding formula (first run)

When seeding a threshold for the first time from an initial observed p95:

**API profiles:**
```
p95_red_ms = max(1000, observed_p95 × 1.2)
```
Floor: 1000ms (industry standard for authenticated API endpoints). If the observed p95 is below 833ms, the floor wins and the threshold is set to 1000ms.

**Browser profiles — per metric:**
```
p95_red_ms = max(industry_floor, observed_p95 × 1.2)
```

| Metric | Industry floor | Source |
|---|---|---|
| FCP (`browser_web_vital_fcp`) | 1800ms | Web Vitals "good" |
| LCP (`browser_web_vital_lcp`) | 2500ms | Web Vitals "good" |
| Login end-to-end (`*_login_ms`) | 8000ms | prod login budget |
| App/MFE load (`*_ng*_ms`, `*_react_ms`) | 3000ms | Web Vitals TTI "good" |
| Menu/profile interaction (`*_profile_ms`) | 1500ms | prod MENU_READY budget |

If no observed data is available for a metric yet, **use the floor** and mark `_seeding: "floor only"` in the baseline. Update after the first real 10-iteration run.

**Ongoing drift** (not seeding) is handled by `curate-baselines` — see that skill.

See `demo-web.api-benchmark.json` for a worked example.

## Functional suites have no baselines (by design — 2026-07-08)

Playwright verdicts are pass/fail: all tests pass = green, any corroborated failure = red.
There is no `baselines/<team>.functional.json` and none should ever be created — latency
thresholds are k6's jurisdiction (`<team>.<profile>.json` as before).
