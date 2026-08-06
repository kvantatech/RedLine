# func-verdict
> Map a functional contract to green | red — the two-verdict rule, pass/fail edition.

**Type:** skill (deterministic, no model call — thin wrapper over `verdict.mjs`) · **Used by:** func-run-one, corroborate-2-sources · **Status:** LIVE (2026-07-08)

---

## Prompt

Run the script — no judgment:

```
node .github/skills/func-verdict/verdict.mjs reports/<run_id>/contract.json <team> reports/<run_id>/verdict.json
```

- Exit 0 → verdict written (both green and red exit 0 — branch on `overall_verdict` in the file).
- Exit 1 → FAILED (malformed or zero-test contract). Report `FAILED — <reason>`, STOP.

Verdict rule (hard rule 6, functional edition): **green** requires `failed == 0` **and**
`passed == tests_total` — every test actually passed. Anything else → **red**: a real
failure (`failed > 0`), or an incomplete run where tests were skipped (`passed < tests_total`,
e.g. a `beforeAll` error). A suite where nothing failed but nothing passed is NOT an all-clear.
There is no amber, no threshold, no baseline file — k6 owns performance numbers.

---

## Tools

Bash (`node`), Read — no MCP, no model calls.

## Data

- Reads: `reports/<run_id>/contract.json`
- Writes: `reports/<run_id>/verdict.json`

## Hard rules

1. No baselines for functional suites — by design (see `baselines/README.md`).
2. Fails closed on malformed/zero-test contracts.
3. Behavior check: `powershell -File tests/func-contract-check.ps1`.
