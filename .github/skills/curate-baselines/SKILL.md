# curate-baselines
> 7-day p95 drift math → draft a baseline-bump PR (human merges).

**Type:** skill (deterministic) · **Used by:** perf-run-one, baseline-curate-all · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
Pull the last 7 days of GREEN runs and compute the median daily p95 per endpoint.
Compute the proposed threshold first: `proposed_red = observed_median × 1.35`.
If `|proposed_red - current_red| / current_red > 15%`, open a `baselines/<team>.<profile>.json`
bump PR with `red = proposed_red`, plus a justification table.
(The trigger compares the *recomputed* threshold against the current one — comparing raw
observed against current_red self-triggers forever, since at equilibrium `current_red =
observed × 1.35` puts raw observed 26% below the threshold.)
Inputs: team, profile (and the green-run history). Output: a draft GitHub PR, or a refusal.

**P1 behaviour (GitHub MCP not yet wired):** Skip the PR step. Instead, write
`reports/<run_id>/curate-note.txt` with the drift calculation and what the updated
threshold would be. A human applies the change manually. Append the run to
`state/run-ledger.jsonl` with `status: "done"` and `reviewer_decision` **copied from
`reports/<run_id>/reviewer-decision.json` (`decision` field)** — never hard-code it.

**Refuses when:** fewer than 3 days of green data, or the bump would *loosen* `error_rate_red`.

## Tools
GitHub MCP

## Data
- Reads: `state/run-ledger.jsonl` (last 7d of green runs, per endpoint p95)
- Reads/writes (via PR): `baselines/<team>.<profile>.json`

## Notes
Activates at **P5**. Collapsed from v1 `BaselineCurator` (deterministic drift math — no model).
- p95 everywhere: drift is computed on median daily **p95** per endpoint.
- **Refuses** if fewer than 3 days of green data, or if the bump would relax `error_rate_red`.
- Opens a draft PR only — a **human merges**; the skill never writes baselines directly.

---
Frozen skill registry: `AGENTS.md` in this repo
