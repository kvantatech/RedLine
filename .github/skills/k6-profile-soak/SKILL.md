# k6-profile-soak
> Long-duration soak profile.

**Type:** skill (deterministic) · **Used by:** perf-run-one, perf-sweep · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
Emit the k6 execution config for a long constant-VU soak. Inputs: team, profile (always `soak`). Output: `{executor: constant-vus, load_shape, cadence, exec_mode, baseline_path}`.
- `cadence`: monthly (first Saturday)
- `exec_mode`: k6-operator (Kubernetes)
- Blocked on PROD.
No model call: pure config emission consumed by `run-k6-script`.

## Tools
none — deterministic (plain code)

## Data
- Reads: `baselines/<team>.soak.json`
- Writes: none (config object passed downstream)

## Notes
- Activation: P2 (stress + soak land last per DEC-5testtypes).
- p95 everywhere.
- Blocked on PROD by the profile-aware hook (only `k6-profile-benchmark` may run on PROD).

---
Frozen skill registry: `AGENTS.md` in this repo
