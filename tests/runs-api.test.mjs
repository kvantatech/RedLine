// Unit tests for dashboard/runs-lib.mjs — run with: node --test tests/runs-api.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLedger, filterRuns, mergeRuns, artifactSafePath, grafanaUrl, normalizeRecord } from '../dashboard/runs-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = await readFile(join(HERE, 'fixtures', 'runs-ledger.jsonl'), 'utf8');

test('parseLedger: counts, order, filings, corrections, unreadable', () => {
  const { runs, unreadable } = parseLedger(fixture);
  // 6 run records (correction + jira-filing lines are not runs; 1 malformed line)
  assert.equal(runs.length, 6);
  assert.equal(unreadable, 1);
  // newest first by recorded_at
  assert.equal(runs[0].run_id, 'fx-team_api-benchmark_stg_20260710T090000Z');
  assert.equal(runs.at(-1).run_id, 'fx-team_api-benchmark_stg_20260609T000001Z');
  // jira-filing line applied onto its run
  const filed = runs.find((r) => r.run_id === 'fx-team_functional_stg_20260709T190000Z');
  assert.equal(filed.jira.filed, true);
  assert.equal(filed.jira.key, 'FX-101');
});

test('normalize: suite, verdict mapping, flake annotation, counts, endpoints', () => {
  const { runs } = parseLedger(fixture);
  const byId = Object.fromEntries(runs.map((r) => [r.run_id, r]));

  const corroborated = byId['fx-team_functional_stg_20260709T190000Z'];
  assert.equal(corroborated.suite, 'functional');
  assert.equal(corroborated.verdict, 'red');
  assert.equal(corroborated.flake, false);            // sources: 2 → a real red
  assert.deepEqual(corroborated.counts, { total: 16, passed: 11, failed: 5, skipped: 0 });

  const flaky = byId['fx-team_functional_stg_20260709T233000Z'];
  assert.equal(flaky.verdict, 'red');                 // still red — never a third verdict
  assert.equal(flaky.flake, true);                    // sources: 1 → annotation only
  assert.equal(flaky.confirm_verdict, 'green');

  const thin = byId['fx-team_api-benchmark_stg_20260609T000001Z'];
  assert.equal(thin.suite, 'performance');
  assert.equal(thin.verdict, 'green');
  assert.deepEqual(thin.endpoints, []);               // old thin line → no chart points
  assert.equal(thin.counts, null);

  const rich = byId['fx-team_api-benchmark_stg_20260710T090000Z'];
  assert.equal(rich.endpoints[0].p95_ms, 829);
  assert.equal(rich.endpoints[0].p95_red_ms, 1000);

  const crashed = byId['other-team_browser-journey_stg_20260708T120000Z'];
  assert.equal(crashed.verdict, 'fail');              // "didn't finish" — not a verdict chip
  assert.equal(crashed.verdict_raw, 'fail');
  assert.equal(crashed.flake, false);

  // old red with NO corroboration fields (pre-corroborate flow, e.g. RED-SIM-001):
  // absence of confirm data is not a flake — it renders as a plain red.
  const oldRed = byId['fx-team_api-benchmark_stg_RED-SIM-OLD'];
  assert.equal(oldRed.verdict, 'red');
  assert.equal(oldRed.flake, false);
  assert.equal(oldRed.sources, null);
});

test('filterRuns: team, suite, verdict, limit', () => {
  const { runs } = parseLedger(fixture);
  assert.equal(filterRuns(runs, { team: 'fx-team' }).length, 5);
  assert.equal(filterRuns(runs, { suite: 'functional' }).length, 2);
  assert.equal(filterRuns(runs, { verdict: 'fail' }).length, 1);
  assert.equal(filterRuns(runs, { verdict: 'red' }).length, 3);
  assert.equal(filterRuns(runs, { limit: 2 }).length, 2);
  assert.equal(filterRuns(runs, {}).length, 6);
});

test('mergeRuns: origin tagging, local wins on collision, newest-first order', () => {
  const mk = (id, at) => ({ run_id: id, recorded_at: at });
  const local = [mk('a', '2026-07-10T10:00:00Z'), mk('b', '2026-07-08T10:00:00Z')];
  const remotes = [
    { name: 'eu-cluster', runs: [mk('b', '2026-07-08T10:00:00Z'), mk('c', '2026-07-09T10:00:00Z')] }, // b duplicates local
    { name: 'us-cluster', runs: [mk('d', '2026-07-11T10:00:00Z')] },
  ];
  const merged = mergeRuns(local, remotes);
  assert.deepEqual(merged.map((r) => r.run_id), ['d', 'a', 'c', 'b']); // newest first
  assert.deepEqual(merged.map((r) => r.origin), ['us-cluster', 'local', 'eu-cluster', 'local']); // b kept local
  assert.equal(merged.length, 4); // duplicate b not doubled
  // no remotes / empty config degrades to plain local
  const solo = mergeRuns([mk('x', '2026-07-01T00:00:00Z')]);
  assert.equal(solo[0].origin, 'local');
});

test('normalizeRecord: heal object passes through, non-object rejected', () => {
  const heal = { outcome: 'PARTIAL', policy: 'ask', healed: 2, escalated: 1, diff: 'reports/x/heal/suite.diff' };
  assert.deepEqual(normalizeRecord({ run_id: 'a', heal }).heal, heal);   // object → kept
  assert.equal(normalizeRecord({ run_id: 'b', heal: 'HEALED' }).heal, null); // string → dropped (type guard)
  assert.equal(normalizeRecord({ run_id: 'c' }).heal, null);            // absent → null, no throw
});

test('parseLedger: heal-graduation line applied onto its run', () => {
  const text = [
    JSON.stringify({ run_id: 'h1', recorded_at: '2026-07-17T10:00:00Z', overall_verdict: 'red', heal: { outcome: 'PARTIAL', policy: 'ask', healed: 2, escalated: 1 } }),
    JSON.stringify({ type: 'heal-graduation', run_id: 'h1', graduated_at: '2026-07-17T11:00:00Z', committed: true, sha: 'abc123' }),
    JSON.stringify({ type: 'heal-graduation', run_id: 'no-such-run' }), // orphan → ignored, no throw
    JSON.stringify({ run_id: 'h2', recorded_at: '2026-07-17T09:00:00Z', overall_verdict: 'red' }), // graduation without heal object
    JSON.stringify({ type: 'heal-graduation', run_id: 'h2' }),
    JSON.stringify({ run_id: 'h3', recorded_at: '2026-07-17T08:00:00Z', overall_verdict: 'red', heal: { outcome: 'HEALED_AUTO', policy: 'trust', healed: 1, escalated: 0 } }),
    JSON.stringify({ type: 'heal-graduation', run_id: 'h3', graduated_at: '2026-07-17T08:30:00Z' }), // pre-commit-feature line: no committed/sha at all
  ].join('\n');
  const { runs } = parseLedger(text);
  const h1 = runs.find((r) => r.run_id === 'h1');
  assert.equal(h1.heal.graduated, true);
  assert.equal(h1.heal.graduated_at, '2026-07-17T11:00:00Z');
  assert.equal(h1.heal.committed, true);
  assert.equal(h1.heal.sha, 'abc123');
  assert.equal(runs.find((r) => r.run_id === 'h2').heal, null); // no heal → graduation is a no-op
  const h3 = runs.find((r) => r.run_id === 'h3');
  assert.equal(h3.heal.graduated, true);
  assert.equal(h3.heal.committed, null); // old-style graduation line predates commit-on-approve — not committed
});

test('parseLedger: committed:true is sticky — a racing committed:false line never demotes it', () => {
  const text = [
    JSON.stringify({ run_id: 'r1', recorded_at: '2026-07-18T10:00:00Z', overall_verdict: 'red', heal: { outcome: 'HEALED', policy: 'ask', healed: 1, escalated: 0 } }),
    JSON.stringify({ type: 'heal-graduation', run_id: 'r1', graduated_at: '2026-07-18T11:00:00Z', committed: true, sha: 'winner' }),
    JSON.stringify({ type: 'heal-graduation', run_id: 'r1', graduated_at: '2026-07-18T11:00:01Z', committed: false, sha: null }), // the racing loser
  ].join('\n');
  const { runs } = parseLedger(text);
  const r1 = runs.find((r) => r.run_id === 'r1');
  assert.equal(r1.heal.committed, true);  // not demoted
  assert.equal(r1.heal.sha, 'winner');    // real sha kept
});

test('artifactSafePath: allows inside, blocks traversal', () => {
  const root = join('C:', 'x', 'reports');
  const ok = artifactSafePath(root, 'team_run_1', join('artifacts', 'shot.png'));
  assert.ok(ok && ok.startsWith(join(root, 'team_run_1') + sep));
  assert.equal(artifactSafePath(root, 'team_run_1', '..' + sep + 'other' + sep + 'x.txt'), null);
  assert.equal(artifactSafePath(root, '..', 'x.txt'), null);
  assert.equal(artifactSafePath(root, 'team_run_1', 'C:\\windows\\system32\\config'), null);
  assert.equal(artifactSafePath(root, 'team/../..', 'x.txt'), null);
  assert.equal(artifactSafePath(root, 'team_run_1', ''), null);
});

test('grafanaUrl: perf runs only, correct shape, null without base', () => {
  const { runs } = parseLedger(fixture);
  const byId = Object.fromEntries(runs.map((r) => [r.run_id, r]));
  const perf = byId['fx-team_api-benchmark_stg_20260710T090000Z'];
  const func = byId['fx-team_functional_stg_20260709T190000Z'];

  assert.equal(grafanaUrl(perf, ''), null);
  assert.equal(grafanaUrl(func, 'https://g.example.com'), null); // functional → no metrics dashboard

  const url = new URL(grafanaUrl(perf, 'https://g.example.com'));
  assert.equal(url.pathname, '/d/perf-fx-team/perf-fx-team');
  assert.equal(url.searchParams.get('var-test_file'), 'api-benchmark');
  assert.equal(url.searchParams.get('var-run_id'), perf.run_id);
  assert.equal(url.searchParams.get('var-environment'), 'staging');
  assert.ok(Number(url.searchParams.get('to')) > Number(url.searchParams.get('from')));
});
