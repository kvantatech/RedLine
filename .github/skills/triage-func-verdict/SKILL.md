# triage-func-verdict
> Draft Jira ticket text for a red functional verdict — 1 AI narration line + deterministic template.

**Type:** skill (1 model narration) · **Used by:** func-run-one · **Status:** LIVE (2026-07-08)

---

## Prompt

You will draft a Jira regression ticket for a red functional verdict. Follow these steps exactly.

### 1 — Read inputs

**Inputs** (passed by the workflow): `run_id`, `confirm_run_id` (from O4).

Read: `reports/<run_id>/verdict.json`, `reports/<run_id>/contract.json`.

### 2 — Write ONE narration line (model call)

Exactly one sentence describing what broke. Rules:
- Neutral tone. No blame, no root-cause guessing.
- Name the failing test(s), the first error line, team, and env.
- Example: "The wizard's 'creates a team' flow fails on redline-dashboard local as of
  2026-07-08 — expect(locator).toBeVisible() failed on the team-slug input."

### 3 — Assemble the draft ticket (Jira wiki markup — NOT markdown)

```
h2. Functional Regression — Auto-detected

Team: <team>
Env: <env>
Run ID: <run_id>
Suite: functional (Playwright)
Verdict: red
Date: <started_at from contract, date part only>
Summary: [NARRATION]

h3. Failing tests

| Test | File | Error |
| <failing_tests[].test> | <file> | <error> |

h3. Run stats

- Tests: <passed>/<tests_total> passed, <failed> failed, <skipped> skipped
- Corroborated: sources=2 (confirmation run <confirm_run_id> also red)

h3. Links

- Run ledger: state/run-ledger.jsonl (filter run_id=<run_id>)

h3. Action required

Human review required before this ticket is filed. Route to reviewer subagent next.
```

All fields except `[NARRATION]` are deterministic — copy values verbatim, no invention.

### 4 — Write output

Write to `reports/<run_id>/jira-draft.md`. Return
`{ "draft_path": "reports/<run_id>/jira-draft.md", "narration": "<the sentence>" }`.

---

## Tools

Read and Write only — one model narration call, no MCP.

## Data

- Reads: `reports/<run_id>/verdict.json`, `reports/<run_id>/contract.json`
- Writes: `reports/<run_id>/jira-draft.md`

## Hard rules

1. **Exactly one model narration line** — the rest is templated from the data.
2. **Draft only** — `file-perf-regression-jira` is the separate human-gated filing step.
3. **Only runs on corroborated red verdicts** — green never reaches this skill.
4. Never quote latency numbers — performance is k6's jurisdiction.
