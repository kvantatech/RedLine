# k6-profile-load
> Ramping-arrival-rate load profile (open model).

**Type:** skill (deterministic) · **Used by:** perf-run-one, perf-sweep · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
Emit the k6 execution config for a ramping-arrival-rate load test. Inputs: team, profile (always `load`). Output: `{executor: ramping-arrival-rate, arrival_rate_shape, pre_allocated_vus, max_vus, cadence, exec_mode, baseline_path}`.
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
- **Open model.** Stage targets are arrival rate (iterations/sec), not concurrent VUs. A closed model (`ramping-vus`) withdraws load as the system slows, which hides the failure the profile exists to find. `pre_allocated_vus`/`max_vus` are the resource pool k6 draws on to hold the rate; size them by Little's Law (rate x iteration duration) with headroom for degradation.
- **Benchmark and browser profiles stay closed-loop at 1 VU** — they measure service time with no contention, where an open model would measure queueing delay instead.
- Blocked on PROD by the profile-aware hook (only `k6-profile-benchmark` may run on PROD).

---
Frozen skill registry: `AGENTS.md` in this repo
