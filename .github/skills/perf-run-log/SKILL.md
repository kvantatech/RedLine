# perf-run-log
> Append numbered milestone log lines per run and write a dated final report.

**Type:** skill (deterministic) · **Used by:** all workflows / both subagents · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
When implemented, append numbered milestone log lines (one per milestone, in the `rad-log-error` shape) to `logs/<run-id>.md` as a run progresses, then write a dated final report to `reports/` at completion.
Inputs: run-id + a milestone message (or final-report payload) -> Output: the appended log line / the written dated report file.
Every workflow stage and every subagent calls this at its milestones so a run is fully reconstructable from the log alone.

## Tools
none — deterministic (plain code)

## Data
- Writes: `logs/<run-id>.md` (numbered milestone lines, append-only)
- Writes: `reports/<dated-report>.md` (final report per run)

## Notes
Activation: P0. The session-log skill. Hard rules: milestone lines are append-only and numbered in order; log format follows the `rad-log-error` shape so lines are greppable across runs. Every subagent appends at its milestones — no silent runs.

---
Frozen skill registry: `AGENTS.md` in this repo
