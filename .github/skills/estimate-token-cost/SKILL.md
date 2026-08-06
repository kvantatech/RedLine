# estimate-token-cost
> Compute a per-target token ceiling before fan-out and fail closed when exceeded.

**Type:** skill (deterministic) · **Used by:** fleet workflows · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
When implemented, compute a per-target token ceiling before a fleet fan-out and enforce it: if the projected spend for a target exceeds the ceiling, FAIL CLOSED for that target rather than overspending.
Apply stage-by-engine routing: pure code for parse / compare / arithmetic / IO; a small model only for narration; a large model only for the `reviewer` subagent and the fleet cross-check.
Inputs: target count + per-stage engine plan -> Output: per-target ceiling and a go / fail-closed decision per target.

## Tools
none — deterministic (plain code)

## Data
none

## Notes
Activation: P3+. The token-efficiency control Mark asked for. Hard rule: fan-out fails closed — never silently overspend. Most stages must route to pure code; large-model calls are reserved for the reviewer and the cross-check only.

---
Frozen skill registry: `AGENTS.md` in this repo
