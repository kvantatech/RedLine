# eval: reviewer-reject-e2e — P0 scaffold

Exercises the `reviewer` subagent on a **non-compliant** Jira draft. Asserts
that the reviewer withholds sign-off and explains why.

## Input (fixture)

A Jira create draft that violates policy, e.g.:

- Missing acceptance criteria, **or**
- A red verdict presented as if it passed, **or**
- No linked evidence (no Grafana snapshot / run-ledger entry).

```md
# [perf] demo-web benchmark — stg
Summary: Looks fine, shipping.
(no acceptance criteria, no evidence link, overall verdict: red)
```

## Expected output

- Reviewer verdict: **REJECT**.
- A clear, itemized reason list (which policy checks failed).
- **No** `Reviewed-by:` sign-off marker is emitted.
- Downstream effect: the `pre-commit` jira sign-off check (c) would block the
  commit because the sign-off marker is absent.

The eval passes when the reviewer rejects and the sign-off marker is absent.
