# RedLine (runtime)

> **Status: v0.9 — core engine complete, dashboard UI in progress.**
> The agent runtime (skills, workflows, baselines, deterministic deploy gate) is built and
> exercised end-to-end; the dashboard front-end is still being refined. See
> **[STATUS.md](STATUS.md)** for the per-phase build state and the current open items,
> and **[ROADMAP.md](ROADMAP.md)** for what's next.

**Zero-infrastructure QA for teams that don't want to run test infrastructure.**
No Kubernetes, no operator, no server to maintain — `git clone` + `node dashboard/server.mjs`
in any repo and you have performance (k6) and functional (Playwright) testing with a
red/green baseline per test, a deterministic zero-model deploy gate, flake corroboration
(a red must reproduce before anyone is alerted), and human-gated escalation to Jira/Slack.
Built for small teams; runs on a laptop or one CI runner. (Results from CI in other
repos/clusters can also merge into the dashboard — see [tools/README.md](tools/README.md).)

The **runtime repo** for RedLine, a universal QA AI agent usable by any company — two suites,
one spine: **functional (Playwright)** and **performance (k6)**. On performance, it runs k6
tests, compares results to red/green baselines, triages regressions into reviewed Jira drafts,
authors new k6 scripts, and curates baselines. On functional, it runs Playwright suites, triages
regressions the same pass/fail way, and authors new suites via `spec-author`. All of it composes
deterministic **skills** into a few **workflows**, with exactly **3 model-calling subagents**.

> **This agent is a file tree, not a framework.** One general coding agent walks it. No LangChain / Agent SDK / Semantic Kernel; no Python or C control plane.

> 📋 **Design and current state live in this repo.** Start with
> **[docs/redline-architecture.html](docs/redline-architecture.html)** (interactive architecture
> diagram), then **[AGENTS.md](AGENTS.md)** for the file-tree agent pattern and hard rules,
> **[PRODUCT.md](PRODUCT.md)** for what it is and who it's for, **[STATUS.md](STATUS.md)** for
> the per-phase build state, and **[ROADMAP.md](ROADMAP.md)** for decisions and planned work.
> Per-change specs and plans are under [docs/superpowers/](docs/superpowers/).

## Getting started — the RedLine onboarding wizard

Want performance tests for your team? You don't need to be a performance engineer. Launch the wizard:

```
node dashboard/server.mjs        # → http://127.0.0.1:4242
```

Answer a few plain-language questions — your team name, the API or the user journey you care about —
and the agent creates the k6 test, runs the first 10-iteration benchmark, and sets your red line,
live in front of you. Prereqs: Claude Code + k6 ≥ 2.0 installed. See [dashboard/README.md](dashboard/README.md).

## Status

| Item | State |
|---|---|
| Build phase | **P1 COMPLETE — P2 delivery surface #2 authored early** |
| AI agent license | **ACTIVE** |
| Design baseline | v2 skills-first (planning repo `agent/WORKFLOWS.md`) |
| **Organised by** | **team** — add as many as you like; example teams ship with the repo |

> **Teams:** RedLine is organised by team — you create one folder per team and add its scripts. Drafts are authored in `workbench/<team>/`, proven, then graduated to `envs/<team>/`; baselines live at `baselines/<team>.<profile>.json`. The repo ships with example teams to copy — `demo-web` (full k6 profile set + browser journey), `demo-api`, `saucedemo-team` (Playwright functional), and `redline-dashboard` (the built-in self-test). Add your own with the `dashboard/` onboarding wizard, or fan `perf-author` across every team at once with `mass-onboarding`. See CLAUDE.md § Teams.

### P1 completed milestones (2026-06-10)

| Item | State |
|---|---|
| `run-k6-script` — HTTP + browser, HAR scrub, exit-code contract | ✅ LIVE |
| `parse-k6-json-summary` — k6 v2 JSON → contract.json | ✅ LIVE |
| `compare-to-baseline` + `compare-core` shared library | ✅ LIVE |
| `triage-perf-verdict` — model-narrated Jira draft | ✅ LIVE |
| `reviewer` subagent — dual-pass anti-anchoring | ✅ LIVE |
| RED simulation end-to-end (O1–O6 full path exercised) | ✅ DONE |
| 10-iteration standard locked (per-vu-iterations, 1 VU) | ✅ LOCKED |
| Green/red-only verdicts — amber removed | ✅ LOCKED |
| Baseline seeding rule: API `max(1000, obs×1.2)` · browser `max(floor, obs×1.2)` | ✅ LOCKED |
| `run-ledger` skill — CHECK (O0 gate) + WRITE (post-verdict) | ✅ LIVE |
| demo-web api-benchmark: 10-iter run GREEN (p95=829ms), baseline seeded | ✅ DONE |
| demo-web browser-journey: 10-iter run GREEN (all 6 metrics), baseline seeded | ✅ DONE |
| Both runs on-ledger (schema v1) | ✅ DONE |
| **`run-k6-action` composite Action — delivery surface #2** | ✅ AUTHORED (early, P2 task) |
| `perf-gate-demo-web.yml` dispatch-only caller (report-only, awaits secrets + runner) | ✅ AUTHORED |

### P0 wiring status (2026-06-05)

| P0 item | State |
|---|---|
| Repo + file tree (28 skills · 2 subagents · 7 workflows · data/infra) | ✅ done |
| `envs/` read-only submodules (`prod-stg-build-tests`, `ui-deployments`, pinned `main`) | ✅ done |
| Playwright MCP (`.mcp.json` → `npx -y @playwright/mcp@latest`) | ✅ wired (launch-verified) |
| k6 MCP (`.mcp.json` → `k6 x mcp`) · `k6 x agent init claude-code` · `k6 x docs` | ✅ wired — k6 **2.0.0** installed; MCP responds to `initialize` (protocol 2024-11-05); 5 vendor k6 skills added under `.claude/skills/` |
| `pre-commit` `envs/` read-only guard | ✅ enforced — activate with `git config core.hooksPath .githooks` |
| `tests/smoke.ps1` | ✅ passing |

> MCP servers are defined in `.mcp.json` (Claude Code project-MCP) and auto-enabled by `.claude/settings.json`. The scaffold agent had mistakenly placed `mcpServers` in `.claude/settings.json`; corrected to `.mcp.json` per the convention used by `k6 x agent init`.

## The file tree

```
WORKFLOWS  (.claude/workflows/<name>/)        ← deterministic recipes; the control-flow layer
│  perf-author · perf-run-one · perf-sweep · prod-stg-parity-check · mass-onboarding · baseline-curate-all · func-author · func-run-one
│  Each workflow is a folder with a workflow.md that sequences skill calls.
│
└── call SKILLS  (.github/skills/<name>/SKILL.md)   ← one job each; no judgment
        │  run-k6-script · parse-k6-json-summary · compare-to-baseline · triage-perf-verdict
        │  link-grafana-panel · file-perf-regression-jira · notify-responsible-team · curate-baselines
        │  + k6 profile skills (benchmark · load · stress · soak · spike) · + 15 more
        │  run-playwright-suite · parse-playwright-summary · func-verdict · verify-playwright-suite · triage-func-verdict (functional)
        │
        │  Each skill has three sections:
        │    Prompt — exact instructions (deterministic, no model call by default)
        │    Tools  — narrow MCP allowlist for this skill only
        │    Data   — which files it reads / writes
        │
        └── (only when earned) SUBAGENTS  (.github/agents/<name>.agent.md)   ← 3 model loops only
                │  reviewer      — independent judgment; dual-pass + ≥2-source gate (anti-anchoring)
                │  script-author — large-context k6 script generation via k6 x agent
                │  spec-author   — large-context Playwright functional-suite generation
                │
                └── use MCP TOOLS  (.mcp.json)   ← phase-of-need; never all at once
                        │  P0: k6 x mcp · playwright
                        │  P2: + grafana
                        │  P3: + jira · slack
                        │  P5: + github
                        │
                        └── read / write DATA
                                baselines/<team>.<profile>.json  ← red/green p95 thresholds
                                state/run-ledger.jsonl           ← idempotency; de-dupe key per deploy
                                envs/*                           ← READ-ONLY submodules
                                reports/                         ← transient artifacts (gitignored)
                                logs/                            ← per-run milestones (gitignored)
```

> Root files: `CLAUDE.md` (system prompt + hard rules) · `AGENTS.md` (architecture narrative) · `.claude/settings.json` (MCP enable-list)

## Workflows

**Performance core (2):**

- **`perf-author`** — TYPE-GATE → EXPLORE → LEARN → AUTHOR → **SCOPE-REVIEW[HUMAN]** → VERIFY → DELIVER. Authors a new k6 script for a team (one model step: the `script-author` generation), ending at a draft PR.
  - **Step 0 — entry type gate:** agent asks `api | browser` before exploration. Route determines auth pattern (API: `doLogin()` helper unmeasured; browser: full journey with `browser.newContext()`).
  - **Step 4a — `scope-review` [HUMAN]:** human confirms endpoints, exclusions, auth placement, and metrics before verify runs. Gate: APPROVED → proceed; redirected → revise and re-present.
  - **Step 5 — `verify-k6-script` (autonomous fix loop):** 3-round self-healing loop — uses `mcp__k6__get_documentation` + Playwright MCP (`snapshot`, `evaluate` shadow-DOM walk, `click`) to diagnose failures without user input. Browser scripts run via `k6 run` CLI (not `mcp__k6__run_script` — that tool passes `--vus/--iterations` which overrides `options.browser`).
- **`perf-run-one`** — RUN → COMPARE → TRIAGE → REVIEW → proof → CURATE. The operational loop, in two trigger shapes: cron (trend feed) and per-deploy/canary (the blocking "nothing ships without proof" gate). Two model steps: `triage-perf-verdict` (prose) and `reviewer` (judgment).

**Fleet (compose the same skills, fanned out):**

- **`perf-sweep`** — `teams × profiles × envs`; one cost-capped adversarial cross-check; stops at one cited report (filing is a separate human gate).
- **`prod-stg-parity-check`** — set-diff STG vs PROD; authors the missing PROD scripts (closes the parity gap).
- **`mass-onboarding`** — fan `perf-author` across every team you've defined, in one pass.
- **`baseline-curate-all`** — fan `curate-baselines`; draft baseline-bump PRs.

The merge/deploy gate **`run-k6-action`** (run → JSON summary → `compare-core` → exit code) is a fully deterministic composite Action with **zero model calls** — in enforce mode, exit 99 (red) / 97 (crash) blocks the merge / canary widening. Lives at `.github/actions/run-k6-action/`; its `compare-core.js` is the one executable verdict implementation shared with the agentic loop.

## Functional suite (2026-07-08)

The functional twin of the performance loop above — 2 core workflows + 6 skills + 1 subagent,
same doctrine (deterministic skills, model calls only where earned). The shipped example is
`redline-dashboard` (RedLine's own dashboard, local, no SSO) — the built-in functional self-test;
copy it to author a suite for your own team under `<team>/functional/`.

**Workflows:**

- **`func-author`** — explore live (Playwright MCP) → `spec-author` generates → scope-review
  `[HUMAN]` → verify (≤3 rounds) → graduate to `envs/<team>/functional/`.
- **`func-run-one`** — run → verdict (green/red) → corroborate reds → **heal test rot**
  (proven suites: locator/timing repairs proposed as a graduation diff, app bugs never
  masked) → triage → reviewer sign-off → Jira draft. The functional twin of `perf-run-one`.

**Skills:**

- **`run-playwright-suite`** — "Execute one team's Playwright functional suite and save the raw JSON results artifact."
- **`parse-playwright-summary`** — "Normalize a Playwright JSON report into the canonical functional contract shape."
- **`func-verdict`** — "Map a functional contract to green | red — the two-verdict rule, pass/fail edition."
- **`verify-playwright-suite`** — "Validate → run → fix a drafted functional suite. Bounded rounds; flakes recorded, never chased."
- **`heal-playwright-suite`** — "Heal a proven suite that broke in production use — locator/timing repairs only, proposed as a graduation diff, never masking a product bug." Per-team toggle in `state/heal-policy.json`: `ask` (default — a human approves the healed diff) or `trust` (auto-graduates after green ×2; files copied, never committed — the uncommitted diff stays the audit surface).
- **`triage-func-verdict`** — "Draft Jira ticket text for a red functional verdict — 1 AI narration line + deterministic template."

**Subagent:**

- **`spec-author`** — "Generate a Playwright functional suite from a live-explored flow map." The
  3rd subagent (with `reviewer`, `script-author`); same generation + large-context-isolation
  justification as `script-author`.

## Build phases

| Phase | Outcome |
|---|---|
| P0 | ✅ **Scaffold.** Repo tree, phase-of-need MCPs (k6 + Playwright), 2 subagent stubs + collapsed skills, hooks, `prompt-tests/`, baseline grammar, `run-ledger` scaffold. |
| P1 | ✅ **Complete.** All skills live, RED path exercised, 10-iter standard + green/red locked, `run-ledger` live, both demo-web profiles baselined, `run-k6-action` gate authored. |
| **P2 (current)** | `run-k6-action` ✅ done. `corroborate-2-sources` ✅ LIVE as a **confirmation re-run** (no Grafana dependency — Mimir echoes the same OTLP data). `link-grafana-panel` ✅ LIVE as a **pure URL-builder** to the LGTM `Perf - <team>` dashboard (no token needed). Grafana MCP (reviewer enrichment only) **deferred — not MVP critical**. Remaining P2 prerequisite: wire `perf-gate-demo-web.yml` (needs repo secrets + STG-reachable runner). |
| P3 | Jira/Slack MCP — ★ first reviewed auto-Jira (requires `decision == SIGN_OFF` **and** `sources >= 2` — red confirmed by re-run); `notify-responsible-team`. |
| P4 | `script-author` live — author working draft scripts via `k6 x agent` (**prerequisite for `mass-onboarding`**). |
| P5 | `curate-baselines` PR path + weekly cron + GitHub MCP — ★ full SDLC loop; `envs/demo-web/` becomes a read-only submodule. |

Task-by-task steps for each phase are in the planning repo's `agent/PLAN.md`.

## Subagents (3)

- **`reviewer`** — independent, anti-anchoring sanity check of a proposed Jira; dual-pass + ≥2-source gate before approval.
- **`script-author`** — large-context generative authoring of a new k6 script.
- **`spec-author`** — large-context generative authoring of a new Playwright functional suite.

Everything else is a deterministic skill — see `AGENTS.md` and the planning repo.
