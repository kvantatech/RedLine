# RedLine dashboard — two guided workflows

A guided dashboard designed for a project manager or tech lead, not a performance
engineer. They answer plain-language questions; the agent does the technical work.
The Start screen forks into two workflows:

```
node dashboard/server.mjs        # → http://127.0.0.1:4242 (opens your browser)
node dashboard/server.mjs --no-open
```

Zero dependencies — one Node server, three static files. No `npm install`.

## Workflow 1 · Set up a new test (onboarding)

1. **Before we start** — auto-checks Claude Code, k6 ≥ 2.0, and project files
2. **Your team** — the team slug everything gets filed under (upper case auto-lowered)
3. **Pick your test** — "the API way" (one important endpoint) or "the browser way" (a real user journey)
4. **What to test** — the staging URL; for browser tests, the journey described in plain words;
   optional staging test account (saved only to the gitignored `.env`, never committed)
5. **Create the test** — one click: the wizard spawns **Claude Code headlessly** (`claude -p`),
   which authors `drafts/<team>/<profile>/script.js` following the demo-web conventions,
   validates it, and smoke-runs it — activity streamed live to the browser
6. **First results** — one click: a real 10-iteration run, then the red line is seeded into
   `baselines/<team>.<profile>.json` (`max(1000, observed×1.2)` for API) and shown as friendly cards
7. **What's next** — a copyable handoff message for a developer to wire the deterministic
   CI gate (`run-k6-action`, report-only first); alerts land in `#perf-alerts`

## Workflow 2 · Run & judge a test (operations)

Maps to `perf-run-one` (O0–O9). Stages: **Pick a test** (every team·profile with both a
script and a baseline, freshest verdict shown) → **Run & judge** → **The verdict**.

- The run stage spawns the headless agent through the O-chain: run (O1) → parse (O2) →
  compare via `compare-core` (O3) → on red, ONE confirmation re-run (O4) → Grafana deep link
  (O7) → Jira draft (O5) → **independent reviewer in a separate subagent context** (O8) →
  ledger write (O6). It hard-stops there — **nothing is filed by the run**.
- The verdict stage reads `state/run-ledger.jsonl` (the SSOT) and renders one of four
  outcomes in plain language: **all clear** (green), **a wobble** (red that didn't confirm —
  flake, no escalation), **didn't finish** (crash), or **something got slower** (corroborated red).
- For a corroborated red it shows the gate checklist — confirmed twice (sources 2/2),
  reviewer sign-off, draft ready — plus the exact Jira draft. The **"File the ticket &
  alert the team"** button stays locked until every gate passes (Hard Rule 1), and that
  click is the explicit per-draft human approval `mode=file` requires. Filing then also
  triggers the Slack alert (`notify-responsible-team`) and the jira-filing ledger line.

## How the agent runs (guardrails)

Each headless run is sandboxed by `--allowedTools`, per kind:

- **author / benchmark** — file tools + `Bash(k6 *)` + `Bash(node *)` + k6 MCP validate/docs —
  no git, no Jira, no Slack, no GitHub; writes scoped to `drafts/<team>/<profile>/` and
  `baselines/<team>.<profile>.json`
- **run** — the same, plus `Task` (to spawn the independent reviewer subagent); may write
  `reports/<run_id>/` and append to `state/run-ledger.jsonl`; never files anything
- **file** — file tools + Jira MCP + `curl`/`pwsh` (Slack webhook, Jira REST fallback);
  server-side it is refused unless verdict=red, sources≥2, reviewer SIGN_OFF, draft present,
  and not already filed — and the skill re-verifies the same gates plus the 24 h de-dupe
- STG-only is restated in every prompt; a production URL aborts the run
- 20-minute timeout; a Stop button cancels the process tree

## Schedules (timed runs)

The **Schedules** page runs a test on a timer — daily at HH:MM, optionally only on
selected weekdays. Both kinds are schedulable: performance tests, and functional
(Playwright) suites — a functional schedule's target URL is read from the suite's own
`playwright.config.ts` (`baseURL`), never from the shared wizard state. Times are the
machine's local time; schedules fire only while the dashboard is running (a window it was
closed for is skipped for that day, never queued). Scheduled runs go through the exact
same run path as the Run test page — one agent at a time — and land in the ledger with
`trigger: cron`. Config lives in `state/schedules.json`.

## Remote ledgers — one dashboard, many clusters (read-side)

`state/remote-ledgers.json` lists JSONL feeds this dashboard merges into its Executions,
Tests, and Insights views — results from CI gates running in other clusters/repos appear
next to local runs, tagged with their origin:

```json
[{ "name": "eu-cluster", "url": "https://…/eu-feed.jsonl" }]
```

`url` is an https URL or a local/network path. To publish from a CI gate:
`node tools/verdict-to-ledger.mjs --verdict <verdict.json> --trigger deploy >> feed.jsonl`
and host the growing file anywhere the dashboard can read (raw repo file, S3, share).
Any *other* runner (Jenkins, Testkube, a cron script) can emit the line directly — the
JSONL contract is documented in [tools/README.md](../tools/README.md).
Feeds are read-only: a duplicate run_id keeps the local record, a dead feed degrades to a
`remote_errors` note without breaking the page, and **operational gates (filing, operate,
schedules) stay strictly local** — remote runs are visibility, never actionable state.
Dispatching runs *into* remote clusters is deliberately out of scope for the free tier
(see `ROADMAP.md`, 2026-07-16 decision).

## MCP server — drive RedLine from any AI assistant

`dashboard/mcp-server.mjs` exposes RedLine over MCP (stdio) so Claude Code, Claude
Desktop, or any MCP client can query it and trigger runs. Register it in the client:

```json
{ "mcpServers": { "redline": {
    "command": "node",
    "args": ["<path-to-redline>/dashboard/mcp-server.mjs"] } } }
```

Tools: `list_tests` · `list_runs` · `get_run` · `get_baseline` · `list_flakes` (read the
repo files directly — work with the dashboard closed) · `run_test` · `run_status` (bridge
to the running dashboard so the one-agent-at-a-time guard and ledger flow stay in one
place — these two need `node dashboard/server.mjs` up; override the address with
`REDLINE_DASHBOARD_URL`). Filing stays human-gated — there is deliberately no MCP tool
for it (hard rule 1).

## Files

- `server.mjs` — local HTTP server (binds `127.0.0.1` only), prerequisite probes, the
  headless-Claude job runner, a server-sent-events stream of agent activity, and the
  schedule timer
- `wizard.mjs` — stage definitions and the prompts sent to the headless agent; **edit this
  to change the journey or the agent's instructions**
- `schedule-lib.mjs` — pure schedule math (due/next-fire); `mcp-server.mjs` — the MCP server
- `public/` — static UI (vanilla HTML/CSS/JS, no build step)

State: answers persist to `.local/dashboard-progress.json` (gitignored) — delete it to reset
the wizard. Credentials go to `.env` (gitignored). Stage completion is derived from real
artifacts (script file, baseline file), so re-opening the wizard always reflects reality.
