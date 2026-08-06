# compare-core
> The ONE verdict implementation — imported everywhere so skill, Action, and workflow can never disagree.

**Type:** shared-lib (deterministic) · **Used by:** compare-to-baseline + run-k6-action gate + perf-run-one · **Status:** LIVE (P1)

> **Executable implementation:** `.github/actions/run-k6-action/compare-core.js`
> (Node, zero deps). This SKILL.md is the spec; the JS is the code BOTH delivery
> surfaces run — the CI gate via `action.yml`, the agentic loop via the
> `compare-to-baseline` skill. Any rule change updates this spec AND the JS
> together, in the same commit.

---

## Prompt

You are `compare-core`. You receive a parsed contract and a baseline file and must produce a verdict. This is pure deterministic logic — no model judgment, no inference.

### Inputs

```
contract  — contents of reports/<run_id>/contract.json  (from parse-k6-json-summary)
baseline  — contents of baselines/<team>.<profile>.json
run_id    — string (for labeling output)
exit_code — integer (from run-k6-script; 97 = FAIL regardless of metrics)
```

### Step 1 — Immediate FAIL on exit code 97

If `exit_code == 97`:
- Set `overall_verdict = "fail"`
- Set `reason = "k6 abort (exit 97) — run did not complete"`
- Skip all threshold math
- Write verdict.json with `overall_verdict: "fail"` and STOP

### Step 2 — Check for missing expected endpoints

For each endpoint defined in `baseline.endpoints` (or `baseline.metrics` — check both keys):
- Look for a matching entry in `contract.endpoints` by `name` or `metric` field
- If an expected endpoint is **absent** from the contract → mark it `verdict: "red"`, `reason: "missing from run output"`

### Step 3 — Per-endpoint verdict

Two states only: **green** or **red**.

**p95 verdict:**
```
if p95 <= p95_red_ms  → "green"
else                  → "red"
```

If `p95` is `null` or non-numeric in the contract → verdict `"red"`, reason `"p95 not recorded"`

**Fail closed on a malformed threshold.** A gate must never pass on bad data. If a
threshold entry has neither a numeric `p95_red_ms` nor an `error_rate_red`, the metric
has no usable red line → verdict `"red"`, reason `"no usable threshold in baseline"`.
(A NaN comparison such as `p95 > undefined` silently yields green, so both operands are
guarded explicitly.)

**Error rate override:**
```
if error_rate > error_rate_red → override verdict to "red", reason "error_rate exceeded"
```

### Step 4 — Overall verdict

```
overall_verdict = worst of all per-endpoint verdicts
priority: fail > red > green
```

If there are no endpoints at all in the baseline → `overall_verdict = "no-baseline"`, do NOT set red.

### Step 5 — Compute deltas

For each endpoint:
```
delta_ms   = contract p95 - baseline p95_red_ms   (positive = over threshold)
delta_pct  = (delta_ms / baseline p95_red_ms) * 100  (round to 1 decimal)
```

### Step 6 — Write verdict.json

Write `reports/<run_id>/verdict.json`:

```json
{
  "run_id": "<run_id>",
  "team": "<from baseline>",
  "profile": "<from baseline>",
  "env": "<from baseline>",
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
      "reason": "<string — only set if red>"
    }
  ],
  "missing_endpoints": ["<name>", ...],
  "summary_line": "<one human-readable line: overall verdict + worst delta>"
}
```

### Step 7 — Return

Return the verdict object. The caller (compare-to-baseline) writes it to disk.

---

## Tools

None — pure deterministic logic. Read baseline + contract files; write verdict.json.

---

## Data

- **Reads:** `reports/<run_id>/contract.json`, `baselines/<team>.<profile>.json`
- **Writes:** `reports/<run_id>/verdict.json`

---

## Hard rules

1. **Exit code 97 = FAIL unconditionally** — never evaluate thresholds on a crashed run.
2. **Missing endpoint = red** — a baseline endpoint absent from the run is always red.
3. **p95 null = red** — a metric that wasn't recorded is a data gap treated as red.
4. **Two verdicts only: green or red** — no amber, no warning, no partial. Below threshold = green, at or above = red.
5. **One implementation** — this file IS the verdict logic. `compare-to-baseline`, `run-k6-action`, and `perf-run-one` all call this. Never duplicate the math.
6. **p95 is the compared percentile everywhere** — do not act on p50/p99 as the primary verdict.
7. **No model calls** — this runs on the gate hot path (0-model-call budget).

---

Frozen skill registry: `AGENTS.md` in this repo
