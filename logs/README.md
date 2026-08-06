# logs/ — per-run milestone logs (P0 scaffold)

Per-run append-only milestone logs (`logs/<run-id>.md`), written by the
`perf-run-log` skill. Records the agent's progress through a workflow (start,
profile resolved, k6 run, parse, compare, verdict, report rendered, Jira
drafted, etc.) for debugging and audit.

- **Append-only:** never rewrite existing log lines.
- Distinct from `state/run-ledger.jsonl`: logs are verbose, human-debugging
  breadcrumbs; the ledger is the durable, deduped record of *runs*.

## Gitignored except this README

Everything in `logs/` is **gitignored** except this `README.md`. Logs are
transient per-run output. Expected `.gitignore`:

```gitignore
logs/*
!logs/README.md
```
