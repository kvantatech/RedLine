# Architecture — the file-tree pattern

> This repo follows the file-tree agent pattern: *an agent is not built inside a framework — it **is** a file tree*, walked by one general coding agent (Claude Code). Full rationale: this file plus `docs/redline-architecture.html` (interactive diagram); per-change specs and plans live under `docs/superpowers/`.

## The five building blocks

```
WORKFLOWS  →  SKILLS  →  SUBAGENTS  →  MCP  →  DATA
```

| Block | Location | What it is |
|---|---|---|
| **Workflow** | `.claude/workflows/<name>/` | A recipe — a fixed, testable, ordered composition of skills. The developer owns control flow. |
| **Skill** | `.github/skills/<name>/SKILL.md` | One job: Prompt (instructions) + Tools (MCPs) + Data (files it reads/writes). Independently testable, no model judgment. |
| **Subagent** | `.github/agents/<name>.agent.md` | A skill that **earned** a model call — justified only by (a) open-ended judgment or (b) large-context isolation. Only **3** qualify. |
| **MCP** | `.claude/settings.json` | Outside data/tools, registered **phase-of-need** (k6 + Playwright P0 · Grafana P2 · Jira + Slack P3 · GitHub P5). |
| **Data** | `baselines/ state/ envs/ reports/ logs/` | Baselines, the idempotency ledger, the proven tier (read-only), transient artifacts. |

**Burden-of-proof rule:** a fixed deterministic path is the default; a model call must be justified in writing.

## The 3 subagents (the only model loops)

- **`reviewer`** — independent sanity-check of a proposed perf-regression Jira before it is filed. Runs in its **own context** to avoid anchoring on the triage framing; does a dual-pass (conformance, then independent quality) and verifies the **≥2-corroborating-signals** gate (the original red run *and* the O4 confirmation re-run must both be red — see `corroborate-2-sources`) before approving. Covers both approve and reject paths. The single most-important model call in the system.
- **`script-author`** — generative authoring of a new k6 script (the verbose `explore → generate → verify` interaction via `k6 x agent`). **Only the generative step** is the subagent; explore / scrub / learn / verify / conventions / draft-PR are deterministic skills the `perf-author` workflow owns.
- **`spec-author`** — generative authoring of a new Playwright functional suite (added
  2026-07-08 with the functional suite). Same justification clause as `script-author`:
  generation + large-context isolation. Only the generative step; explore / scope /
  verify / graduate are deterministic skills owned by `func-author`.

Everything else — running k6, parsing the JSON summary, comparing to baseline, curating baselines, building deep-links, the 5 profile skills, the deploy gate — is a **deterministic skill**, not a model call.

## Human gates & autonomous guardrails

### Where humans review (and where they don't)

The agent has exactly **three human touch-points** across its two core workflows. Everything else runs without input.

| Gate | Workflow | When | What the human decides |
|---|---|---|---|
| **Entry type gate** | `perf-author` step 0 | Before exploration starts | `api` or `browser` — sets auth pattern and metric scope for the whole authoring run |
| **`scope-review`** | `perf-author` step 4a | After script is authored, **before** verify runs | Confirms endpoints, auth placement, metric exclusions, and open questions. APPROVED → verify proceeds; redirected → revise and re-present |
| **`reviewer` sign-off** | `perf-run-one` | After triage, **before** any Jira is filed | Independent dual-pass judgment (≥2-source gate: original red + confirmation re-run must agree). Hard rule: no Jira without this sign-off |

**Everything between these gates is autonomous.** The verify fix loop, selector debugging, and run-compare-triage chain never pause for user input.

### `verify-k6-script` — autonomous fix loop (≤3 rounds)

When a k6 script fails during verify, the agent self-diagnoses without asking the user:

1. **Consult k6 docs first** — `mcp__k6__get_documentation` / `mcp__k6__list_sections` before guessing at API fixes
2. **Live browser exploration** — if a selector or interaction fails, use Playwright MCP autonomously:
   - `browser_navigate` → `browser_snapshot` (accessibility tree)
   - `browser_evaluate` with a shadow-DOM walk to find elements behind custom element shadow roots
   - `browser_click` to confirm the selector before writing it into the script
3. **Edit → re-validate → re-run** — one cycle per round; hard stop at round 3 with FAIL + root cause

Known demo-web / k6-browser gotchas the agent checks first (saves rounds):
- **`goto(BASE_URL)` race** — shell HTML is 200 immediately; JS detects 401 and async-redirects to login. Fix: navigate directly to the WS-Fed login URL.
- **Shadow DOM** — all shell chrome uses `app-*` custom elements behind shadow roots. CSS `#id #child` fails across shadow boundaries. k6 `locator()` pierces shadow DOM when given the host element tag+id (e.g. `app-icon-button#menu-button`).
- **Multiple Back buttons** — use `.first()` to avoid strict-mode violation.
- **`mcp__k6__run_script` cannot run browser scripts** — the tool passes `--vus/--iterations` CLI flags that override `scenario.options.browser`. Browser scripts must run via `Bash: k6 run <path>` with env vars.

## Compression is a good day, not a migration

Teams burn quarters building agents *inside* frameworks (LangChain, the Agent SDK, Semantic Kernel) — then a model update or vendor feature replaces the framework and forces a rewrite. At the file-tree layer there is no framework to rip out, only files: a new capability lands at whatever layer it matches and the tree **absorbs** it without changing shape. A model that compresses a skill into a built-in tool is a good day, not a migration.

## The 5 → 2 subagent collapse (we already ran this move once)

v1 modeled `TestRunner`, `BaselineComparer`, and `BaselineCurator` as standing subagents — three model loops. None earns a model call (no judgment — just running k6 and threshold arithmetic), so each collapsed into a deterministic **skill**:

```
v1 (5 subagents — standing model loops)     v2 (2 subagents + deterministic skills)
─────────────────────────────────────       ────────────────────────────────────────────────────
TestRunner.agent.md          ──▶  skills: run-k6-script + parse-k6-json-summary
BaselineComparer.agent.md    ──▶  skill:  compare-to-baseline  (imports compare-core)
BaselineCurator.agent.md     ──▶  skill:  curate-baselines
Reviewer.agent.md            ──▶  KEEP — reviewer.agent.md        (independent judgment)
ScriptAuthor.agent.md        ──▶  KEEP — script-author.agent.md   (large-context generation)
```

Net effect: **5 subagents → 2.** Model calls — operational loop: 2 (`triage-perf-verdict` prose + `reviewer`), merge/deploy gate: 0, authoring: 1. Everything else is deterministic code.

2026-07-08: the functional (Playwright) suite added `spec-author` as a third subagent —
the same generation clause `script-author` passed, applied to a second test type. The
collapse discipline holds: running suites, parsing reports, and verdicts all landed as
deterministic skills (`run-playwright-suite`, `parse-playwright-summary`, `func-verdict`).
