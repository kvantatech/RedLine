# eval: script-author — P0 scaffold

Exercises the `script-author` subagent: given a brief, it produces a valid k6
HTTP load-test script that follows house conventions.

## Input (fixture)

A short brief describing the target and shape of load, e.g.:

```text
Author a k6 benchmark for demo-web (stg):
  - GET /jobs           (browse)
  - POST /apply         (submit, JSON body)
  - profile: benchmark  (ramp to 50 VUs, hold 5m)
  - tag metrics for Prometheus remote-write
```

## Expected output

A k6 script (`*.js`) that:

- Uses the house URL pattern and `options` (stages/VUs matching the profile).
- Tags requests so Prometheus remote-write attributes them to `team=demo-web`,
  `env=stg`, `profile=benchmark`.
- Emits a parseable end-of-test summary (consumed by `parse-k6-summary` →
  `compare-to-baseline`).
- Contains no secrets or hard-coded prod URLs (stg only).

The eval passes when the produced script is syntactically valid k6 and matches
the conventions above (a real `k6 run --paused` / lint can confirm validity).
