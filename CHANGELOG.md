# Changelog

All notable changes to RedLine. Dates are release dates.

## [0.9.4] — 2026-08-06

First public release. 🎉

The core engine is complete and exercised end-to-end: k6 performance + Playwright functional suites, red/green baselines, the deterministic zero-model-call deploy gate, flake corroboration, human-gated Jira/Slack escalation, scheduling, cross-team insights, multi-channel alerting, and RedLine-as-an-MCP-server.

Hardening applied between the internal v0.9 snapshot and this release:

- **Dashboard:** same-origin guard (`ALLOWED_ORIGINS`) + Host-header pinning on `dashboard/server.mjs` — closes CORS simple-request and DNS-rebinding attacks against the localhost server.
- **CI action:** all `run:` blocks in `.github/actions/run-k6-action/action.yml` now take inputs via `env:` (shell-injection hardening for reusable-action consumers); `playwright` pinned to `1.54.0`; `grafana/setup-k6-action` pinned to a commit SHA instead of a mutable tag.
- **Self-test:** the built-in `redline-dashboard` functional suite re-pointed at the current UI (was asserting a screen removed in the 2026-07-15 IA rework).

## [0.9.0] — 2026-08-05 (internal)

Internal snapshot: P0–P3 phases built — scaffold, core loop, deploy gate, notify/file — plus the 2026-07-16 free-tier drop (scheduling, alerting channels, cross-team dashboard, MCP server, shared-ledger sync).
