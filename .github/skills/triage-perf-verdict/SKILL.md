# triage-perf-verdict
> Draft Jira ticket text for a red verdict — 1 AI narration line + deterministic template.

**Type:** skill (1 model narration) · **Used by:** perf-run-one · **Status:** LIVE

---

## Prompt

You will draft a Jira regression ticket for a red performance verdict. Follow these steps exactly.

### 1 — Read inputs

**Inputs** (passed by the workflow):
- `run_id` — the run identifier
- `grafana_url` — deep-link URL from O7 `link-grafana-panel`; empty string `""` if O7 was skipped or OBSERVE!=1

Read both files:
- `reports/<run_id>/verdict.json`
- `reports/<run_id>/contract.json`

### 2 — Write ONE narration line (model call)

From the verdict and contract, write exactly one sentence describing what regressed and by how much.
Rules:
- Neutral tone. No blame, no guessing at root cause.
- Name the endpoint, the p95, the threshold, and the delta.
- Example: "GET /api/config p95 climbed to 1250ms (+350ms, +38.9% over the 900ms red threshold) on demo-web STG as of 2026-06-09."
- If multiple endpoints are red, name all of them in the same sentence.

### 3 — Assemble the draft ticket

Fill the template below with values from the verdict/contract + the narration line.
All fields except `[NARRATION]` are deterministic — copy the values verbatim, no invention.

```
h2. Performance Regression — Auto-detected

Team: <team>
Env: <env>
Run ID: <run_id>
Verdict: red
Date: <started_at from contract, date part only>
Summary: [NARRATION]

h3. Failing endpoints

| Endpoint | p95 ms (Result) | Red threshold ms | Delta |
| <name> | <p95_ms> | <p95_red_ms> | +<ms> (+<pct>%) |

h3. Checks

- Total iterations: <contract.iterations>
- Check pass rate: <contract.checks.pass_rate × 100>%
- Error rate: <endpoint error_rate>

h3. Links

- Grafana: <grafana_url if non-empty, else "[unavailable]">
- Run ledger: state/run-ledger.jsonl (filter run_id=<run_id>)

h3. Action required

Human review required before this ticket is filed. Route to reviewer subagent next.
```

> Template is Jira wiki markup (h2./h3., pipe-delimited tables) — NOT markdown. This is the
> format that file-perf-regression-jira copies verbatim into the Jira description field.

### 4 — Write output

Write the assembled draft to `reports/<run_id>/jira-draft.md`.

Return:
```json
{
  "draft_path": "reports/<run_id>/jira-draft.md",
  "narration": "<the one-sentence narration>"
}
```

---

## Tools

Read and Write only — one model narration call, no MCP.

---

## Data

- **Inputs:** `run_id` (string), `grafana_url` (string — from O7; empty string if unavailable)
- **Reads:** `reports/<run_id>/verdict.json`, `reports/<run_id>/contract.json`
- **Writes:** `reports/<run_id>/jira-draft.md`

---

## Hard rules

1. **Exactly one model narration line** — the rest of the ticket is templated from the data.
2. **Draft only** — `file-perf-regression-jira` is the separate human-gated filing step.
3. **Only runs on red verdicts** — green and no-baseline never reach this skill.
4. **p95 everywhere** — never quote p50 or p99 in the narration.

---

Frozen skill registry: `AGENTS.md` in this repo
