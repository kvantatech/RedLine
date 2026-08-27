# Results view — KPI tiles + per-row history bars (design spec)

> Date: 2026-07-10 · Status: APPROVED (Anton, 2026-07-10) · Origin: platform dashboard review
> Build note: UI work uses the **impeccable** skill. Extends the Results view shipped on
> branch `feat/runs-view` (spec: `2026-07-10-runs-view-design.md`).

## Context

Two dashboard patterns are worth adopting into the Results view: (1) a hero row of big-number
KPI tiles with full-bleed sparkline backgrounds, and (2) an inline mini history-bar on every list
row showing that workflow's recent run outcomes. Two adjacent patterns were **deliberately
rejected**: a DAG/pipeline step visualizer, which reflects Kubernetes multi-worker sharding
RedLine does not do (one k6/Playwright script runs at a time; a fake pipeline diagram would
misrepresent the run), and an AI-chat workflow builder, which duplicates governance RedLine
already has in the reviewer/corroborate gate.

## Goals

1. Hero KPI row above the filter bar: pass-rate, red-run count, total runs — each a big number
   over a full-bleed filled-area sparkline.
2. Per-row inline history bar: the last 8 runs of that row's team+profile, colored by verdict.
3. Both computed client-side from the already-fetched `runs` array — no new endpoint, no N+1.

## Non-goals

DAG/pipeline visualizer · AI-chat workflow builder · duration-scaled bar heights (duration is not
a reliable ledger field for either suite; height would be decorative fiction) · any new API.

## Hard constraints

- **Two verdicts only: green | red.** History-bar blocks are green / red / muted "didn't finish".
  A flake stays a red block (flake is an annotation, never a third color). Consistent with the
  parent Results spec.
- Zero new dependencies; inline SVG + plain divs only; no build step.
- Read-only, compute-at-render-time, nothing stored — same rule as the existing trend cards.
- KPI tiles and history bars are pure rendering over the in-memory `runs` array; no new
  `runs-lib.mjs` logic, so no new unit tests — live-browser verification only.
- New CSS appended to the existing byte-identical Results block in all three theme files
  (`app.css`, `app-theme-canvas.css`, `app-theme-void.css`).

## Design

### 1 · Hero KPI row (`renderKpis`)

A new `renderKpis(zone, shown)` function, called from `renderList` with the **filtered** `shown`
array (the tiles follow the active team/suite/verdict filters — approved decision). Placed in a
new `<div id="kpis">` **above** the `.runsbar` filter row. The existing per-team/profile trend
cards (`renderTrends`) are unchanged and keep their current spot below the filter bar — the hero
answers "how healthy is everything right now (in this filter)", the trend cards answer "is this
one team getting slower".

Three tiles:
- **Pass rate** — `green / (green + red)` as a percent over `shown` (excludes `fail` runs from
  both numerator and denominator; they aren't a pass/fail signal). Green fill. "—" if no
  green+red runs exist in the filter.
- **Red runs** — count of `verdict === 'red'` in `shown`. Red fill.
- **Total runs** — `shown.length`. Neutral (brass/line) fill.

Each tile: label (small, uppercase), big number, and a **full-bleed filled-area sparkline** behind
both, drawn from the last 30 chronological runs in `shown`. The sparkline series per tile:
- Pass rate: each run's rolling pass-rate is not meaningful per-run; instead plot a per-run binary
  (green=1, red=0, fail skipped) smoothed only by the area fill — i.e. the fill height at each
  point is the run's own green(1)/red(0). Reads as "mostly-full green band = healthy".
- Red runs / Total runs: plot a per-day (or per-run, chronological) count is overkill; use the
  same binary series (red tile: red=1/green=0; total tile: every run=1, so a flat full band —
  in that case draw no sparkline, just the number, to avoid a meaningless solid block).

Reuses the existing `spark()` with a new `fill: true` option that closes the polygon to the
baseline and fills it at low opacity. Fewer than 2 points → number only, no fill.

### 2 · Per-row history bar (`historyBar`)

`renderList` builds a `historyByCombo` Map once (group `runs` by `team|profile`, chronological
oldest→newest) — the same grouping `renderTrends` already does, lifted so both reuse it. `row(r)`
gains a `historyBar(r, historyByCombo)` strip: up to the **last 8** runs of `r`'s team+profile as
small colored blocks (`<span class="hbar">` containing `<i class="hcell green|red|fail">`),
oldest→newest, left→right. Fewer than 8 → fewer blocks, no placeholders. Rows with no team or
profile → no bar.

The bar sits in the row's middle column after the headline text, before the reviewer/ticket meta.

### 3 · Data flow

No new API calls. Both features aggregate the `runs` array `renderList` already fetches. The
history Map is built once per render and passed to every `row()` call (not recomputed per row).

### 4 · Theming

New CSS: `.kpirow` (grid of 3), `.kpitile` (relative-positioned container), `.kpitile .knum`,
`.kpitile .klabel`, `.kpitile .kspark` (absolute, full-bleed, behind text), `.hbar`, `.hcell`
(+ `.green/.red/.fail`). Fill/blocks reuse `--green`/`--red`/`--muted`/`--line` at appropriate
opacity. Appended identically to all three theme files.

### 5 · Error handling / edge cases

- Empty ledger → tiles show "—" / "0" / "0", no fills; no history bars. No crash.
- A filter that matches nothing → same as empty.
- A team+profile with a single run → a one-block history bar.
- `fail`-verdict runs → excluded from pass-rate math; render as a muted history block.

### 6 · Testing

Live-browser verification only (pure rendering, no `runs-lib` change): all three themes; the
zero-run and single-run edge cases; filters recompute the tiles; history bars match each row's
real recent verdicts; console clean. Impeccable critique pass on the new elements before done.
`node --test tests/runs-api.test.mjs` and `smoke.ps1` must still pass (no regression).
