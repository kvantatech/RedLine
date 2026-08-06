# RedLine — implementation status

The current-state view of the build. Human-facing companion to the interactive
architecture diagram (`docs/redline-architecture.html`). Last updated **2026-07-27**.

> **How this file is maintained today.** The `build-status` workflow that would
> regenerate this from a `status.json` SSOT is a P0 **stub** — and the planning repo
> the SSOT was meant to live in was never created. So for now this file is
> hand-maintained. The `<!-- AUTOGEN:status -->` region below is written by hand but
> kept in the shape a renderer would own, so `build-status` can take it over later
> without a reformat.

## Positioning (settled 2026-07-16)

**Zero-infrastructure QA for small teams that don't want to run test infrastructure.**
No Kubernetes, no operator — `git clone` + `node dashboard/server.mjs` in any repo.
Validated with real user conversations. The full runner-agent control plane (dispatching
runs into remote clusters) is **deferred to a future paid version**; the free tier gets
read-side multi-cluster only. See `ROADMAP.md`.

## Build phases

| Phase | State | What's in it |
|---|---|---|
| **P0 — Scaffold** | ✅ done | Repo tree, phase-of-need MCPs (k6 + Playwright), subagent stubs, hooks, baseline grammar, run-ledger scaffold. |
| **P1 — Core loop** | ✅ complete | All skills live, RED path exercised end-to-end, 10-iteration + green/red locked, run-ledger live, both demo-web profiles baselined, `run-k6-action` gate authored. |
| **P2 — Deploy gate** | ✅ gate green | `run-k6-action` ran GREEN in CI (report-only, `ubuntu-latest`). `corroborate-2-sources` LIVE as a confirmation re-run. `link-grafana-panel` LIVE (pure URL builder, no token). Grafana MCP deferred to reviewer-enrichment only. |
| **P3 — Notify + file** | 🔶 in progress | `file-perf-regression-jira` + `notify-responsible-team` LIVE (dry-run default; filing stays human-gated). Slack via incoming webhook. `emit-otlp-and-prometheus` LIVE. `Perf - demo-web` dashboards live in staging + prod. |
| **P4 — Authoring** | ⬜ pending | `script-author` live via `k6 x agent` — prerequisite for `mass-onboarding`. |
| **P5 — Curate + SDLC** | ⬜ pending | `curate-baselines` PR path, weekly cron, GitHub MCP. O10 curate is a stub. |

<!-- AUTOGEN:status -->
## Tallies (computed — do not hand-edit once build-status owns this)

| Thing | Count |
|---|---|
| Workflows | 9 |
| Skills | 37 |
| Subagents (model calls) | 3 |
| MCP servers (phase-of-need) | 6 |
| Teams defined | 8 (demo-web, demo-api, saucedemo-team, redline-dashboard, quickpizza-team, saucedemo-team, + crm/new-test scaffolds) |
| Baselines seeded | 5 (demo-web api-benchmark + browser-journey, demo-api api-benchmark, quickpizza-team api-benchmark, saucedemo-team browser-journey) |
| AI agent license | ACTIVE |

**Invariants:** two verdicts only (green \| red) · deploy gate = 0 model calls · only 3
model calls exist · 10 iterations minimum · filing is human-gated · STG-only (1-VU PROD
benchmark carve-out).
<!-- /AUTOGEN:status -->

## Shipped 2026-07-16 (free-tier roadmap, all on `origin/main`)

1. **Scheduling** — Schedules nav page + 30s timer in `server.mjs`; runs land with `trigger: cron`.
2. **Alerting channels** — Slack + MS Teams + PagerDuty + OpsGenie via `notify.mjs`; Grafana alert rules generated from baselines (`gen-alerts.mjs`, 8 rules).
3. **Cross-team dashboard** — team-health + flaky-test panels on global Insights.
4. **MCP server** — `dashboard/mcp-server.mjs`, 7 tools, zero deps (no filing tool — hard rule 1).
5. **Shared-ledger sync** — remote JSONL feeds merge into all read views; `tools/verdict-to-ledger.mjs` + the `tools/README.md` ingestion contract let any runner publish.

## Open items

- **P2:** wire `perf-gate-demo-web.yml` for real (needs repo secrets + an STG-reachable runner); browser-journey gate deferred to an ARC runner (PERF-101).
- **P4/P5:** `script-author`, `curate-baselines` PR path, weekly cron, GitHub MCP still to land.
- **Alerting:** PagerDuty/OpsGenie/Teams senders are dry-run-tested only — first live fire needs a key in `.env`.
- **Grafana:** bring-your-own stack; the OTLP endpoint in `emit-otlp-and-prometheus` is a placeholder to replace. Alert-rules kustomize build verified by inspection (kustomize not installed locally) — confirm with `kubectl kustomize` in CI.
