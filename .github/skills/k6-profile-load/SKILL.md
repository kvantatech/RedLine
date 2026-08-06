# k6-profile-load
> Ramping-VUs load profile.

**Type:** skill (deterministic) · **Used by:** perf-run-one, perf-sweep · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
Emit the k6 execution config for a ramping-vus load test. Inputs: team, profile (always `load`). Output: `{executor: ramping-vus, load_shape, cadence, exec_mode, baseline_path}`.
- `cadence`: weekly (Saturday)
- `exec_mode`: k6-operator (Kubernetes)
- Blocked on PROD.
No model call: pure config emission consumed by `run-k6-script`.

## Tools
none — deterministic (plain code)

## Data
- Reads: `baselines/<team>.load.json`
- Writes: none (config object passed downstream)

## Notes
- Activation: P2 (heavy profile — load + spike land second per DEC-5testtypes).
- p95 everywhere.
- Blocked on PROD by the profile-aware hook (only `k6-profile-benchmark` may run on PROD).

---
Frozen skill registry: `AGENTS.md` in this repo
