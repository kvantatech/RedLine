# Changelog

All notable changes to RedLine. Dates are release dates.

## [Unreleased] — planned

- **Database testing**: first-class Postgres support (pgbench-style benchmarks) under the same red/green baseline and deterministic gate that cover HTTP and browser today.
- **Dashboard graphs**: richer, more readable trend charts and a friendlier results view.
- **AI chatbot**: ask the dashboard plain-language questions about recent runs, answered from the run ledger.

## [0.9.4] — 2026-08-06

First public release. 🎉

The core engine is complete and exercised end-to-end: k6 performance + Playwright functional suites, red/green baselines, the deterministic zero-model-call deploy gate, flake corroboration, human-gated Jira/Slack escalation, scheduling, cross-team insights, multi-channel alerting, and RedLine-as-an-MCP-server.

Hardening applied between the internal v0.9 snapshot and this release:

- **Dashboard:** same-origin guard (`ALLOWED_ORIGINS`) + Host-header pinning on `dashboard/server.mjs` — closes CORS simple-request and DNS-rebinding attacks against the localhost server.
- **CI action:** all `run:` blocks in `.github/actions/run-k6-action/action.yml` now take inputs via `env:` (shell-injection hardening for reusable-action consumers); `playwright` pinned to `1.54.0`; `grafana/setup-k6-action` pinned to a commit SHA instead of a mutable tag.
- **Self-test:** the built-in `redline-dashboard` functional suite re-pointed at the current UI (was asserting a screen removed in the 2026-07-15 IA rework).

## [0.9.0] — 2026-08-05 (internal)

Internal snapshot: P0–P3 phases built — scaffold, core loop, deploy gate, notify/file — plus the 2026-07-16 free-tier drop (scheduling, alerting channels, cross-team dashboard, MCP server, shared-ledger sync).

---

RedLine's development began in June 2026. This public repository is a clean-room snapshot of that work, released in August 2026; earlier phases (P0 scaffold through the July free-tier features) were built privately from June onward.
