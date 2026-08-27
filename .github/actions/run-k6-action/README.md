# run-k6-action — the deterministic perf gate

**Delivery surface #2**:
a composite GitHub Action a team drops into its own CI. **Zero model calls** — run →
`--summary-export` → `compare-core.js` → exit code.

```
┌──────────┐   ┌──────────────────┐   ┌─────────────────┐   ┌───────────┐
│ k6 run   │ → │ summary.json     │ → │ compare-core.js │ → │ exit code │
│ (script) │   │ (--summary-export)│  │ (gate yaml math)│   │ 0/99/97   │
└──────────┘   └──────────────────┘   └─────────────────┘   └───────────┘
```

## Verdict parity — one implementation

[compare-core.js](compare-core.js) is the **only** executable implementation of the
verdict rules specced in `.github/skills/compare-core/SKILL.md`. Both delivery
surfaces run this same file:

- **CI gate** (this Action) — thresholds from the team's `perf-gate.yaml`
- **agentic loop** (`compare-to-baseline` skill) — thresholds from `baselines/<team>.<profile>.json`

Same math, same exit codes, by construction. Never re-implement the rules.

## Exit contract

| verdict | report-only | enforce |
|---|---|---|
| green / no-baseline | 0 | 0 |
| red | 0 | `gate.exit_code_on_red` (default **99**) |
| crash (k6 exit 97 / unexpected) | 0 | **97** |

`mode` comes from the `gate:` section of `perf-gate.yaml`; the `mode-override`
input can force it per-call. A malformed gate file or missing summary always
exits 97 (fail closed) regardless of mode — a misconfigured gate must never
silently pass.

## Usage (report-only burn-in)

```yaml
- uses: your-org/perf-eng-agent/.github/actions/run-k6-action@main   # ./.github/actions/run-k6-action inside this repo
  env:
    PERF_USERNAME: ${{ secrets.PERFORMANCE_TEST_USERNAME }}
    STAGING_PASSWORD: ${{ secrets.PERFORMANCE_TEST_PASSWORD }}
  with:
    script: live/demo-web/api-benchmark/script.js
    gate-config: live/demo-web/api-benchmark/perf-gate.yaml
```

Example caller: [.github/workflows/perf-gate-demo-web.yml](../../workflows/perf-gate-demo-web.yml)
(workflow_dispatch only). Teams graduate report-only → enforce by flipping
`gate.mode` in their `perf-gate.yaml` after burn-in sign-off — the workflow
file never changes.

## Inputs / outputs

| input | default | |
|---|---|---|
| `script` | — | k6 script path (required) |
| `gate-config` | — | `perf-gate.yaml` path (required) |
| `run-id` | `gate_<run id>_<attempt>` | run identifier |
| `k6-version` | `2.0.0` | k6 to install (grafana/setup-k6-action) |
| `mode-override` | `''` | force `report-only` / `enforce` |

| output | |
|---|---|
| `verdict` | `green` \| `red` \| `fail` \| `no-baseline` |
| `summary-line` | one-line human summary |
| `verdict-path` | `reports/<run_id>/verdict.json` |
| `k6-exit-code` | raw k6 exit (0 / 99 / 97) |

## compare-core.js standalone (the agentic surface)

```
node .github/actions/run-k6-action/compare-core.js \
  --summary reports/<run_id>/summary.json \          # or --contract contract.json
  --baseline baselines/demo-web.api-benchmark.json \   # or --gate perf-gate.yaml
  --exit-code 0 --run-id <run_id> \
  --out reports/<run_id>/verdict.json
```

Handles both baseline shapes (`endpoints[]` array and `metrics{}` map), both
summary formats (`--summary-export` flat and `handleSummary` nested `values`),
and the contract.json shape from `parse-k6-json-summary`.

## Notes

- Browser scripts are auto-detected (`from 'k6/browser'`) and run with
  `K6_BROWSER_HEADLESS=true`; ubuntu-latest has Chrome preinstalled.
- Any `*.har` file is deleted after the run, unconditionally (HAR scrub interim
  rule — `run-k6-script` SKILL step 6).
- Error-rate override: thresholds with `error_rate_red` compare against the
  per-endpoint `error_rate` (contract mode) or the global checks failure rate
  (summary mode — custom Trend metrics carry no per-metric error rate).
