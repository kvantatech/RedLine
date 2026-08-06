# apply-ws2-conventions
> Apply WS2 template conventions — tags, Prometheus output, exit-code checklist.

**Type:** skill (deterministic) · **Used by:** perf-author · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
Apply WS2 template conventions to an authored script deterministically.

- Input: an authored k6 script file.
- Ensure: `shared/utils` import present; Mimir tags set (`environment`,
  `test_file`, `test_type`, `run_id`, `branch`); Prometheus-RW + OTLP output
  configured; exit-non-zero-on-breach checklist applied.
- Output: the script, conformed to the WS2 template.

Pure templating — no model judgement, fixed rules only.

## Tools
none — deterministic (plain code)

## Data
- Reads/writes: the authored script file (in the working PR branch)

## Notes
Activation: P4. Pure templating. Hard rule: the exit-non-zero-on-breach checklist
must be present so a threshold breach exits non-zero (exit code 97 is a FAIL).
p95 is the percentile used in threshold conventions.

---
Frozen skill registry: `AGENTS.md` in this repo
