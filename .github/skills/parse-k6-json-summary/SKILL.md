# parse-k6-json-summary
> Normalize a k6 v2 JSON summary into the canonical contract shape.

**Type:** skill (deterministic, no model call) · **Used by:** perf-run-one, perf-sweep · **Status:** LIVE (P1)

---

## Prompt

You will parse a raw k6 JSON summary file and produce a normalized `contract.json`. Follow these steps exactly — no judgment, no inference.

### 1 — Read the summary file

Read `reports/<run_id>/summary.json`.

Reject and STOP if any of the following are true:
- The file does not exist
- The file is empty or not valid JSON
- The top-level `metrics` key is absent (not a k6 summary)
- `state.k6Version` is present AND the version is < `2.0.0` (use semver comparison on major version)

### 2 — Extract top-level run metadata

From the k6 summary JSON:

| Contract field | k6 source path |
|----------------|---------------|
| `run_id` | Use the caller-supplied `run_id` (not from JSON — pass through from run-k6-script output) |
| `started_at` | `state.testStarted` (ISO 8601 string) or `""` if absent |
| `duration_s` | `state.testRunDurationMs / 1000` (round to 1 decimal) |
| `vu_max` | `state.VUsMax` |
| `iterations` | `metrics.iterations.values.count` |

### 3 — Extract aggregate check stats

| Contract field | k6 source path |
|----------------|---------------|
| `checks.passed` | `metrics.checks.values.passes` |
| `checks.failed` | `metrics.checks.values.fails` |
| `checks.rate` | `metrics.checks.values.rate` (0.0–1.0) |

If `metrics.checks` is absent, set `checks: { passed: 0, failed: 0, rate: null }`.

### 4 — Extract per-endpoint metrics

k6 v2 exposes tagged/named metrics in two ways. Check both:

**A — Named groups** (scripts using `group('endpoint-name', ...)` or `check(res, {}, {name:'...'})` with tags):
Look for metrics with names matching `http_req_duration{...}` where the tag `name` or `url` identifies an endpoint.

**B — Scenario/URL metrics** (scripts without explicit naming):
Fall back to the top-level `http_req_duration` for a single-endpoint summary. Set `name` to `"all"`.

For each distinct endpoint name found, extract:

| Contract field | k6 source path |
|----------------|---------------|
| `name` | tag value for `name` or `url` |
| `p50` | `values["p(50)"]` in ms (integer) |
| `p95` | `values["p(95)"]` in ms (integer) — **required** |
| `p99` | `values["p(99)"]` in ms (integer) |
| `error_rate` | `values.rate` from the corresponding `http_req_failed` metric for this tag, else `0` |

Round all latency values to the nearest integer (milliseconds).

If `p95` cannot be found for an endpoint, mark that endpoint as `"p95": null` — do NOT omit it. A null p95 is surfaced as a data gap, not silently dropped.

### 5 — Extract errors array

Scan for metrics where `type == "counter"` and the metric name contains `errors` or `http_req_failed`. For each with `values.count > 0`:
```json
{ "metric": "<metric_name>", "count": <n> }
```

If none, set `errors: []`.

### 6 — Write contract.json

Write the following shape to `reports/<run_id>/contract.json`:

```json
{
  "run_id": "<run_id>",
  "started_at": "<ISO string or empty string>",
  "duration_s": <number>,
  "vu_max": <number>,
  "iterations": <number>,
  "checks": {
    "passed": <number>,
    "failed": <number>,
    "rate": <0.0-1.0 or null>
  },
  "endpoints": [
    {
      "name": "<string>",
      "p50": <ms integer>,
      "p95": <ms integer or null>,
      "p99": <ms integer>,
      "error_rate": <0.0-1.0>
    }
  ],
  "errors": [
    { "metric": "<string>", "count": <number> }
  ]
}
```

### 7 — Return

Return the path to the written file: `reports/<run_id>/contract.json`

Also return a one-line validation summary:
- `OK — <N> endpoints, checks pass rate <rate>%` on success
- `PARTIAL — p95 null for: <endpoint names>` if any p95 is missing
- `FAILED — <reason>` if the file could not be written

---

## Tools

None — this is pure deterministic parsing. Read the input file and write the output. Use `Read` and `Write` tools only.

---

## Data

- **Reads:** `reports/<run_id>/summary.json` — raw k6 JSON output
- **Writes:** `reports/<run_id>/contract.json` — normalized contract (primary output)

---

## Hard rules

1. **Fail closed** — if the input is malformed, missing, or from k6 < v2.0, REFUSE and do NOT write a partial contract.
2. **p95 is required** — if p95 is absent for an endpoint, record it as `null` (a gap), never substitute p90 or p99.
3. **Never drop endpoints** — even an endpoint with all-null latencies belongs in the array (it surfaces a data gap to the downstream compare step).
4. **No inference** — do not estimate or interpolate missing values. Write what the JSON contains; mark gaps explicitly.

---

## k6 v2 summary JSON shape (reference)

```json
{
  "state": {
    "k6Version": "2.0.0",
    "testStarted": "2026-06-05T14:30:00Z",
    "testRunDurationMs": 30000,
    "VUsMax": 10
  },
  "metrics": {
    "iterations": { "type": "counter", "values": { "count": 300, "rate": 10 } },
    "checks":     { "type": "rate",    "values": { "rate": 0.97, "passes": 291, "fails": 9 } },
    "http_req_duration": {
      "type": "trend",
      "values": { "avg": 320, "min": 80, "med": 290, "max": 1200,
                  "p(50)": 290, "p(90)": 580, "p(95)": 750, "p(99)": 1050 }
    },
    "http_req_failed": {
      "type": "rate",
      "values": { "rate": 0.02, "passes": 294, "fails": 6 }
    }
  }
}
```

Named-group metrics follow the same structure but are nested under the group/tag key. Consult `k6 x docs` for the exact v2 summary schema if the shape differs.

---

Frozen skill registry: `AGENTS.md` in this repo
