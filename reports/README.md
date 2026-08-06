# reports/ — transient run outputs + Jira drafts (P0 scaffold)

Working directory for **transient** artifacts produced during a run:

- Dated final run reports and per-run artifact bundles (HTML/Markdown verdict
  summaries).
- Generated dashboards.
- **Jira create drafts** (`*.jira.md`) awaiting Reviewer sign-off before
  `jira-create` submits them.

## Gitignored except this README

Everything in `reports/` is **gitignored** except this `README.md`. The contents
are transient per-run output, not durable state — durable state lives in
`state/` (the run ledger). Do not rely on anything else here being committed.
Expected `.gitignore`:

```gitignore
reports/*
!reports/README.md
```

A Jira draft here must carry the Reviewer sign-off marker (`Reviewed-by:`)
before it can be committed/submitted — see `.githooks/pre-commit` check (c).
