# Roadmap

## What's next (summary)

- **Wire the CI gate for real** — `perf-gate-demo-web.yml` needs repo secrets + a staging-reachable runner (P2 remainder).
- **`script-author` live via `k6 x agent`** (P4) — the prerequisite for `mass-onboarding`.
- **`curate-baselines` PR path + weekly cron + GitHub MCP** (P5) — closes the full SDLC loop.
- **First live-fire of the alert senders** — PagerDuty / OpsGenie / MS Teams are dry-run-tested; a real key in `.env` is all that's missing.
- **Near-term features (planned, not built):** database/Postgres testing, a dashboard-graphs upgrade, and a log-aware Q&A chatbot (see 2026-08-07 below).
- **Deferred by decision:** remote-dispatch control plane (paid tier, only if real users ask); runtime vision models (see 2026-07-27 below).

Decisions and planned work, dated; newest first.

## 2026-08-07 — near-term feature roadmap

Three features planned for upcoming releases (not yet built):

1. **Database testing (Postgres).** First-class database benchmarking: pgbench-style workloads under the same red/green baseline and deterministic gate that cover HTTP and browser today. Extends the agent's substrate from web and API to the database tier.
2. **Dashboard graphs upgrade.** Richer, more readable trend charts and a friendlier, more self-serve results view.
3. **AI chatbot (log-aware Q&A).** A plain-language interface over the run ledger, so anyone can ask "what regressed yesterday?" and get an answer grounded in the actual run history. A natural fit for the existing MCP server.

## 2026-07-27 — Runtime-AI stays out of the gate; DOM-less exception noted, deferred

Evaluated runtime vision-model UI automation as a primary execution path. **DECISION
(binding): RedLine's architecture holds** — AI stays at authoring/healing time,
compiling to deterministic, zero-model-call Playwright/k6 tests; a runtime VLM never
becomes the primary execution path (violates hard rule 8, and the evidence backs the
rule: best agents score 14–31% task success on WebArena/AndroidWorld, far below
oracle-grade).

**One real exception, not scheduled:** Playwright is structurally blind on DOM-less
surfaces — canvas-rendered UIs (procedural Flame/Flutter and similar) and native
mobile have no DOM to grab. There, a vision-grounded tool isn't a stylistic choice, it's
the only option. If a canvas/native-mobile target ever needs QA coverage, **adopt an
existing MIT-licensed, self-hostable vision-grounded runner scoped to that segment — do
not rebuild it.** No demand today; do not build ahead of a real target.

## 2026-07-16 — Positioning (validated): zero-infra QA for small teams, in any repo

**Market assumption VALIDATED same day** — Anton spoke to real teams: they prefer
clone-and-run over installing a Kubernetes operator. The positioning is the original
deployment plan: **RedLine is for small teams that don't want to run test
infrastructure — it runs in any repo** (laptop or one CI runner; no cluster, no
operator, no server to maintain).

A "judgment layer, bring any runner" framing was considered and **walked back the same
day**: the judgment (baselines, gate, flake corroboration) is a differentiator inside
the product, but not deep enough to carry a standalone execution-agnostic platform
story. The JSONL ingestion contract (`tools/README.md`) stays as a shipped feature —
CI runs from other repos/clusters merge into the dashboard — it is just not the
headline. Do-not-pivot-to-infrastructure still stands.

## 2026-07-16 — Platform gap analysis → free-tier scope + paid-tier deferral

A gap analysis against the established CI-native testing platforms picked five gaps
worth closing and one deliberately deferred.

**DECISION (binding): the full runner-agent control plane is deferred to a future PAID
version.** "Full control plane" = the dashboard dispatching runs *into* remote Kubernetes
clusters via deployed runner agents (queue/dispatch protocol, agent auth, artifact
shipping, per-cluster API keys). Do not build any of that in the free tier. The free tier
gets **read-side multi-cluster only** (item 5 below): remote CI runs push their ledger
lines to one store the dashboard reads — "one dashboard, many clusters" for results, not
for dispatch. Revisit the paid control plane only when a real user asks for remote
dispatch.

Free-tier implementation order (each ships independently — **all five shipped 2026-07-16**):

1. **Scheduling** — timed runs from the dashboard (schedules file + timer loop in
   `dashboard/server.mjs`, reusing the same run path as the Run test page). ~1–3 days.
2. **Alerting channels** — PagerDuty, OpsGenie, MS Teams alongside the existing Slack
   webhook (per-team channel config; each channel is a JSON POST with a key), plus
   Grafana alert rules on the already-emitted OTLP metrics. ~3–5 days.
3. **Cross-team dashboard** — roll-up view on global Insights: per-team health, flaky
   tests (confirm-run flake data is already in the ledger). ~2–4 days.
4. **MCP server** — expose RedLine itself as an MCP server (list_tests, run_test,
   get_run, get_baseline, list_flakes) so external AI assistants can drive it. ~2–3 days.
5. **Shared-ledger sync** — CI gate runs push their ledger line to one central store;
   dashboard reads it. The free 80% of multi-cluster. ~1–2 weeks.

Explicitly skipped (for now): more test-tool executors beyond k6/Playwright, user
accounts/RBAC/SSO, AI auto-fix PRs against product code.
