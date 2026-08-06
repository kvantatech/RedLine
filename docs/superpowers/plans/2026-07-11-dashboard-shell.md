# Dashboard Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the dashboard's IA into a Testkube-shaped shell — persistent section rail (Home · Tests · Executions · Insights), sticky top bar with Create test, Home landing page with bold KPI graphs, Tests catalog, native per-test Insights analytics, date-range filtering, new logo — per `docs/superpowers/specs/2026-07-11-dashboard-shell-design.md`.

**Architecture:** New entry module `shell.js` owns rail/topbar/routing and mounts pages into `#page`. The wizard (`app.js`) becomes a focused flow at `#create` with its step-tracker as an in-card horizontal stepper. Pure aggregation lives in `agg.js` (node-tested), chart builders in `charts.js` (node-tested), date-range state in `range.js`. Everything derives from the existing `/api/runs` + `/api/state` — zero new endpoints.

**Tech Stack:** Vanilla ES modules, inline SVG, Node built-in test runner. No dependencies, no build step.

## Global Constraints

- **Two verdicts only: green | red.** Flake = annotation (hollow marker / "not reproduced on re-run" note), never a third color. `fail` renders muted "didn't finish", contributes no chart points and no pass-rate math.
- **Zero new dependencies; no build step.** Vanilla ES modules, inline SVG, plain divs.
- **Read-only over `/api/runs` + `/api/state`.** No new endpoints; nothing stored; rollups computed at render time.
- **Wizard behavior preserved:** flows, `/api/state` state machine, agent feed, `#runs/<id>` cross-links all keep working; only its step-tracker moves from the global rail into the wizard page.
- **Deep links keep working:** `#runs`, `#runs/<run_id>` boot correctly in a fresh tab.
- **Structural CSS appended byte-identically to all three theme files** (`app.css`, `app-theme-canvas.css`, `app-theme-void.css`); colors only via existing tokens (`--green`, `--red`, `--brass`, `--muted`, `--line`, etc.). After every CSS task, the appended block's md5 must match across the three files.
- **All ledger-derived strings escape through `esc()` at the sink** — including tooltip attributes and `data-*` values.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Never stage `.mcp.json`.

## Known spec deltas (deliberate, pre-approved by controller — reviewers judge against THIS text)

1. **KPI sparkline series = trailing-5 rolling mean of the verdict binaries**, not the raw 0/1 series. A raw binary area chart is a square wave (illegible); the rolling band preserves the spec's "band of health" intent. Implemented as `rolling()` in `agg.js` with tests.
2. **Tests catalog uses the full ledger, not the date range.** A catalog shouldn't lose tests because they haven't run this week; per-test Insights (one click deeper) IS ranged. The spec's §4 "ranged ledger" wording is resolved this way.
3. **Pass-rate-by-test bars:** fill green only at 100% (every ranged verdict green), red otherwise — the honest two-verdict reading; no arbitrary 90% threshold.

## File structure

| File | Role |
|---|---|
| `dashboard/public/agg.js` (new) | Pure aggregation: range filter, grouping, KPI/panel math. No DOM/fetch. |
| `dashboard/public/charts.js` (new) | SVG string builders: gradient area chart, hoverable bar chart. |
| `dashboard/public/range.js` (new) | Date-range state (localStorage) + ranged fetch + range pill control. |
| `dashboard/public/shell.js` (new) | Entry: rail, topbar, router, theme toggle. |
| `dashboard/public/home.js` (new) | Home page: KPI tiles + recent executions. |
| `dashboard/public/tests.js` (new) | Tests catalog page. |
| `dashboard/public/insights.js` (new) | Global panels + per-test execution bars + tooltip. |
| `dashboard/public/app.js` (modify) | Wizard: export `initWizard(el)`, in-card stepper, drop rail/routing/theme code. |
| `dashboard/public/runs.js` (modify) | Export row primitives; drop superseded KPI row; range filter. |
| `dashboard/public/util.js` (modify) | Add `rel()` relative-time helper. |
| `dashboard/public/index.html` (modify) | New body layout (topbar+page), new logo + favicon, boot shell.js. |
| `dashboard/public/app*.css` ×3 (modify) | One shared structural block, appended byte-identically. |
| `tests/agg.test.mjs`, `tests/charts.test.mjs` (new) | Node unit tests. |
| `tests/smoke.ps1` (modify) | Register new files. |

---

### Task 1: `agg.js` + `range.js` + unit tests (TDD)

**Files:**
- Create: `dashboard/public/agg.js`
- Create: `dashboard/public/range.js`
- Test: `tests/agg.test.mjs`

**Interfaces:**
- Consumes: normalized run records (the `/api/runs` shape from `dashboard/runs-lib.mjs`: `run_id, recorded_at, team, profile, suite, verdict ('green'|'red'|'fail'), flake, sources, confirm_verdict, counts{total,passed,failed,skipped}|null, endpoints[{metric,name,p95_ms,p95_red_ms,verdict}], …`).
- Produces (for Tasks 3–7): `inRange(iso, range, now?)`, `filterRange(runs, range, now?)`, `groupByTest(runs) → Map<'team|profile', chronologicalRuns[]>`, `kpis(runs) → {green, red, total, passRate|null, corroborated, flakes}`, `rolling(series, w=5) → number[]`, `catalog(runs) → [{key, team, profile, suite, last, count, history}]`, `passRateByTest(runs) → [{key, team, profile, rate}]`, `slowestP95(runs) → [{key, team, profile, p95, threshold, metric}]` sorted slowest-first. From `range.js`: `getRange()`, `setRange(r)`, `rangedRuns() → {runs, unreadable, range}`, `rangePill() → html`, `bindRangePill(container, rerender)`, `RANGE_LABELS`.

- [ ] **Step 1: Write the failing test**

Create `tests/agg.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inRange, filterRange, groupByTest, kpis, rolling, catalog, passRateByTest, slowestP95,
} from '../dashboard/public/agg.js';

// Fixed "now" so range math is deterministic: 2026-07-11T12:00:00Z
const NOW = Date.parse('2026-07-11T12:00:00Z');
const d = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();

// Minimal normalized-record factory matching runs-lib.mjs output shape.
const run = (o) => ({
  run_id: o.id, recorded_at: o.at, team: o.team ?? 't1', profile: o.profile ?? 'p1',
  suite: o.suite ?? 'performance', verdict: o.verdict ?? 'green', flake: o.flake ?? false,
  sources: o.sources ?? null, confirm_verdict: o.confirm ?? null,
  counts: o.counts ?? null, endpoints: o.endpoints ?? [],
});

// newest-first, like /api/runs
const RUNS = [
  run({ id: 'r8', at: d(1), verdict: 'red', sources: 2 }),                      // corroborated red
  run({ id: 'r7', at: d(2), verdict: 'green' }),
  run({ id: 'r6', at: d(5), verdict: 'red', flake: true, confirm: 'green', sources: 1 }), // flake
  run({ id: 'r5', at: d(10), verdict: 'fail' }),                                 // didn't finish
  run({ id: 'r4', at: d(20), team: 't2', profile: 'func', suite: 'functional',
        verdict: 'green', counts: { total: 16, passed: 16, failed: 0, skipped: 0 } }),
  run({ id: 'r3', at: d(40), team: 't2', profile: 'func', suite: 'functional',
        verdict: 'red', counts: { total: 16, passed: 14, failed: 2, skipped: 0 } }),
  run({ id: 'r2', at: d(80), verdict: 'green',
        endpoints: [{ metric: 'cfg', name: 'config', p95_ms: 400, p95_red_ms: 500, verdict: 'green' },
                    { metric: 'srch', name: 'search', p95_ms: 900, p95_red_ms: 800, verdict: 'red' }] }),
  run({ id: 'r1', at: d(120), verdict: 'green' }),
];

test('inRange boundaries and malformed input', () => {
  assert.equal(inRange(d(6), '7d', NOW), true);
  assert.equal(inRange(d(8), '7d', NOW), false);
  assert.equal(inRange(d(29), '30d', NOW), true);
  assert.equal(inRange(d(31), '30d', NOW), false);
  assert.equal(inRange(d(365), 'all', NOW), true);
  assert.equal(inRange(null, '30d', NOW), false);
  assert.equal(inRange('not-a-date', '30d', NOW), false);
  assert.equal(inRange(null, 'all', NOW), true); // all-time keeps even undated records
});

test('filterRange keeps newest-first order and respects range', () => {
  const r = filterRange(RUNS, '30d', NOW);
  assert.deepEqual(r.map((x) => x.run_id), ['r8', 'r7', 'r6', 'r5', 'r4']);
});

test('groupByTest groups chronologically oldest→newest and skips team-less records', () => {
  const m = groupByTest([...RUNS, run({ id: 'rX', at: d(0), team: null })]);
  assert.deepEqual([...m.keys()].sort(), ['t1|p1', 't2|func']);
  assert.deepEqual(m.get('t1|p1').map((x) => x.run_id), ['r1', 'r2', 'r5', 'r6', 'r7', 'r8']);
});

test('kpis: fail excluded from pass-rate; corroborated + flakes counted', () => {
  const k = kpis(RUNS);
  assert.equal(k.total, 8);
  assert.equal(k.green, 4);
  assert.equal(k.red, 3);
  assert.equal(k.passRate, Math.round((4 / 7) * 100)); // 4 green of 7 verdicts (fail excluded)
  assert.equal(k.corroborated, 1); // r8
  assert.equal(k.flakes, 1);       // r6
});

test('kpis: no verdicts → passRate null, never fake 0', () => {
  assert.equal(kpis([run({ id: 'x', at: d(1), verdict: 'fail' })]).passRate, null);
});

test('rolling: trailing-window mean, same length out', () => {
  assert.deepEqual(rolling([1, 0, 1, 1], 2), [1, 0.5, 0.5, 1]);
  assert.deepEqual(rolling([], 5), []);
});

test('catalog: one entry per test, most-recently-run first, history capped at 8', () => {
  const c = catalog(RUNS);
  assert.deepEqual(c.map((x) => x.key), ['t1|p1', 't2|func']);
  assert.equal(c[0].count, 6);
  assert.equal(c[0].last.run_id, 'r8');
  assert.equal(c[0].history.length, 6); // fewer than 8 → fewer blocks, no padding
  assert.equal(c[1].suite, 'functional');
});

test('passRateByTest: green/(green+red) per test; verdict-less tests skipped', () => {
  const p = passRateByTest(RUNS);
  const t1 = p.find((x) => x.key === 't1|p1');
  assert.equal(t1.rate, Math.round((3 / 5) * 100)); // t1: g r1,r2,r7 / r r6,r8 (r5 fail excluded)
  const t2 = p.find((x) => x.key === 't2|func');
  assert.equal(t2.rate, 50);
  const only = passRateByTest([run({ id: 'y', at: d(1), verdict: 'fail' })]);
  assert.deepEqual(only, []);
});

test('slowestP95: worst endpoint of newest structured run; functional excluded; sorted', () => {
  const s = slowestP95(RUNS);
  assert.equal(s.length, 1); // only t1|p1 has endpoints; functional excluded
  assert.equal(s[0].p95, 900);          // search is worst (900/800 > 400/500)
  assert.equal(s[0].threshold, 800);
  assert.equal(s[0].metric, 'search');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agg.test.mjs`
Expected: FAIL — `Cannot find module .../dashboard/public/agg.js`

- [ ] **Step 3: Write `dashboard/public/agg.js`**

```javascript
// Pure aggregation over normalized run records (the /api/runs shape from
// runs-lib.mjs). No DOM, no fetch — unit-tested by tests/agg.test.mjs.

const DAYS = { '7d': 7, '30d': 30, '90d': 90, all: null };

export function inRange(iso, range, now = Date.now()) {
  const days = DAYS[range] ?? null;
  if (days === null) return true;
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && now - t <= days * 86400000;
}

export const filterRange = (runs, range, now = Date.now()) =>
  runs.filter((r) => inRange(r.recorded_at, range, now));

// runs arrive newest-first; group per test (team|profile), oldest→newest.
export function groupByTest(runs) {
  const m = new Map();
  for (const r of [...runs].reverse()) {
    if (!r.team || !r.profile) continue;
    const k = `${r.team}|${r.profile}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

// Headline KPI math. 'fail' runs count in total but never in pass-rate.
export function kpis(runs) {
  const green = runs.filter((r) => r.verdict === 'green').length;
  const red = runs.filter((r) => r.verdict === 'red').length;
  return {
    green, red, total: runs.length,
    passRate: green + red ? Math.round((green / (green + red)) * 100) : null,
    corroborated: runs.filter((r) => r.verdict === 'red' && r.sources >= 2).length,
    flakes: runs.filter((r) => r.flake).length,
  };
}

// Trailing-window mean — turns a 0/1 verdict series into a legible band
// instead of a square wave (spec delta #1). Same length out as in.
export function rolling(series, w = 5) {
  return series.map((_, i) => {
    const win = series.slice(Math.max(0, i - w + 1), i + 1);
    return win.reduce((a, b) => a + b, 0) / win.length;
  });
}

// Catalog entries, most recently run first. history = last 8 for the bars.
export function catalog(runs) {
  return [...groupByTest(runs).entries()].map(([key, list]) => {
    const last = list[list.length - 1];
    const [team, profile] = key.split('|');
    return { key, team, profile, suite: last.suite, last, count: list.length, history: list.slice(-8) };
  }).sort((a, b) => (b.last.recorded_at || '').localeCompare(a.last.recorded_at || ''));
}

// Per-test pass rate (green/(green+red)); tests with no verdicts in range
// are skipped — no fake 0%/100% bars.
export function passRateByTest(runs) {
  return [...groupByTest(runs).entries()].map(([key, list]) => {
    const g = list.filter((r) => r.verdict === 'green').length;
    const rd = list.filter((r) => r.verdict === 'red').length;
    if (!(g + rd)) return null;
    const [team, profile] = key.split('|');
    return { key, team, profile, rate: Math.round((g / (g + rd)) * 100) };
  }).filter(Boolean);
}

// Latest structured p95 per perf test: worst endpoint (highest p95/red-line
// ratio) of the newest run carrying endpoints[]. Functional tests excluded.
export function slowestP95(runs) {
  return [...groupByTest(runs).entries()].map(([key, list]) => {
    const r = [...list].reverse().find((x) => x.suite !== 'functional' && x.endpoints.length);
    if (!r) return null;
    const worst = r.endpoints.reduce((a, e) =>
      (e.p95_ms / (e.p95_red_ms || 1) > a.p95_ms / (a.p95_red_ms || 1) ? e : a), r.endpoints[0]);
    const [team, profile] = key.split('|');
    return { key, team, profile, p95: worst.p95_ms, threshold: worst.p95_red_ms, metric: worst.name || worst.metric };
  }).filter(Boolean).sort((a, b) => b.p95 - a.p95);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agg.test.mjs`
Expected: PASS (9/9). If a count assertion fails, re-derive from the fixture — do not bend the implementation to the test without understanding which is wrong.

- [ ] **Step 5: Write `dashboard/public/range.js`** (browser-only glue — verified live in later tasks, not unit-tested)

```javascript
// Date-range state + ranged ledger fetch + the range pill control.
// Tiny standalone module so shell and pages import it without cycles.
import { api } from './util.js';
import { filterRange } from './agg.js';

export const RANGE_LABELS = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', all: 'All time' };
const LS_KEY = 'redline-range';

export function getRange() {
  const r = localStorage.getItem(LS_KEY);
  return RANGE_LABELS[r] ? r : '30d';
}
export function setRange(r) { if (RANGE_LABELS[r]) localStorage.setItem(LS_KEY, r); }

// Fetch the ledger and keep only runs inside the active range.
export async function rangedRuns() {
  const { runs, unreadable } = await api('/api/runs');
  return { runs: filterRange(runs, getRange()), unreadable, range: getRange() };
}

// Native <select> styled as a pill — free keyboard/a11y.
export function rangePill() {
  const cur = getRange();
  return `<select class="daterange" aria-label="Date range">
    ${Object.entries(RANGE_LABELS).map(([k, l]) =>
      `<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`).join('')}
  </select>`;
}
export function bindRangePill(container, rerender) {
  container.querySelector('.daterange')?.addEventListener('change', (e) => {
    setRange(e.target.value); rerender();
  });
}
```

- [ ] **Step 6: Syntax-check both files**

Run: `node --check dashboard/public/agg.js && node --check dashboard/public/range.js && node --test tests/agg.test.mjs`
Expected: both checks silent, tests 10/10 pass.

- [ ] **Step 7: Commit**

```bash
git add dashboard/public/agg.js dashboard/public/range.js tests/agg.test.mjs
git commit -m "feat(dashboard): agg.js pure aggregation + range.js date-range state (TDD)"
```

---

### Task 2: `charts.js` + unit tests (TDD)

**Files:**
- Create: `dashboard/public/charts.js`
- Test: `tests/charts.test.mjs`

**Interfaces:**
- Consumes: `esc` from `./util.js`.
- Produces: `areaChart(values, color) → svgString` (values in [0,1] oldest→newest; `''` below 2 points) and `barChart(bars, {threshold}) → svgString` where `bars: [{v, cls, tip, run}]` (v ≥ 0; cls one of `'green' | 'red' | 'red hollow' | 'fail'`; tip = multiline plain text; run = run_id). Bars carry `class="ibar …" tabindex="0" role="link" data-run data-tip aria-label`.

- [ ] **Step 1: Write the failing test**

Create `tests/charts.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { areaChart, barChart } from '../dashboard/public/charts.js';

test('areaChart: empty under 2 points; has gradient, area, line, endpoint dot', () => {
  assert.equal(areaChart([], 'var(--green)'), '');
  assert.equal(areaChart([1], 'var(--green)'), '');
  const svg = areaChart([0, 0.5, 1], 'var(--green)');
  assert.match(svg, /linearGradient/);
  assert.match(svg, /<polygon/);
  assert.match(svg, /<polyline/);
  assert.match(svg, /<circle/);
  assert.match(svg, /aria-hidden="true"/);
});

test('areaChart: values clamped to [0,1] — no NaN/out-of-viewBox coordinates', () => {
  const svg = areaChart([-1, 2], 'var(--red)');
  assert.doesNotMatch(svg, /NaN/);
});

test('barChart: rects with classes, tabindex, data attrs; threshold line optional', () => {
  const bars = [
    { v: 400, cls: 'green', tip: 'run-1\nok', run: 'run-1' },
    { v: 900, cls: 'red', tip: 'run-2\nover', run: 'run-2' },
  ];
  const svg = barChart(bars, { threshold: 500 });
  assert.equal((svg.match(/<rect/g) || []).length, 2);
  assert.match(svg, /class="ibar green"/);
  assert.match(svg, /class="ibar red"/);
  assert.match(svg, /tabindex="0"/);
  assert.match(svg, /data-run="run-1"/);
  assert.match(svg, /<line class="ithresh"/);
  assert.doesNotMatch(barChart(bars), /ithresh/);
  assert.equal(barChart([]), '');
});

test('barChart: escapes hostile tip/run content', () => {
  const svg = barChart([{ v: 1, cls: 'green', tip: '<img src=x onerror=alert(1)>', run: '"><script>' }]);
  assert.doesNotMatch(svg, /<img/);
  assert.doesNotMatch(svg, /<script/);
});

test('barChart: zero-value bar still gets a visible 2px nub', () => {
  const svg = barChart([{ v: 0, cls: 'fail', tip: 'x', run: 'x' }, { v: 10, cls: 'green', tip: 'y', run: 'y' }]);
  assert.match(svg, /height="2(\.0)?"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/charts.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `dashboard/public/charts.js`**

```javascript
// Inline-SVG chart builders. Pure string in/out — unit-tested by
// tests/charts.test.mjs. Colors arrive as CSS values (theme vars).
import { esc } from './util.js';

let uid = 0; // gradient ids must be unique per document

// Full-bleed gradient area for the Home KPI tiles. values: numbers in [0,1],
// oldest→newest. Stretches to its container (preserveAspectRatio none);
// the polyline keeps honest width via vector-effect.
export function areaChart(values, color) {
  if (values.length < 2) return '';
  const W = 300, H = 100, TOP = 12, BOT = 4, id = `area${++uid}`;
  const x = (i) => (i * (W - 6)) / (values.length - 1);
  const y = (v) => TOP + (1 - Math.max(0, Math.min(1, v))) * (H - TOP - BOT);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  return `<svg class="area" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".42"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon fill="url(#${id})" points="${pts.join(' ')} ${(W - 6).toFixed(1)},${H} 0,${H}"/>
    <polyline fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" points="${pts.join(' ')}"/>
    <circle cx="${(W - 6).toFixed(1)}" cy="${y(values[values.length - 1]).toFixed(1)}" r="3" fill="${color}"/>
  </svg>`;
}

// Execution-history bars for Insights. Natural-width SVG (10px bar + 4px
// gap) — scrolls in its container, never stretches (bars stay honest).
// threshold is in the same units as v and draws a dashed reference line.
export function barChart(bars, { threshold } = {}) {
  if (!bars.length) return '';
  const BW = 10, GAP = 4, H = 120, P = 8;
  const W = bars.length * (BW + GAP) + GAP;
  const max = Math.max(...bars.map((b) => b.v), threshold ?? 0) || 1;
  const y = (v) => P + (1 - v / max) * (H - 2 * P);
  const th = threshold != null
    ? `<line class="ithresh" x1="0" x2="${W}" y1="${y(threshold).toFixed(1)}" y2="${y(threshold).toFixed(1)}"/>` : '';
  const rects = bars.map((b, i) => {
    const top = y(b.v);
    return `<rect class="ibar ${b.cls}" x="${GAP + i * (BW + GAP)}" y="${top.toFixed(1)}" width="${BW}" height="${Math.max(2, H - P - top).toFixed(1)}" rx="2" tabindex="0" role="link" data-run="${esc(b.run)}" data-tip="${esc(b.tip)}" aria-label="${esc(b.tip)}"/>`;
  }).join('');
  return `<svg class="ibars" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${th}${rects}</svg>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/charts.test.mjs`
Expected: PASS (5/5). Also run `node --test tests/agg.test.mjs tests/runs-api.test.mjs` — all still green.

- [ ] **Step 5: Commit**

```bash
git add dashboard/public/charts.js tests/charts.test.mjs
git commit -m "feat(dashboard): charts.js — gradient area + hoverable bar SVG builders (TDD)"
```

---

### Task 3: Shell cutover — `shell.js`, `index.html`, `app.js` surgery, logo, page stubs, shell CSS

This is the riskiest task: after it, the app boots into the shell, the wizard lives at `#create`, and every route renders (Home/Tests/Insights as honest stubs until Tasks 4–6).

**Files:**
- Create: `dashboard/public/shell.js`
- Create: `dashboard/public/home.js`, `dashboard/public/tests.js`, `dashboard/public/insights.js` (stubs)
- Modify: `dashboard/public/index.html`
- Modify: `dashboard/public/app.js` (surgery — exact edits below)
- Modify: `dashboard/public/app.css`, `app-theme-canvas.css`, `app-theme-void.css` (append shell CSS block)

**Interfaces:**
- Consumes: `initWizard(el)` (created here in app.js), `renderRuns/routeRuns` (existing), stubs' `renderHome/renderTests/renderInsights(page)`.
- Produces: routing contract — pages are `async (pageEl) => void` rendering into `#page`; `#create` mounts the wizard; `#bar` visible only on `#create`; theme toggle now shell-owned.

- [ ] **Step 1: Rewrite `dashboard/public/index.html`**

Replace the whole file with:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0b0c0e" />
  <title>RedLine — QA engineering agent</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><line x1='2.5' y1='11.3' x2='21.5' y2='11.3' stroke='%23c0625c' stroke-width='2.2'/><polyline points='3,18 8,16.5 13,17 17,7 21,4.5' fill='none' stroke='%23c8a769' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/><circle cx='21' cy='4.5' r='1.9' fill='%23c8a769'/></svg>" />
  <link rel="stylesheet" id="theme-css" href="app.css" />
  <script>
    (function(){
      var t = localStorage.getItem('redline-theme') || 'brass';
      var map = { brass:'app.css', canvas:'app-theme-canvas.css', void:'app-theme-void.css' };
      document.getElementById('theme-css').href = map[t] || 'app.css';
    })();
  </script>
</head>
<body>
  <div id="bar"><i id="barfill"></i></div>

  <aside id="rail">
    <header class="brand">
      <svg class="brandmark" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="2.5" y1="11.3" x2="21.5" y2="11.3" stroke="var(--red)" stroke-width="2.2"/>
        <polyline points="3,18 8,16.5 13,17 17,7 21,4.5" stroke="var(--brass)" stroke-width="2"/>
        <circle cx="21" cy="4.5" r="1.9" fill="var(--brass)"/>
      </svg>
      <div class="wordmark">RedLine</div>
    </header>
    <nav id="nav" aria-label="Sections"></nav>
    <footer class="railfoot">
      <div id="teamtag" class="teamtag"></div>
      <div class="railmeta"><span id="count"></span></div>
    </footer>
  </aside>

  <main id="main">
    <header id="topbar"></header>
    <div id="page"></div>
  </main>

  <script type="module" src="shell.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create the three page stubs** (identical shape; Tasks 4–6 replace them)

`dashboard/public/home.js`:
```javascript
// Home page — replaced with the real implementation in the Home task.
export async function renderHome(page) {
  page.innerHTML = `<article class="card" data-screen-label="Home"><div id="stage">
    <h1>Home.</h1><p class="why">This page lands in the next build task.</p></div></article>`;
}
```

`dashboard/public/tests.js`:
```javascript
// Tests catalog — replaced with the real implementation in the Tests task.
export async function renderTests(page) {
  page.innerHTML = `<article class="card" data-screen-label="Tests"><div id="stage">
    <h1>Tests.</h1><p class="why">This page lands in the next build task.</p></div></article>`;
}
```

`dashboard/public/insights.js`:
```javascript
// Insights — replaced with the real implementation in the Insights task.
export async function renderInsights(page) {
  page.innerHTML = `<article class="card" data-screen-label="Insights"><div id="stage">
    <h1>Insights.</h1><p class="why">This page lands in the next build task.</p></div></article>`;
}
```

- [ ] **Step 3: Create `dashboard/public/shell.js`**

```javascript
// Shell — persistent section rail, sticky top bar, hash router. Entry module.
// Pages render into #page; the wizard mounts there as the #create flow.
import { esc, api } from './util.js';
import { routeRuns, renderRuns } from './runs.js';
import { renderHome } from './home.js';
import { renderTests } from './tests.js';
import { renderInsights } from './insights.js';
import { initWizard } from './app.js';

const $ = (sel, el = document) => el.querySelector(sel);

const NAV = [
  { hash: '#home', label: 'Home', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>' },
  { hash: '#tests', label: 'Tests', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 3h6M12 3v5l5 9a2 2 0 0 1-1.8 3H8.8A2 2 0 0 1 7 17l5-9"/></svg>' },
  { hash: '#runs', label: 'Executions', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 12h4l2 6 4-14 2 8h6"/></svg>' },
  { hash: '#insights', label: 'Insights', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>' },
];

function currentSection() {
  const h = location.hash;
  if (h.startsWith('#tests')) return '#tests';
  if (routeRuns()) return '#runs';
  if (h.startsWith('#insights')) return '#insights';
  if (h.startsWith('#create')) return '#create';
  return '#home';
}

function renderNav() {
  const sec = currentSection();
  $('#nav').innerHTML = NAV.map((n) => `
    <button class="navsec${sec === n.hash ? ' on' : ''}" data-hash="${n.hash}">${n.icon}<span>${n.label}</span></button>`).join('');
  document.querySelectorAll('#nav .navsec').forEach((b) =>
    b.addEventListener('click', () => { location.hash = b.dataset.hash; }));
}

async function renderTopbar() {
  $('#topbar').innerHTML = `
    <span class="env" id="envpill"><i></i><span>…</span></span>
    <button class="btn-create" id="createbtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>Create test</button>`;
  $('#createbtn').addEventListener('click', () => { location.hash = '#create'; });
  try { // fill the env pill from what the ledger actually recorded
    const { runs } = await api('/api/runs');
    const envs = [...new Set(runs.map((r) => r.env).filter(Boolean))].map((e) => e.toUpperCase()).join(' / ');
    const teams = [...new Set(runs.map((r) => r.team).filter(Boolean))];
    $('#envpill span').textContent = `${envs || 'STG'} · ${teams.length ? teams.join(', ') : 'no teams yet'}`;
  } catch { $('#envpill span').textContent = 'STG'; }
}

async function route() {
  renderNav();
  const sec = currentSection();
  const page = $('#page');
  $('#bar').style.display = sec === '#create' ? '' : 'none';
  if (sec !== '#create') { $('#teamtag').innerHTML = ''; $('#count').textContent = ''; }
  try {
    if (sec === '#create') await initWizard(page);
    else if (sec === '#runs') await renderRuns(page);
    else if (sec === '#tests') await renderTests(page);
    else if (sec === '#insights') await renderInsights(page);
    else await renderHome(page);
  } catch (e) {
    page.innerHTML = `<article class="card"><div id="stage"><h1>Couldn’t load this page.</h1>
      <p class="why">${esc(e.message)}</p></div></article>`;
  }
}

// Theme toggle — moved verbatim from app.js (shell furniture now).
function setupThemeToggle() {
  if ($('#themetoggle')) return;
  const THEMES = ['brass', 'canvas', 'void'];
  const LABELS = { brass: 'Brass', canvas: 'Canvas', void: 'Void' };
  const MAP = { brass: 'app.css', canvas: 'app-theme-canvas.css', void: 'app-theme-void.css' };
  const btn = document.createElement('button');
  btn.id = 'themetoggle';
  btn.style.cssText = 'background:none;border:1px solid var(--line);border-radius:var(--r-pill);'
    + 'color:var(--faint);font:11px var(--sans);letter-spacing:.12em;text-transform:uppercase;'
    + 'padding:4px 10px;cursor:pointer;transition:color 130ms,border-color 130ms;white-space:nowrap';
  const update = () => { btn.textContent = LABELS[localStorage.getItem('redline-theme') || 'brass']; };
  update();
  btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--text)'; btn.style.borderColor = 'var(--line-strong)'; });
  btn.addEventListener('mouseleave', () => { btn.style.color = 'var(--faint)'; btn.style.borderColor = 'var(--line)'; });
  btn.addEventListener('click', () => {
    const cur = localStorage.getItem('redline-theme') || 'brass';
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    localStorage.setItem('redline-theme', next);
    document.getElementById('theme-css').href = MAP[next];
    update();
  });
  const meta = $('.railmeta');
  if (meta) meta.prepend(btn);
}

window.addEventListener('hashchange', route);
// Focus-refresh non-wizard pages; the wizard owns its own refresh loop
// (a shell re-render there would wipe typed form input).
window.addEventListener('focus', () => { if (currentSection() !== '#create') route(); });

renderTopbar();
setupThemeToggle();
route();
```

- [ ] **Step 4: `app.js` surgery** — apply these exact edits (current code shown as anchors):

**(a)** Line 3 — delete the runs.js import:
```javascript
// DELETE this line:
import { routeRuns, renderRuns } from './runs.js';
```

**(b)** After `let es = null;` add the mount var:
```javascript
let mount = null;  // the #page element the shell hands us (set by initWizard)
```

**(c)** `render()` — replace the whole function (drops the `#runs` branch, the `.brand .sub` update, and the rail call; adds a mount guard and a wizard-active guard so background refreshes can't paint over other pages):
```javascript
function render() {
  if (!mount || !location.hash.startsWith('#create')) return;
  const done = state.stages.filter((s) => s.done).length;
  $('#barfill').style.width = `${Math.round((done / state.stages.length) * 100)}%`;
  $('#count').textContent = `${done} of ${state.stages.length}`;
  const tag = $('#teamtag');
  if (state.config.mode === 'operate' && state.operate?.picked) {
    tag.innerHTML = `<span class="tlabel">you're running</span>
      <span class="tname">${esc(state.operate.team)}</span>
      <span class="tprofile">${esc(profileTitle(state.operate.profile))}</span>`;
  } else if (state.config.suite === 'performance' && state.config.team) {
    tag.innerHTML = `<span class="tlabel">setting up for</span>
      <span class="tname">${esc(state.config.team)}</span>
      ${state.config.path ? `<span class="tprofile">${esc(state.config.path === 'browser' ? 'browser journey test' : 'API benchmark test')}</span>` : ''}`;
  } else {
    tag.innerHTML = '';
  }
  renderMain();
}
```

**(d)** Delete the whole `renderRail()` function (lines 73–88 in the current file).

**(e)** `renderMain()` — two changes. First, replace `$('#main').innerHTML = \`` with `mount.innerHTML = \`` and insert the stepper as the first child of the card, above the kicker:
```javascript
  mount.innerHTML = `
    <article class="card" data-screen-label="${esc(s.title)}">
      <div class="stepper" role="navigation" aria-label="Wizard steps">
        ${state.stages.map((st, i) => `
          <button class="stepdot${st.done ? ' done' : ''}${i === cursor ? ' current' : ''}" data-i="${i}" title="${esc(st.title)}">
            <span class="sglyph">${st.done && i !== cursor ? '✓' : i + 1}</span><span class="slabel">${esc(st.title)}</span>
          </button>`).join('')}
      </div>
      <div class="kicker"><span class="idx">${String(cursor + 1).padStart(2, '0')}</span><span>step ${cursor + 1} of ${state.stages.length}</span>${modeChip ? `<span class="opt">${modeChip}</span>` : ''}</div>
      <div id="stage"></div>
      <div class="stepnav">
        <button class="btn" id="back" ${cursor === 0 ? 'disabled' : ''}>← Back</button>
        <span class="hint" id="naverr"></span>
        <button class="btn primary" id="next" ${cursor === state.stages.length - 1 ? 'style="visibility:hidden"' : ''}>Next →</button>
      </div>
    </article>`;
```
Second, right after that innerHTML assignment (before `render($('#stage'), s);`) wire the stepper clicks:
```javascript
  mount.querySelectorAll('.stepdot').forEach((b) =>
    b.addEventListener('click', () => goto(Number(b.dataset.i))));
```

**(f)** `goto()` — delete the first line (`if (routeRuns()) history.replaceState(...)`).

**(g)** Global keydown listener — add a wizard-active guard as the first line of the handler:
```javascript
document.addEventListener('keydown', (e) => {
  if (!location.hash.startsWith('#create')) return;
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key === 'ArrowRight') $('#next')?.click();
  if (e.key === 'ArrowLeft') goto(cursor - 1);
});
```

**(h)** Focus listener — same guard:
```javascript
window.addEventListener('focus', () => {
  if (!location.hash.startsWith('#create')) return;
  if (state && !state.agent?.running) refresh(true).catch(() => {});
});
```

**(i)** Delete the `hashchange` listener line (shell owns routing).

**(j)** Delete the whole `setupThemeToggle()` function (moved to shell.js).

**(k)** Replace the boot IIFE at the bottom with the export:
```javascript
export async function initWizard(el) {
  mount = el;
  if (!state) { state = await api('/api/state'); cursor = firstOpen(); }
  render();
  refresh(true).catch(() => {}); // pick up server-side changes since last visit
}
```

**Known-accepted behavior (do not "fix"):** if the user navigates away mid-agent-run, the EventSource feed's completion writes target elements that no longer exist — same failure mode the old Results navigation had; out of scope here.

- [ ] **Step 5: Append the shell CSS block to all three theme files**

Append this exact block (byte-identical) at the END of each of `dashboard/public/app.css`, `dashboard/public/app-theme-canvas.css`, `dashboard/public/app-theme-void.css`:

```css
/* ── shell: section rail, top bar, wizard stepper ───────────────── */
.brand { display: flex; align-items: center; gap: 10px; }
.brandmark { width: 24px; height: 24px; flex: none; }
.navsec { display: flex; align-items: center; gap: 11px; width: 100%; padding: 9px 10px; border-radius: var(--r-sm); background: none; color: var(--muted); border: 1px solid transparent; font: 13.5px var(--sans); cursor: pointer; text-align: left; }
.navsec svg { width: 18px; height: 18px; flex: none; opacity: .85; }
.navsec:hover { background: var(--raise); color: var(--text); }
.navsec.on { background: var(--brass-dim); border-color: var(--brass-line); color: var(--brass-bright); }
.navsec.on svg { opacity: 1; }
.navsec:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }
#main { display: flex; flex-direction: column; }
#topbar { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 14px 0; margin-bottom: 10px; border-bottom: 1px solid var(--line-soft); position: sticky; top: 0; background: var(--bg); z-index: 5; }
#page { flex: 1; min-width: 0; }
.env { display: inline-flex; align-items: center; gap: 8px; color: var(--faint); font-size: 12px; border: 1px solid var(--line); border-radius: var(--r-pill); padding: 6px 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60%; }
.env i { width: 7px; height: 7px; border-radius: var(--r-pill); background: var(--green); flex: none; }
.btn-create { display: inline-flex; align-items: center; gap: 8px; background: var(--brass); color: var(--brass-ink); border: none; border-radius: var(--r-sm); padding: 9px 15px; font: 600 13.5px var(--sans); cursor: pointer; }
.btn-create:hover { background: var(--brass-bright); }
.btn-create svg { width: 15px; height: 15px; }
.btn-create:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }
.stepper { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 18px; border-bottom: 1px solid var(--line-soft); padding-bottom: 14px; }
.stepdot { display: inline-flex; align-items: center; gap: 7px; background: none; border: 1px solid transparent; border-radius: var(--r-pill); padding: 4px 10px 4px 5px; color: var(--faint); font: 12px var(--sans); cursor: pointer; }
.stepdot .sglyph { width: 20px; height: 20px; border: 1px solid var(--line); border-radius: var(--r-pill); display: inline-flex; align-items: center; justify-content: center; font-size: 10.5px; flex: none; }
.stepdot:hover { color: var(--text); }
.stepdot.done { color: var(--muted); }
.stepdot.done .sglyph { border-color: var(--green-line); color: var(--green-text); }
.stepdot.current { border-color: var(--brass-line); background: var(--brass-dim); color: var(--brass-bright); }
.stepdot.current .sglyph { border-color: var(--brass-line); }
.stepdot:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }
@media (max-width: 900px) { .stepdot .slabel { display: none; } .stepdot { padding: 4px 5px; } }
/* ── shared page head + date-range pill (Home/Executions/Insights) ── */
.pagehead { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 8px; }
.daterange { appearance: none; -webkit-appearance: none; background: transparent; border: 1px solid var(--line); border-radius: var(--r-pill); color: var(--muted); font: 13px var(--sans); padding: 8px 14px; cursor: pointer; }
.daterange:hover { border-color: var(--line-strong); color: var(--text); }
.daterange:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }
.daterange option { background: var(--panel); color: var(--text); }
```

Then verify byte-identity:
```bash
for f in app app-theme-canvas app-theme-void; do awk '/── shell: section rail/,0' dashboard/public/$f.css | md5sum; done
```
Expected: three identical hashes.

- [ ] **Step 6: Verify live**

```bash
node --check dashboard/public/shell.js && node --check dashboard/public/app.js
node dashboard/server.mjs   # (background; port 4242 — kill any stale listener first: netstat -ano | findstr :4242)
```
Then in the browser (playwright MCP or manual): boot `http://127.0.0.1:4242/` → lands on Home stub with rail (Home active) + topbar; click each nav item (Tests/Insights stubs render, Executions shows the real Results list); click **Create test** → wizard mounts with horizontal stepper, `#bar` visible, stepper navigates steps, Back/Next work, `#teamtag`/`#count` fill; navigate back to Home → `#bar` hidden, teamtag cleared; fresh-tab deep links `#runs`, `#runs/<real-id>`, `#create`, `#insights` all boot correctly; theme toggle cycles all three themes; console clean on every route.
Also: `node --test tests/runs-api.test.mjs` still 5/5.

- [ ] **Step 7: Commit**

```bash
git add dashboard/public/index.html dashboard/public/shell.js dashboard/public/app.js dashboard/public/home.js dashboard/public/tests.js dashboard/public/insights.js dashboard/public/app.css dashboard/public/app-theme-canvas.css dashboard/public/app-theme-void.css
git commit -m "feat(dashboard): shell cutover — section rail, topbar, hash router; wizard becomes #create focused flow with in-card stepper; new logo"
```

---

### Task 4: Home page (`home.js`) + supersession cleanup in `runs.js`

**Files:**
- Modify: `dashboard/public/home.js` (replace stub)
- Modify: `dashboard/public/util.js` (add `rel()`)
- Modify: `dashboard/public/runs.js` (exports + remove superseded KPI row)
- Modify: 3 theme CSS files (append Home block; delete the old KPI block)

**Interfaces:**
- Consumes: `rangedRuns/rangePill/bindRangePill` (Task 1), `kpis/rolling/catalog/groupByTest` (Task 1), `areaChart` (Task 2), `historyBar/headline` (exported from runs.js in this task), `rel` (added to util.js here).
- Produces: `renderHome(page)`; `rel(iso)` in util.js; runs.js exports `historyBar`, `headline`, `chip`, `flakeNote`, `when`.

- [ ] **Step 1: Add `rel()` to `dashboard/public/util.js`** (append)

```javascript
// Relative time for list rows — coarse buckets, absolute dates elsewhere.
export const rel = (iso) => {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (Number.isNaN(s)) return '—';
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} days ago`;
};
```

- [ ] **Step 2: `runs.js` cleanup + exports** — four edits:

  1. Add `export` before the `chip`, `flakeNote`, `when`, `headline`, and `historyBar` declarations (five keywords).
  2. Delete the whole `renderKpis()` function, the `<div id="kpis"></div>` line in `renderList`'s HTML, and the `renderKpis(document.getElementById('kpis'), shown);` call.
  3. In `spark()`, revert the `fill` extension: remove `fill = false` from the destructuring, the `area` const, and change the return back to `` `…aria-hidden="true">\n    <polyline class="line"…` `` (polyline first, no `${area}`).
  4. Replace the local `historyByCombo` grouping loop in `renderList` with the shared helper: add `import { groupByTest } from './agg.js';` at the top and replace the whole `const historyByCombo = new Map(); for (...) {...}` block with `const historyByCombo = groupByTest(runs);`.

Run: `node --check dashboard/public/runs.js` — clean.

- [ ] **Step 3: Replace `dashboard/public/home.js` with the real page**

```javascript
// Home — hero KPI graphs + recent executions. The landing page.
import { esc, rel } from './util.js';
import { rangedRuns, rangePill, bindRangePill } from './range.js';
import { kpis, rolling, catalog, groupByTest } from './agg.js';
import { areaChart } from './charts.js';
import { historyBar, headline } from './runs.js';

export async function renderHome(page) {
  const { runs } = await rangedRuns();
  const k = kpis(runs);
  const chrono = [...runs].reverse().filter((r) => r.verdict !== 'fail').slice(-30);
  const passSeries = rolling(chrono.map((r) => (r.verdict === 'green' ? 1 : 0)));
  const redSeries = rolling(chrono.map((r) => (r.verdict === 'red' ? 1 : 0)));
  const tests = catalog(runs);
  const byTest = groupByTest(runs);
  const recent = runs.slice(0, 8);
  const open = Math.max(0, k.red - k.corroborated - k.flakes);

  const tile = (cls, label, num, delta, svg) => `
    <div class="kpitile ${cls}">
      <div class="kchart">${svg}</div>
      <div class="klabel">${label}</div>
      <div class="knum">${num}</div>
      <div class="kdelta">${delta}</div>
    </div>`;

  const row = (r) => `
    <div class="homerow" data-id="${esc(r.run_id)}" role="button" tabindex="0">
      <span class="stat ${r.verdict === 'green' ? 'g' : r.verdict === 'red' ? 'r' : 'f'}"></span>
      <span class="hname">
        <span class="n">${esc(r.team ?? '?')} · ${esc(r.profile ?? '?')}</span>
        <span class="hbadge">${r.suite === 'functional' ? 'func' : 'perf'}</span>
        <span class="hmeta">${esc(headline(r))}${r.flake ? ' · not reproduced on re-run' : ''}</span>
      </span>
      ${historyBar(r, byTest) || '<span></span>'}
      <span class="hwhen">${esc(rel(r.recorded_at))}</span>
    </div>`;

  page.innerHTML = `
    <article class="card" data-screen-label="Home">
      <div id="stage">
        <div class="pagehead">
          <div>
            <h1>Overview.</h1>
            <p class="why">Everything RedLine has run for the pilot teams. Click any run for its full story.</p>
          </div>
          ${rangePill()}
        </div>
        <div class="kpirow">
          ${tile('pass', 'Pass rate', k.passRate !== null ? `${k.passRate}%` : '—',
            k.passRate !== null ? `${k.green} green of ${k.green + k.red} verdicts` : 'no verdicts in this range',
            passSeries.length >= 2 ? areaChart(passSeries, 'var(--green)') : '')}
          ${tile('fail', 'Red runs', k.red,
            `${k.corroborated} corroborated · ${k.flakes} flake${k.flakes === 1 ? '' : 's'} · ${open} open`,
            redSeries.length >= 2 ? areaChart(redSeries, 'var(--red)') : '')}
          ${tile('total', 'Total executions', k.total,
            `across ${tests.length} test${tests.length === 1 ? '' : 's'}`, '')}
        </div>
        <div class="sechead"><span class="sectitle">Recent executions</span><a class="seclink" href="#runs">See all executions →</a></div>
        <div class="homerows">
          ${recent.length ? recent.map(row).join('')
            : '<p class="why">No runs in this range yet. Run a test, or widen the date range.</p>'}
        </div>
      </div>
    </article>`;

  bindRangePill(page, () => renderHome(page));
  page.querySelectorAll('.homerow').forEach((r) => {
    const go = () => { location.hash = `#runs/${encodeURIComponent(r.dataset.id)}`; };
    r.addEventListener('click', go);
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}
```

- [ ] **Step 4: CSS — delete the old KPI block, append the Home block (all three files, byte-identical)**

First DELETE the superseded block added on 2026-07-11 morning (the lines from `/* ── KPI hero tiles + per-row history bars ──` through `.hcell.fail {…}`) **except keep the four `.hbar`/`.hcell` rules** — move them into the new block below so nothing referencing them breaks. Then append:

```css
/* ── home: KPI hero tiles + recent executions ───────────────────── */
.kpirow { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 20px 0 28px; }
.kpitile { position: relative; overflow: hidden; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel-2); padding: 16px 18px; min-height: 128px; display: flex; flex-direction: column; }
.kpitile .kchart { position: absolute; left: 0; right: 0; bottom: 0; height: 64%; pointer-events: none; }
.kpitile .kchart .area { width: 100%; height: 100%; display: block; }
.kpitile .klabel { position: relative; z-index: 1; font: 11px var(--sans); letter-spacing: .11em; text-transform: uppercase; color: var(--faint); }
.kpitile .knum { position: relative; z-index: 1; font-family: var(--serif); font-size: 42px; font-weight: 500; line-height: 1.08; margin-top: 5px; color: var(--text); font-variant-numeric: tabular-nums; }
.kpitile .kdelta { position: relative; z-index: 1; font-size: 12px; color: var(--muted); margin-top: 2px; }
.kpitile.pass .knum { color: var(--green-text); }
.kpitile.fail .knum { color: var(--red-text); }
.kpitile.total .knum { color: var(--brass-bright); }
.sechead { display: flex; align-items: baseline; justify-content: space-between; margin: 4px 0 6px; }
.sectitle { font: 11px var(--sans); letter-spacing: .11em; text-transform: uppercase; color: var(--faint); }
.seclink { color: var(--brass); text-decoration: none; font-size: 13px; }
.seclink:hover { color: var(--brass-bright); }
.homerows { border-top: 1px solid var(--line-soft); }
.homerow { display: grid; grid-template-columns: auto 1fr auto auto; gap: 14px; align-items: center; padding: 12px 4px; border-bottom: 1px solid var(--line-soft); cursor: pointer; }
.homerow:hover { background: var(--raise); }
.homerow:focus-visible { outline: 2px solid var(--brass); outline-offset: -2px; }
.stat { width: 9px; height: 9px; border-radius: var(--r-pill); flex: none; }
.stat.g { background: var(--green); }
.stat.r { background: var(--red); }
.stat.f { background: var(--faint); }
.hname { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; min-width: 0; }
.hname .n { font-weight: 600; font-size: 14px; }
.hbadge { font: 10.5px var(--sans); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); border: 1px solid var(--line); border-radius: var(--r-sm); padding: 1px 7px; }
.hmeta { color: var(--faint); font-size: 12.5px; }
.hwhen { color: var(--faint); font-size: 12.5px; white-space: nowrap; }
.hbar { display: inline-flex; gap: 2px; vertical-align: middle; margin-left: 4px; }
.hcell { width: 7px; height: 12px; border-radius: 2px; background: var(--muted); }
.hcell.green { background: var(--green); }
.hcell.red { background: var(--red); }
.hcell.fail { background: var(--line-strong); }
```

Verify byte-identity (three identical hashes):
```bash
for f in app app-theme-canvas app-theme-void; do awk '/── home: KPI hero tiles/,0' dashboard/public/$f.css | md5sum; done
```
Also confirm the old block is gone from all three: `grep -c "KPI hero tiles + per-row" dashboard/public/*.css` → each file exactly `0` matches of the OLD title (the old block's header comment was `/* ── KPI hero tiles + per-row history bars ─…`; the new one says `home: KPI hero tiles`).

- [ ] **Step 5: Verify live**

`node --check` on home.js/runs.js/util.js. Server up → Home shows real KPI tiles (Pass rate with green band, Red runs with red band, Total executions no chart), delta lines correct against `/api/runs` counts, recent rows with history bars and relative times, row click → run detail, Enter/Space work, range pill switches 7d/30d/90d/all and tiles recompute, empty-range copy honest. Executions view: KPI row gone, history bars still present, filters work. All 3 themes, console clean. `node --test tests/agg.test.mjs tests/charts.test.mjs tests/runs-api.test.mjs` all green.

- [ ] **Step 6: Commit**

```bash
git add dashboard/public/home.js dashboard/public/util.js dashboard/public/runs.js dashboard/public/app.css dashboard/public/app-theme-canvas.css dashboard/public/app-theme-void.css
git commit -m "feat(dashboard): Home landing page — bold KPI graphs + recent executions; retire the Results-list KPI row"
```

---

### Task 5: Tests catalog (`tests.js`)

**Files:**
- Modify: `dashboard/public/tests.js` (replace stub)
- Modify: 3 theme CSS files (append catalog block)

**Interfaces:**
- Consumes: `api`, `esc`, `rel` (util.js), `catalog`, `groupByTest` (agg.js), `chip`, `headline`, `historyBar` (runs.js exports from Task 4).
- Produces: `renderTests(page)`. Cards navigate to `#insights/<team>/<profile>` (encodeURIComponent on both segments — Task 6 decodes).

- [ ] **Step 1: Replace `dashboard/public/tests.js`**

```javascript
// Tests — catalog of every test the ledger knows (team+profile), most
// recently run first. Full ledger on purpose: a catalog shouldn't lose
// tests that simply haven't run this week (per-test Insights IS ranged).
import { esc, api, rel } from './util.js';
import { catalog, groupByTest } from './agg.js';
import { chip, headline, historyBar } from './runs.js';

export async function renderTests(page) {
  const { runs } = await api('/api/runs');
  const items = catalog(runs);
  const byTest = groupByTest(runs);

  const card = (c) => `
    <div class="catcard" role="button" tabindex="0"
         data-team="${esc(c.team)}" data-profile="${esc(c.profile)}">
      <div class="cathead">
        ${chip(c.last)}
        <span class="catname">${esc(c.team)} · ${esc(c.profile)}</span>
        <span class="hbadge">${c.suite === 'functional' ? 'func' : 'perf'}</span>
      </div>
      <div class="catmeta">${esc(headline(c.last))}${c.last.flake ? ' · not reproduced on re-run' : ''} · ${esc(rel(c.last.recorded_at))}</div>
      <div class="catfoot">
        ${historyBar(c.last, byTest) || '<span></span>'}
        <span class="catcount">${c.count} execution${c.count === 1 ? '' : 's'}</span>
      </div>
    </div>`;

  page.innerHTML = `
    <article class="card" data-screen-label="Tests">
      <div id="stage">
        <div class="pagehead">
          <div>
            <h1>Tests.</h1>
            <p class="why">Every test RedLine knows for the pilot teams. Click one for its execution history and insights.</p>
          </div>
        </div>
        ${items.length ? `<div class="catgrid">${items.map(card).join('')}</div>`
          : `<p class="why">No tests yet — create your first.</p>
             <button class="btn primary" id="catcreate">＋ Create test</button>`}
      </div>
    </article>`;

  page.querySelector('#catcreate')?.addEventListener('click', () => { location.hash = '#create'; });
  page.querySelectorAll('.catcard').forEach((c) => {
    const go = () => {
      location.hash = `#insights/${encodeURIComponent(c.dataset.team)}/${encodeURIComponent(c.dataset.profile)}`;
    };
    c.addEventListener('click', go);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}
```

- [ ] **Step 2: Append the catalog CSS block (all three files, byte-identical)**

```css
/* ── tests: catalog cards ───────────────────────────────────────── */
.catgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; margin-top: 18px; }
.catcard { border: 1px solid var(--line); border-radius: var(--r-md); background: var(--panel-2); padding: 15px 16px; cursor: pointer; display: flex; flex-direction: column; gap: 9px; }
.catcard:hover { border-color: var(--line-strong); background: var(--raise); }
.catcard:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }
.cathead { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.catname { font-weight: 600; font-size: 14.5px; }
.catmeta { color: var(--faint); font-size: 12.5px; }
.catfoot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.catcount { color: var(--faint); font-size: 12px; }
```

Verify: `for f in app app-theme-canvas app-theme-void; do awk '/── tests: catalog cards/,0' dashboard/public/$f.css | md5sum; done` → identical.

- [ ] **Step 3: Verify live**

`node --check dashboard/public/tests.js`. Browser: `#tests` shows one card per team+profile (5 with the current ledger), chips/history bars/counts match the Executions view for the same test, click and Enter navigate to `#insights/<team>/<profile>` (Insights stub until Task 6 — the hash must still be correct), all 3 themes, console clean.

- [ ] **Step 4: Commit**

```bash
git add dashboard/public/tests.js dashboard/public/app.css dashboard/public/app-theme-canvas.css dashboard/public/app-theme-void.css
git commit -m "feat(dashboard): Tests catalog — per-test cards with verdict, history bars, click-through to insights"
```

---

### Task 6: Insights (`insights.js`) — global panels + per-test execution bars

**Files:**
- Modify: `dashboard/public/insights.js` (replace stub)
- Modify: 3 theme CSS files (append insights block)

**Interfaces:**
- Consumes: `esc` (util.js), `rangedRuns/rangePill/bindRangePill` (range.js), `kpis/groupByTest/passRateByTest/slowestP95` (agg.js), `barChart` (charts.js), `when` (runs.js export).
- Produces: `renderInsights(page)` handling both `#insights` and `#insights/<team>/<profile>`.

- [ ] **Step 1: Replace `dashboard/public/insights.js`**

```javascript
// Insights — native analytics from the ledger. No Grafana dependency.
// #insights                     → four global panels (the Grafana top row, ledger-computed)
// #insights/<team>/<profile>    → per-test execution history, hoverable bars
import { esc } from './util.js';
import { rangedRuns, rangePill, bindRangePill } from './range.js';
import { kpis, groupByTest, passRateByTest, slowestP95 } from './agg.js';
import { barChart } from './charts.js';
import { when } from './runs.js';

export async function renderInsights(page) {
  const m = location.hash.match(/^#insights\/([^/]+)\/(.+)$/);
  if (m) return renderTest(page, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
  return renderGlobal(page);
}

// ── global panels ────────────────────────────────────────────────────

const prow = (label, valueText, pct, cls) => `
  <div class="prow">
    <span class="plabel">${esc(label)}</span>
    <span class="ptrack"><i class="pfill ${cls}" style="width:${Math.max(2, Math.min(100, pct)).toFixed(1)}%"></i></span>
    <span class="pval">${esc(valueText)}</span>
  </div>`;

async function renderGlobal(page) {
  const { runs } = await rangedRuns();
  const k = kpis(runs);
  const rates = passRateByTest(runs);
  const slow = slowestP95(runs);
  const maxP95 = slow.length ? Math.max(...slow.map((s) => s.p95)) : 1;

  page.innerHTML = `
    <article class="card" data-screen-label="Insights">
      <div id="stage">
        <div class="pagehead">
          <div>
            <h1>Insights.</h1>
            <p class="why">Native analytics computed from the run ledger — the same headline panels as the team Grafana dashboards, no Grafana needed.</p>
          </div>
          ${rangePill()}
        </div>
        <div class="panelgrid">
          <div class="panel pstat">
            <div class="plab">Failed by threshold</div>
            <div class="pnum red">${k.red}</div>
            <div class="psub">${k.corroborated} corroborated ×2</div>
          </div>
          <div class="panel pstat">
            <div class="plab">Pass rate</div>
            <div class="pnum ${k.passRate !== null && k.passRate < 100 ? 'red' : 'green'}">${k.passRate !== null ? `${k.passRate}%` : '—'}</div>
            <div class="psub">${k.passRate !== null ? `${k.green} green of ${k.green + k.red} verdicts` : 'no verdicts in this range'}</div>
          </div>
          <div class="panel">
            <div class="plab">Pass rate by test</div>
            ${rates.length ? rates.map((r) =>
              prow(`${r.team} · ${r.profile}`, `${r.rate}%`, r.rate, r.rate === 100 ? 'green' : 'red')).join('')
              : '<p class="why">No verdicts in this range.</p>'}
          </div>
          <div class="panel">
            <div class="plab">Slowest test p95</div>
            ${slow.length ? slow.map((s) =>
              prow(`${s.team} · ${s.profile} — ${s.metric}`, `${s.p95} ms`, (s.p95 / maxP95) * 100,
                s.threshold != null && s.p95 > s.threshold ? 'red' : 'green')).join('')
              : '<p class="why">No structured perf metrics in this range.</p>'}
          </div>
        </div>
      </div>
    </article>`;

  bindRangePill(page, () => renderGlobal(page));
}

// ── per-test drill-down ──────────────────────────────────────────────

const section = (title, sub, body) => `
  <div class="isec">
    <div class="isechead"><span class="sectitle">${esc(title)}</span><span class="isesub">${esc(sub)}</span></div>
    <div class="iscroll">${body}</div>
  </div>`;

async function renderTest(page, team, profile) {
  const { runs } = await rangedRuns();
  const list = groupByTest(runs).get(`${team}|${profile}`) || [];

  let body = '';
  if (!list.length) {
    body = '<p class="why">No runs recorded for this test in the selected range. Widen the range, or run it from the wizard.</p>';
  } else if (list[list.length - 1].suite === 'functional') {
    const bars = list.filter((r) => r.counts?.total).map((r) => ({
      v: (r.counts.passed / r.counts.total) * 100,
      cls: r.verdict === 'red' ? (r.flake ? 'red hollow' : 'red') : r.verdict === 'green' ? 'green' : 'fail',
      run: r.run_id,
      tip: `${r.run_id}\n${when(r.recorded_at)}\nverdict: ${r.verdict}${r.flake ? ' — not reproduced on re-run' : ''}\n${r.counts.passed}/${r.counts.total} passed${r.counts.failed ? ` · ${r.counts.failed} failed` : ''}${r.counts.skipped ? ` · ${r.counts.skipped} skipped` : ''}\ntrigger: ${r.trigger ?? '—'}`,
    }));
    body = bars.length
      ? section('Pass rate per execution', 'each bar = one run · 100% = every check passed · click a bar for the full run', barChart(bars))
      : '<p class="why">No structured check counts recorded for this range.</p>';
  } else {
    const latest = [...list].reverse().find((r) => r.endpoints.length);
    const charts = (latest ? latest.endpoints : []).map((sample) => {
      const bars = list.map((r) => {
        const e = r.endpoints.find((x) => x.metric === sample.metric);
        return e && {
          v: e.p95_ms,
          cls: e.verdict === 'red' ? 'red' : 'green',
          run: r.run_id,
          tip: `${r.run_id}\n${when(r.recorded_at)}\n${sample.name || sample.metric}: p95 ${e.p95_ms} ms — red line ${e.p95_red_ms} ms\nmetric verdict: ${e.verdict}${r.flake ? '\nrun flake — not reproduced on re-run' : ''}\ntrigger: ${r.trigger ?? '—'}`,
        };
      }).filter(Boolean);
      return bars.length
        ? section(`${sample.name || sample.metric} — p95 per execution`,
            `dashed line = red threshold ${sample.p95_red_ms} ms · click a bar for the full run`,
            barChart(bars, { threshold: sample.p95_red_ms }))
        : '';
    }).join('');
    body = charts || '<p class="why">No structured metrics recorded for this range — older ledger records predate the metrics schema.</p>';
  }

  const last = list[list.length - 1];
  page.innerHTML = `
    <article class="card" data-screen-label="Test insights">
      <div id="stage">
        <a class="backlink" href="#tests">← All tests</a>
        <div class="pagehead">
          <div>
            <h1>${esc(team)} · ${esc(profile)}</h1>
            <p class="why">${list.length} execution${list.length === 1 ? '' : 's'} in range${last ? ` · latest ${esc(when(last.recorded_at))}` : ''}</p>
          </div>
          ${rangePill()}
        </div>
        ${body}
        <div class="tip" id="tip" hidden></div>
      </div>
    </article>`;

  bindRangePill(page, () => renderTest(page, team, profile));

  // Tooltip + navigation for the bars. data-tip is plain text (esc'd at the
  // attribute); textContent keeps it inert.
  const tip = page.querySelector('#tip');
  const show = (el) => {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - 8, r.left + r.width / 2))}px`;
    tip.style.top = `${r.top - 8}px`;
  };
  const hide = () => { tip.hidden = true; };
  page.querySelectorAll('.ibar').forEach((el) => {
    el.addEventListener('mouseenter', () => show(el));
    el.addEventListener('mouseleave', hide);
    el.addEventListener('focus', () => show(el));
    el.addEventListener('blur', hide);
    el.addEventListener('click', () => { location.hash = `#runs/${encodeURIComponent(el.dataset.run)}`; });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.click(); });
  });
}
```

- [ ] **Step 2: Append the insights CSS block (all three files, byte-identical)**

```css
/* ── insights: panels, execution bars, tooltip ──────────────────── */
.panelgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-top: 18px; }
.panel { border: 1px solid var(--line); border-radius: var(--r-md); background: var(--panel-2); padding: 15px 16px; }
.panel .plab { font: 11px var(--sans); letter-spacing: .11em; text-transform: uppercase; color: var(--faint); margin-bottom: 8px; }
.pstat .pnum { font-family: var(--serif); font-size: 38px; font-weight: 500; line-height: 1.1; font-variant-numeric: tabular-nums; }
.pstat .pnum.green { color: var(--green-text); }
.pstat .pnum.red { color: var(--red-text); }
.pstat .psub { color: var(--muted); font-size: 12px; margin-top: 3px; }
.prow { display: grid; grid-template-columns: minmax(110px, 1.3fr) 2fr auto; gap: 10px; align-items: center; padding: 5px 0; }
.plabel { color: var(--muted); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ptrack { height: 8px; border-radius: var(--r-pill); background: var(--line-soft); overflow: hidden; }
.pfill { display: block; height: 100%; border-radius: var(--r-pill); }
.pfill.green { background: var(--green); }
.pfill.red { background: var(--red); }
.pval { color: var(--text); font-size: 12.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.isec { margin: 20px 0 6px; }
.isechead { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.isesub { color: var(--faint); font-size: 12px; }
.iscroll { overflow-x: auto; padding-bottom: 4px; }
.ibars { display: block; }
.ibar { cursor: pointer; }
.ibar.green { fill: var(--green); }
.ibar.red { fill: var(--red); }
.ibar.red.hollow { fill: var(--red-dim); stroke: var(--red); stroke-width: 1.5; }
.ibar.fail { fill: var(--line-strong); }
.ibar:hover { opacity: .82; }
.ibar:focus-visible { outline: 2px solid var(--brass); outline-offset: 1px; }
.ithresh { stroke: var(--red); stroke-dasharray: 4 4; stroke-width: 1.4; opacity: .7; }
.tip { position: fixed; transform: translate(-50%, -100%); background: var(--panel); border: 1px solid var(--line-strong); border-radius: var(--r-sm); box-shadow: var(--shadow-2); padding: 9px 12px; font: 12px var(--mono); color: var(--text); white-space: pre-line; pointer-events: none; z-index: 50; max-width: 340px; }
```

Note: `barChart` emits `cls` `'red hollow'` → the rect's class is `"ibar red hollow"`, so the CSS selector `.ibar.red.hollow` matches.

Verify byte-identity: `for f in app app-theme-canvas app-theme-void; do awk '/── insights: panels/,0' dashboard/public/$f.css | md5sum; done` → identical.

- [ ] **Step 3: Verify live**

`node --check dashboard/public/insights.js`. Browser:
- `#insights` — four panels; numbers re-derived by hand from `/api/runs` for the active range (Failed = red count; Pass rate = green/(green+red)); bars sorted and colored per the rules; range pill recomputes.
- From Tests, click `demo-web · api-benchmark` → per-metric p95 charts with dashed threshold; hover a bar → tooltip with run id/time/values; Tab reaches bars and focus shows the tooltip; Enter and click land on `#runs/<id>` detail.
- Functional test (`saucedemo-team · functional`) → pass-rate bars; a flake run renders hollow.
- Unknown test hash `#insights/nope/nope` → honest empty copy + back link. All 3 themes, console clean.

- [ ] **Step 4: Commit**

```bash
git add dashboard/public/insights.js dashboard/public/app.css dashboard/public/app-theme-canvas.css dashboard/public/app-theme-void.css
git commit -m "feat(dashboard): Insights — native global panels + per-test execution bars with hover detail"
```

---

### Task 7: Executions date-range + smoke registry + full verification battery + impeccable

**Files:**
- Modify: `dashboard/public/runs.js` (range integration)
- Modify: `tests/smoke.ps1`
- Verify: everything, live, all themes; impeccable pass

**Interfaces:**
- Consumes: `filterRange` (agg.js), `getRange/rangePill/bindRangePill` (range.js).

- [ ] **Step 1: Range-filter the Executions list**

In `dashboard/public/runs.js`:
1. Add imports: `import { filterRange } from './agg.js';` (extend the existing agg import) and `import { getRange, rangePill, bindRangePill } from './range.js';`
2. In `renderList`, immediately after `const { runs: allRuns, unreadable } = await api('/api/runs');` (rename the destructured `runs` to `allRuns`), add:
```javascript
  const runs = filterRange(allRuns, getRange());
```
(The rest of the function — teams, shown, grouping — reads the ranged `runs`; history bars therefore reflect the range, consistent with the trends beside them.)
3. Add the pill to the end of the `.runsbar` div in the HTML: after the last verdict `fbtn`, append `<span class="fsep"></span>${rangePill()}`.
4. After the existing listener wiring at the end of `renderList`, add: `bindRangePill(main, () => renderList(main));`

Run `node --check dashboard/public/runs.js` and `node --test tests/runs-api.test.mjs` (still 5/5 — the lib is untouched).

- [ ] **Step 2: Register new files in `tests/smoke.ps1`**

Find the block of `Test-Item` lines added for the runs view (it checks `dashboard/runs-lib.mjs`, `dashboard/public/runs.js`, …) and append matching lines, following the file's existing helper convention exactly:

```powershell
Test-Item "dashboard/public/shell.js"
Test-Item "dashboard/public/home.js"
Test-Item "dashboard/public/tests.js"
Test-Item "dashboard/public/insights.js"
Test-Item "dashboard/public/agg.js"
Test-Item "dashboard/public/charts.js"
Test-Item "dashboard/public/range.js"
Test-Item "tests/agg.test.mjs"
Test-Item "tests/charts.test.mjs"
```

(If the helper is named differently in the file — match whatever the surrounding lines use verbatim.)

Run: `powershell -NoProfile -File tests/smoke.ps1` → `SMOKE PASSED`.

- [ ] **Step 3: Full verification battery**

```bash
node --test tests/agg.test.mjs tests/charts.test.mjs tests/runs-api.test.mjs   # all pass
powershell -NoProfile -File tests/smoke.ps1                                    # SMOKE PASSED
```
Live (all three themes):
1. Fresh-tab boots: `/`, `#home`, `#tests`, `#runs`, `#runs/<real-id>`, `#insights`, `#insights/<team>/<profile>`, `#create` — each lands correctly, nav highlight right, console clean.
2. Wizard full pass: Create test → stepper renders, steps navigate (click + arrows), a functional or perf flow reaches its outcome page, outcome's "view this run" link lands on run detail, leaving `#create` hides `#bar` and clears teamtag.
3. Date range: set 7d on Home → Executions and Insights show the same range (shared state); set All time → counts grow accordingly.
4. Cross-navigation: Home row → run detail → back to `#runs` → Tests card → per-test insights → bar click → run detail.
5. Keyboard-only walk: rail nav, Create test, a Home row, a catalog card, an insights bar (tooltip on focus), range pill — all reachable and operable.
6. Traversal guard still 403s: `curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4242/reports/..%2f..%2fstate/run-ledger.jsonl"` → `403`.

- [ ] **Step 4: Impeccable pass**

Invoke the impeccable skill on the new surfaces (shell rail/topbar, Home, Tests, Insights, stepper): hierarchy, contrast (chip/pill text on all three themes), focus states, spacing rhythm, empty states. Apply fixes; re-verify the three themes; CSS blocks stay byte-identical (re-run the md5 checks from Tasks 3–6).

- [ ] **Step 5: Commit**

```bash
git add dashboard/public/runs.js tests/smoke.ps1 dashboard/public/app.css dashboard/public/app-theme-canvas.css dashboard/public/app-theme-void.css
git commit -m "feat(dashboard): date-range on Executions; smoke registry; battery + impeccable pass"
```

(If impeccable produced fixes in other page modules, include those files in the same commit and say so in the report.)

---

## Final gate (controller-driven, after Task 7)

Whole-branch review (most capable model) over the full range since `8eb8b18` (pre-shell), fed with the progress-ledger triage list; one fix wave; then `superpowers:finishing-a-development-branch`.

## Spec coverage checklist

- Shell rail + topbar + Create test + routing — Task 3
- Wizard focused flow + stepper — Task 3
- Home KPI graphs + recent + range — Task 4 (KPI-row supersession included)
- Tests catalog — Task 5
- Insights global panels + per-test hoverable bars — Task 6
- Date range on Home/Executions/Insights — Tasks 4/7/6
- New logo + favicon — Task 3
- Theme toggle independent — Task 3 (moved to shell)
- agg/charts unit tests — Tasks 1–2; smoke registry — Task 7
- CSS byte-identical ×3 — every CSS task verifies md5
