# k6-profile-benchmark
> 1-VU benchmark/smoke profile — the daily per-deploy signal.

**Type:** skill (deterministic) · **Used by:** perf-run-one, perf-sweep, run-k6-action gate · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
Emit the k6 execution config for a 1-VU benchmark/smoke run. Inputs: team, profile (always `benchmark`). Output: `{executor, load_shape, cadence, exec_mode, baseline_path}`.
- `cadence`: daily
- `exec_mode`: local
- **Standard shape: 1 VU, 10 iterations, `per-vu-iterations` executor** — 10 samples is the minimum for a statistically meaningful p95. Never 1 iteration.
- This is the ONLY profile permitted on PROD — and only with a one-time approval token and `vus <= 1` (DEC-prod-scripts Option B).
No model call: pure config emission for the deterministic deploy gate.

## Tools
none — deterministic (plain code)

## Data
- Reads: `baselines/<team>.benchmark.json`
- Writes: none (config object passed downstream to `run-k6-script`)

## Notes
- Activation: P0 (config + grammar) / P2 (full profile authoring). Benchmark FIRST per DEC-5testtypes.
- The `baselines/<team>.<profile>.json` grammar is LOCKED at P0.
- p95 everywhere. The `run-k6-action` deploy gate has ZERO model calls.
- PROD rule: permitted only with one-time approval token AND `vus <= 1`.

---
Frozen skill registry: `AGENTS.md` in this repo
