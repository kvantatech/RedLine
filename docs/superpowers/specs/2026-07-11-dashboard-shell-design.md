# Dashboard shell — Section-rail IA with native Insights (design spec)

> Date: 2026-07-11 · Status: APPROVED (Anton, 2026-07-11) · Origin: approved visual mockup
> (`scratchpad/redline-home-mockup.html`, artifact 5de19fde). Build: **impeccable** for all UI, executed via subagent-driven-development.
> Builds atop branch `feat/runs-view`.

## Context

RedLine's dashboard today is a single guided wizard whose left rail is the wizard's own
step-tracker, plus a Results view reachable at `#runs`. Anton wants a conventional app structure —
a persistent left nav (**Home · Tests · Executions · Insights**), a Home landing page with bold
KPI graphs, a Tests catalog, and a native per-test analytics view — while keeping RedLine's
brass-and-ink identity (visual language settled in the approved mockup).

**Supersession note:** the 2026-07-10 "Results KPI polish" build put a muted KPI row + per-row
history bars inside the Results list. The history bars survive unchanged. The Results-list KPI
row is superseded by the Home page and is removed (Home owns headline KPIs; commits stay in
history).

## Decisions locked with Anton (2026-07-11)

- Nav: **Home · Tests · Executions · Insights**. No Settings section — "settings" here are
  per-test config, nothing app-level worth a section. Theme switcher stays an independent control
  in the rail footer.
- Rename: Workflows → **Tests**. "Total runs" → **"Total executions"**.
- Persistent **＋ Create test** button in a sticky top bar, right of the env pill.
- Wizard launches as a **focused flow** from Create test; the rail stays app-sections. Tests
  page is a catalog, not the wizard.
- **Insights is native from the ledger — no Grafana.** Global panels mirror the Grafana top row;
  clicking a test opens per-test insights where each execution is a hoverable bar (verdict,
  time, value vs threshold, counts).
- **Date-range filter** (Last 7 / 30 / 90 days / All time) on Home, Executions, Insights.
- New **threshold-breach logo** (brass pulse crossing the red line, line centered on the rise)
  replaces the current wordmark block and favicon.
- Everything ships in **one spec** (Anton chose no phasing); the plan sequences it in reviewable
  tasks.

## Goals

1. Persistent section rail + sticky top bar; hash-routed pages: Home, Tests, Executions,
   Insights; wizard as focused flow under `#create`.
2. Home: three bold full-bleed KPI graphs (Pass rate · Red runs · Total executions), recent
   executions list, date-range control — per the approved mockup.
3. Tests: catalog of known tests (team+profile from the ledger), verdict + history bars, click
   through to per-test insights; empty state routes to Create test.
4. Insights: global native panels (Failed by threshold · Pass rate · Pass rate by test ·
   Slowest test p95 — the Grafana top row, ledger-computed) and per-test execution bar charts
   with hover detail and threshold line; bars click through to run detail.
5. New logo; theme toggle independent in rail footer.

## Non-goals

Grafana embed/iframe · app-level Settings page · scheduling & triggers · RBAC · new server
endpoints · fleet multi-team rollups beyond the four global panels · touching the deterministic
gate or any workflow/skill files.

## Hard constraints

- **Two verdicts only: green | red.** Flake = annotation (hollow/noted, never a third color);
  `fail` renders muted "didn't finish" and contributes no chart points or pass-rate math.
- **Zero new dependencies; no build step.** Vanilla ES modules, inline SVG, plain divs.
- **Read-only over `/api/runs` + `/api/state`.** No new endpoints; nothing stored; all rollups
  computed at render time.
- **Wizard behavior is preserved** — its flows, state machine, `/api/state` polling, and the
  `#runs/<id>` cross-links keep working exactly as today; only its step-tracker moves out of
  the global rail into the wizard page itself.
- Existing deep links keep working: `#runs`, `#runs/<run_id>` (Slack/wizard links).
- Structural CSS appended **byte-identically** to all three theme files (`app.css`,
  `app-theme-canvas.css`, `app-theme-void.css`); colors only via existing tokens.
- All ledger-derived strings escape through `esc()` at the sink; tooltips included.

## Design

### 1 · Modules & routing

`index.html` boots **`shell.js`** (new entry). Shell owns: rail (brand/logo, nav, theme toggle
footer), sticky top bar (env pill — env + distinct teams from the ledger — and ＋ Create test),
date-range state, and the hash router:

| Hash | Page | Module |
|---|---|---|
| `#home` or empty | Home | `home.js` (new) |
| `#tests` | Tests catalog | `tests.js` (new) |
| `#runs`, `#runs/<id>` | Executions (existing Results view) | `runs.js` (minor edits) |
| `#insights` | Global insights | `insights.js` (new) |
| `#insights/<team>/<profile>` | Per-test insights | `insights.js` |
| `#create` | Wizard, focused flow | `app.js` (refactored export) |

Shell listens to `hashchange` and mounts the active page into `#main`; nav item highlighting
follows the route. On `window` focus, shell re-renders the active page **unless** the wizard is
mounted (the wizard keeps its own refresh loop; re-rendering it would eat typed input).

New pure-aggregation module **`agg.js`** (no DOM, no fetch — node-testable): date-range
filtering, catalog grouping, panel math. New **`charts.js`**: gradient area chart (Home KPIs)
and hoverable bar chart (Insights), both inline-SVG string builders in the `spark()` idiom.

### 2 · Wizard integration (`app.js` surgery — the risky task)

- `app.js` stops auto-booting and exports `initWizard(main)`; shell calls it on `#create`.
- The rail step-tracker (`renderRail`, `#nav`, `#teamtag`, progress `#bar`) moves into the
  wizard card as a **horizontal stepper** at the top (same step model, same click/goto
  behavior, compact dots+labels). The global `#bar` progress strip renders only while
  `#create` is mounted.
- `render()` drops its `#runs` delegation (shell routes now) and its rail rendering; everything
  else — stages, flows, `/api/state` polling, outcome pages, `#runs/<id>` links — unchanged.
- Wizard-internal "Results" rail entry is removed (nav has Executions).

### 3 · Home (`home.js`)

Per the mockup: serif `Overview.` head + date-range pill; three KPI tiles — **Pass rate**
(green), **Red runs** (red, delta line: corroborated / flakes / open), **Total executions**
(brass, "across N tests") — each a big serif number over a full-bleed gradient area chart
(`charts.js`, ~300×100 viewBox, endpoint dot, gradient fade to transparent); then **Recent
executions**: latest 8 in range — status dot, `team · profile`, suite badge, headline, history
bar (reuses `historyBar`), relative time; rows click to `#runs/<id>`; "See all executions →"
links `#runs`. KPI series are per-run binaries over the ranged set (chronological), matching
the approved design; fewer than 2 points → number only, no chart.

### 4 · Tests (`tests.js`)

Catalog cards grouped by `team|profile` from the ranged ledger (via `agg.js`): test name,
suite badge, last verdict chip + flake note, history bar (last 8), last-run headline + relative
time, execution count. Click → `#insights/<team>/<profile>`. Empty state: "No tests yet — create
your first" → `#create`.

### 5 · Insights (`insights.js`)

**Global (`#insights`)** — four native panels from the ranged ledger, mirroring the Grafana
top row: **Failed by threshold** (stat: red executions; sub: corroborated count), **Pass rate**
(stat: green/(green+red)), **Pass rate by test** (horizontal bars per test, green→red scale),
**Slowest test p95** (horizontal bars: worst endpoint p95 per perf test; functional tests
excluded). Panel cards link to the matching per-test page where applicable.

**Per-test (`#insights/<team>/<profile>`)** — header (test name, badge, last verdict, count in
range) then execution history as **vertical bar charts**, newest right:

- Perf test: one chart **per metric** (like Grafana's per-test panels): bar height = that
  execution's `p95_ms`, dashed reference line at `p95_red_ms`, bar color by metric verdict.
- Functional test: one chart: bar height = pass % (`passed/total`), color by run verdict;
  flake runs drawn hollow-outlined red (annotation, not a third color).
- **Hover/focus a bar** → tooltip: run id (short), absolute time, verdict (+ "not reproduced
  on re-run" when flake), value vs threshold (or passed/failed/skipped counts), trigger.
  Bars are keyboard-focusable (`tabindex`, tooltip on focus); **click/Enter** → `#runs/<id>`.
- Runs missing structured metrics contribute no bars; if a test has none, the chart area shows
  "no structured metrics recorded for this range."

### 6 · Date range

Pill control (mockup style): **Last 7 days · Last 30 days (default) · Last 90 days · All
time**. State lives in shell (persisted to `localStorage`), rendered on Home, Executions, and
Insights; changing it re-renders the active page. Filtering is `agg.js`'s
`inRange(recorded_at, range)` applied to the fetched `runs` before page logic. Executions
applies it alongside its existing team/suite/verdict filters (trend cards included).

### 7 · Logo & theme

The approved threshold-breach mark (brass pulse, red line centered on the rise) replaces the
brand block in the rail and the favicon (inline SVG data URI). Theme toggle keeps its current
3-theme cycle behavior, living in the rail footer as an independent control.

### 8 · CSS strategy

One new structural block (shell grid, rail, topbar, buttons, kpi tiles, catalog cards, panels,
bars, tooltip, stepper, date pill) appended **byte-identically** to all three theme files after
the existing Results block; all color through existing tokens. The superseded `.kpirow/.kpitile/
.spark-fill` rules from the 2026-07-10 KPI row are replaced by the new block (old class names
reused or deleted — no dead CSS left).

### 9 · Cleanup of superseded work

`runs.js`: remove `renderKpis` + `#kpis` zone + `spark()`'s `fill` option (Home/charts.js own
KPIs now); **keep** `historyBar` + row integration + hbar CSS. Executions keeps its filter bar,
trend strip, rows, detail — unchanged otherwise.

### 10 · Error & empty states

Every page: fetch failure → the existing "Couldn't load" card pattern; empty range → honest
empty copy (never fake zeros — Pass rate shows "—" when no verdicts in range). Unknown hash →
Home. Unknown test in `#insights/<team>/<profile>` → "no runs recorded for this test" + back
link.

### 11 · Testing

- `tests/agg.test.mjs` (node --test): `inRange` boundaries (7/30/90/all, malformed dates),
  catalog grouping, panel math (failed count, pass rate, pass-rate-by-test, slowest p95 —
  including worst-endpoint selection and functional exclusion), KPI binaries. Fixture reuses
  the runs-ledger fixture shapes.
- Existing `tests/runs-api.test.mjs` must stay 5/5; `smoke.ps1` gains the new public files.
- Live-browser verification battery: all routes × 3 themes, deep-link fresh-tab boot for every
  route, wizard full click-through (stepper works, create→run→outcome, `#runs/<id>` link),
  date-range recompute on all three pages, bar tooltips via mouse AND keyboard, empty-state
  checks, console clean. Impeccable critique pass on shell, Home, Tests, Insights before done.

## Coverage after this build

In: left-nav IA, Home hero graphs + recent list, Tests catalog with history bars, executions
drill-down, native per-test analytics with hoverable execution bars, date ranges.
Ours alone: governance on every surface (corroboration, reviewer, human-gated Jira).
Still deliberately out: DAG visualizer, AI-chat builder, scheduling, RBAC.
