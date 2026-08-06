# eval: baseline-comparer-e2e — P0 scaffold

Exercises `compare-to-baseline` end-to-end: a parsed k6 summary is classified
against a baseline into green / red.

## Input (fixture)

- A k6 run summary (parsed p95 per endpoint + error rate).
- A baseline file following the current grammar, e.g. `baselines/demo-web.api-benchmark.json`.
- Context: `team=demo-web`, `env=stg`, `profile=api-benchmark`.

Example shape of the run summary the eval feeds in:

```json
{
  "team": "demo-web",
  "env": "stg",
  "profile": "api-benchmark",
  "endpoints": [
    { "name": "GET /api/config", "p95_ms": 662, "error_rate": 0.001 },
    { "name": "GET /api/config", "p95_ms": 1250, "error_rate": 0.004 }
  ]
}
```

## Expected output

A per-endpoint verdict and an overall verdict, all on **p95**:

- `GET /api/config` p95 662 ms → within threshold (≤900ms) → **green**.
- `GET /api/config` p95 1250 ms → exceeds `p95_red_ms` (900ms) → **red**.
- Overall = worst endpoint = **red**.

The eval passes when the classification matches the thresholds in the baseline
exactly (boundary cases land on the documented side of each threshold).
