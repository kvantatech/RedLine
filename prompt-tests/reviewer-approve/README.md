# eval: reviewer-approve — P0 scaffold

Exercises the `reviewer` subagent on a **compliant** Jira draft. Asserts that
the reviewer signs off.

## Input (fixture)

A well-formed Jira create draft:

- Clear summary + acceptance criteria.
- Linked evidence (Grafana snapshot UID + run-ledger dedupe_key).
- Verdict consistent with the data (green or red — not a masked red).

```md
# [perf] demo-web api-benchmark — stg
Summary: p95 within baseline; GET /api/config p95=662ms (threshold 900ms).
Acceptance criteria: ...
Evidence: grafana dashboard_uid=demo-dash-uid, run dedupe_key=<sha256...>
Overall verdict: green
```

## Expected output

- Reviewer verdict: **APPROVE**.
- The canonical sign-off marker is emitted, e.g. `Reviewed-by: reviewer`.
- Downstream effect: the `pre-commit` jira sign-off check (c) passes because the
  marker is present.

The eval passes when the reviewer approves and the `Reviewed-by:` marker is present.
