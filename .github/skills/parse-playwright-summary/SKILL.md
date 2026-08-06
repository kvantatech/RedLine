# parse-playwright-summary
> Normalize a Playwright JSON report into the canonical functional contract shape.

**Type:** skill (deterministic, no model call — thin wrapper over `parse.mjs`) · **Used by:** func-run-one, corroborate-2-sources · **Status:** LIVE (2026-07-08)

---

## Prompt

You will normalize a raw Playwright JSON report. There is no judgment here — run the script:

```
node .github/skills/parse-playwright-summary/parse.mjs reports/<run_id>/results.json <run_id> reports/<run_id>/contract.json
```

- Exit 0 → contract written; report the script's `OK — …` line.
- Exit 1 → the run is FAILED. Report the script's `FAILED — <reason>` line and STOP.
  Fails-closed cases: missing/invalid JSON, missing `stats` (not a Playwright report), zero tests found.

### Contract shape (what the script writes)

```json
{
  "run_id": "<string>", "suite": "functional",
  "started_at": "<ISO or empty>", "duration_s": <number>,
  "tests_total": <n>, "passed": <n>, "failed": <n>, "skipped": <n>,
  "failures": [ { "test": "<suite > spec title>", "file": "<spec file>", "error": "<first line>" } ]
}
```

`flaky` results count as failed (retries are 0 by convention — flake detection is
corroborate-2-sources' job, never Playwright retries).

---

## Tools

Bash (`node`), Read — no MCP, no model calls.

## Data

- Reads: `reports/<run_id>/results.json`
- Writes: `reports/<run_id>/contract.json`

## Hard rules

1. Never hand-parse the report — the script is the parser; its fixtures live in `tests/fixtures/functional/`.
2. Fails closed — a malformed report is a FAILED run, never an empty-green contract.
3. Behavior check: `powershell -File tests/func-contract-check.ps1`.
