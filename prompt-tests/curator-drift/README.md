# eval: curator-drift — P0 scaffold

Exercises `detect-drift` / `curate-baselines`: given a series of recent green
runs that have drifted away from the stored baseline, the curator proposes an
updated baseline.

## Input (fixture)

- A frozen baseline (e.g. `baselines/demo-web.benchmark.json`).
- A window of recent run-ledger entries whose p95s are consistently and
  materially **better** (or worse-but-stable) than the stored thresholds —
  i.e. the baseline has drifted.

```text
baseline p95_green_ms (GET /jobs) = 500
last 10 green runs p95 (GET /jobs) ≈ 340–360  → stored thresholds now stale
```

## Expected output

- A **proposed** baseline update (diff against the current file), not an
  in-place mutation — baselines are LOCKED at P0; updates go through review.
- The proposal cites the run-ledger evidence window (dedupe_keys / run ids).
- It is routed for Reviewer sign-off before any merge.

The eval passes when the curator proposes a correctly-scoped update with cited
evidence and does **not** silently overwrite the frozen baseline.
