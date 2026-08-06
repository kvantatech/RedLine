import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inRange, filterRange, groupByTest, kpis, rolling, catalog, passRateByTest, slowestP95,
  teamRollup, flakyTests,
} from '../dashboard/public/agg.js';

// Fixed "now" so range math is deterministic: 2026-07-11T12:00:00Z
const NOW = Date.parse('2026-07-11T12:00:00Z');
const d = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();

// Minimal normalized-record factory matching runs-lib.mjs output shape.
const run = (o) => ({
  run_id: o.id, recorded_at: o.at, team: o.team === undefined ? 't1' : o.team, profile: o.profile === undefined ? 'p1' : o.profile,
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

test('teamRollup: per-team counts, pass rate, flakes; recent-activity order', () => {
  const t = teamRollup(RUNS);
  assert.deepEqual(t.map((x) => x.team), ['t1', 't2']); // t1 ran most recently
  const t1 = t[0];
  assert.equal(t1.tests, 1);
  assert.equal(t1.executions, 6);
  assert.equal(t1.green, 3);
  assert.equal(t1.red, 2);
  assert.equal(t1.flakes, 1);
  assert.equal(t1.passRate, Math.round((3 / 5) * 100)); // r5 fail excluded
  const t2 = t[1];
  assert.equal(t2.executions, 2);
  assert.equal(t2.passRate, 50);
  // a team with only fail runs gets passRate null, never a fake 0
  const only = teamRollup([run({ id: 'z', at: d(1), team: 't3', verdict: 'fail' })]);
  assert.equal(only[0].passRate, null);
});

test('flakyTests: only tests with confirmed flakes, worst-first', () => {
  const f = flakyTests(RUNS);
  assert.equal(f.length, 1); // only t1|p1 flaked (r6); t2 red was corroborated-style, no flake flag
  assert.equal(f[0].key, 't1|p1');
  assert.equal(f[0].flakes, 1);
  assert.equal(f[0].executions, 6);
  assert.equal(f[0].lastFlakeAt, RUNS[2].recorded_at); // r6
  assert.deepEqual(flakyTests([run({ id: 'q', at: d(1) })]), []); // no flakes → empty
});

test('slowestP95: worst endpoint of newest structured run; functional excluded; sorted', () => {
  const s = slowestP95(RUNS);
  assert.equal(s.length, 1); // only t1|p1 has endpoints; functional excluded
  assert.equal(s[0].p95, 900);          // search is worst (900/800 > 400/500)
  assert.equal(s[0].threshold, 800);
  assert.equal(s[0].metric, 'search');
});
