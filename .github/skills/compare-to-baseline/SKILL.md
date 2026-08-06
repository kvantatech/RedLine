# compare-to-baseline
> Compare a new run against the saved baseline → green / red.

**Type:** skill (deterministic) · **Used by:** perf-run-one, perf-sweep, run-k6-action gate · **Status:** LIVE (P1)

---

## Prompt

You will compare the parsed run contract against the team's saved baseline and emit a verdict. Follow these steps exactly — no model judgment.

### 1 — Validate inputs

Required:
- `run_id` — string; used to locate `reports/<run_id>/contract.json`
- `team` — e.g. `demo-web`
- `profile` — e.g. `api-benchmark`, `browser-journey`, `load`, `spike`, `soak`, `stress`
- `exit_code` — integer from `run-k6-script` output

Reject and STOP if:
- `reports/<run_id>/contract.json` does not exist

If the mapped baseline file does not exist → emit `overall_verdict: "no-baseline"` and STOP (not an error; baselines are seeded at P2).

**Baseline filename mapping (env-aware):**
- `env == stg` → `baselines/<team>.<profile>.json` (stg is the default; no suffix)
- `env != stg` → `baselines/<team>.<profile>.<env>.json` (e.g. `baselines/demo-web.api-benchmark.prod.json`)

e.g. `demo-web` + `api-benchmark` + `stg` → `baselines/demo-web.api-benchmark.json`

**Env guard:** after reading the baseline, verify its `env` field matches the run's `env` input.
Mismatch → emit `overall_verdict: "no-baseline"` with reason `"env mismatch: baseline=<x>, run=<y>"` and STOP.
Never score a run against another environment's thresholds.

### 2 — Read inputs

Read:
- `reports/<run_id>/contract.json`
- `baselines/<team>.<profile>.json`

### 3 — Run compare-core logic

**Preferred path (guaranteed gate parity):** execute the ONE compare-core
implementation directly — it handles every step below, writes verdict.json,
and prints the summary line:

```
node .github/actions/run-k6-action/compare-core.js \
  --contract reports/<run_id>/contract.json \
  --baseline baselines/<team>.<profile>.json \
  --exit-code <exit_code> --run-id <run_id> \
  --out reports/<run_id>/verdict.json
```

Exit 0 covers green/red/no-baseline in report-only mode; read
`overall_verdict` from the written verdict.json. Only fall back to applying
the rules manually (below) if Node is unavailable.

Apply the `compare-core` verdict rules exactly:

**a. Exit code 97 → immediate FAIL**

**b. Missing endpoints → red**
For each endpoint/metric defined in the baseline, check if it appears in `contract.endpoints`.
- Baseline uses `endpoints[].name` or a top-level `metrics` object keyed by metric name (browser-journey style)
- Match by `name` field in contract endpoints, OR by `metric` field if present

**c. Per-endpoint verdict**
For each matched endpoint:
```
p95 == null         → red
p95 <= p95_red_ms   → green
else                → red
error_rate > error_rate_red → red (override)
```

**d. Overall verdict** = worst of all endpoint verdicts (fail > red > green)

**e. Compute deltas**
```
delta_ms  = p95_ms - p95_red_ms
delta_pct = (delta_ms / p95_red_ms) * 100  (1 decimal)
```

### 4 — Write verdict.json

Write to `reports/<run_id>/verdict.json`:
```json
{
  "run_id": "<run_id>",
  "team": "<team>",
  "profile": "<profile>",
  "env": "<from contract or baseline>",
  "overall_verdict": "green" | "red" | "fail" | "no-baseline",
  "exit_code": <n>,
  "endpoints": [
    {
      "name": "<string>",
      "metric": "<string>",
      "p95_ms": <integer or null>,
      "p95_red_ms": <integer>,
      "delta_ms": <integer>,
      "delta_pct": <float>,
      "verdict": "green" | "red",
      "reason": "<only if not green>"
    }
  ],
  "missing_endpoints": [],
  "summary_line": "<one line: e.g. 'GREEN — GET /api/config p95=668ms (within threshold ≤900ms)' or 'RED — GET /api/config p95=1250ms (threshold 900ms, +350ms +38.9%)'>"
}
```

### 5 — Return

Return:
```json
{
  "verdict_path": "reports/<run_id>/verdict.json",
  "overall_verdict": "<verdict>",
  "summary_line": "<one line>"
}
```

---

## Tools

Read, Write, Bash (only to run `node compare-core.js`) — no MCP, no model calls.

---

## Data

- **Reads:** `reports/<run_id>/contract.json`, `baselines/<team>.<profile>.json`
- **Writes:** `reports/<run_id>/verdict.json`

---

## Hard rules

1. **One verdict implementation** — this skill applies `compare-core` logic verbatim. Do not invent a second compare path.
2. **No baseline = `no-baseline` verdict, not an error** — baselines are seeded at P2; before that, the workflow records `no-baseline` and continues.
3. **Exit 97 = FAIL** — never evaluate thresholds on a crashed run.
4. **Missing endpoint = red** — a baseline endpoint absent from the contract is always red.
5. **No model calls** — zero autonomy; this runs on the gate hot path.

---

Frozen skill registry: `AGENTS.md` in this repo
