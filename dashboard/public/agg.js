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
    const sep = key.indexOf('|'); const team = key.slice(0, sep), profile = key.slice(sep + 1);
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
    const sep = key.indexOf('|'); const team = key.slice(0, sep), profile = key.slice(sep + 1);
    return { key, team, profile, rate: Math.round((g / (g + rd)) * 100) };
  }).filter(Boolean);
}

// Per-team health roll-up — the cross-team view. One row per team:
// tests known, executions, pass rate (green/(green+red), null when no
// verdicts), flake count. Sorted by most recent activity.
export function teamRollup(runs) {
  const m = new Map();
  for (const r of runs) {
    if (!r.team) continue;
    if (!m.has(r.team)) m.set(r.team, { team: r.team, tests: new Set(), executions: 0, green: 0, red: 0, flakes: 0, lastAt: '' });
    const t = m.get(r.team);
    t.executions++;
    if (r.profile) t.tests.add(r.profile);
    if (r.verdict === 'green') t.green++;
    if (r.verdict === 'red') t.red++;
    if (r.flake) t.flakes++;
    if ((r.recorded_at || '') > t.lastAt) t.lastAt = r.recorded_at;
  }
  return [...m.values()]
    .map((t) => ({ ...t, tests: t.tests.size, passRate: t.green + t.red ? Math.round((t.green / (t.green + t.red)) * 100) : null }))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

// Tests that flaked in range (red cleared by the confirmation re-run) —
// the "which tests cry wolf" list. Sorted worst-first by flake count.
export function flakyTests(runs) {
  return [...groupByTest(runs).entries()].map(([key, list]) => {
    const flakes = list.filter((r) => r.flake);
    if (!flakes.length) return null;
    const sep = key.indexOf('|'); const team = key.slice(0, sep), profile = key.slice(sep + 1);
    return { key, team, profile, flakes: flakes.length, executions: list.length, lastFlakeAt: flakes[flakes.length - 1].recorded_at };
  }).filter(Boolean).sort((a, b) => b.flakes - a.flakes);
}

// Latest structured p95 per perf test: worst endpoint (highest p95/red-line
// ratio) of the newest run carrying endpoints[]. Functional tests excluded.
export function slowestP95(runs) {
  return [...groupByTest(runs).entries()].map(([key, list]) => {
    const r = [...list].reverse().find((x) => x.suite !== 'functional' && x.endpoints.length);
    if (!r) return null;
    const worst = r.endpoints.reduce((a, e) =>
      (e.p95_ms / (e.p95_red_ms || 1) > a.p95_ms / (a.p95_red_ms || 1) ? e : a), r.endpoints[0]);
    const sep = key.indexOf('|'); const team = key.slice(0, sep), profile = key.slice(sep + 1);
    return { key, team, profile, p95: worst.p95_ms, threshold: worst.p95_red_ms, metric: worst.name || worst.metric };
  }).filter(Boolean).sort((a, b) => b.p95 - a.p95);
}
