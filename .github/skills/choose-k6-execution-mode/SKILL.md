# choose-k6-execution-mode
> Pick local vs k6-operator execution mode for a run — the SCALE pillar.

**Type:** skill (deterministic) · **Used by:** perf-run-one, perf-sweep, perf-author · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
When implemented, select the k6 execution mode for a given profile: `local` (single runner) for the `benchmark` profile and the per-deploy gate — fast and cheap; `k6-operator` v1.0 (Kubernetes) for heavy profiles (`load` / `stress` / `soak` / `spike`) that need VU concurrency beyond one runner.
Inputs: profile (+ requested VU/duration) -> Output: chosen mode and its launch parameters.
This is a lookup, not an always-on dependency — it returns a mode, nothing more.

## Tools
none — deterministic (plain code)

## Data
none

## Notes
Activation: P1/P2. The SCALE pillar. Hard rule: `benchmark` and the deploy gate always run `local` (latency-sensitive, low cost); only the four heavy profiles route to k6-operator on K8s. Five profiles total: benchmark, load, stress, soak, spike.

---
Frozen skill registry: `AGENTS.md` in this repo
