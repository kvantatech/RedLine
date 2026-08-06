// gen-alerts.mjs — generate Grafana alert rules FROM baselines/*.json.
//
//   node perf-eng-otel-dashboards/tools/gen-alerts.mjs
//
// One rule per baseline endpoint metric: p95 of the metric's Mimir histogram
// over the last 30m of samples vs that endpoint's p95_red_ms. Baselines stay
// the single source of truth — re-run this after `curate-baselines` changes a
// red line; never hand-edit the generated file. Runs are episodic, so
// noDataState=OK (most of the day there is no data — that is not an alert).
//
// ponytail: p95 rules only. error_rate_red is not exported per-endpoint to
// Mimir, so no error-rate rules until the tag contract carries one.

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'perf-eng-otel-dashboards', 'base', 'common', 'alerts', 'redline-red-lines.json');
const DS_UID = 'P2EDC53E3FEAC6ED1'; // Mimir-demo-perf (same as the dashboards)

const envTag = (e) => (e === 'stg' ? 'staging' : e); // baseline env code → OTLP environment tag

const rules = [];
for (const f of (await readdir(join(ROOT, 'baselines'))).sort()) {
  const m = f.match(/^([a-z0-9-]+)\.([a-z0-9-]+)\.json$/);
  if (!m) continue;
  const [, team, profile] = m;
  let b;
  try { b = JSON.parse(await readFile(join(ROOT, 'baselines', f), 'utf8')); } catch { continue; }
  // Two baseline shapes exist: API profiles carry endpoints[] ({metric, p95_red_ms});
  // browser profiles carry metrics{} ({<metric_name>: {p95_red_ms}}). Cover both —
  // skipping one silently would ship a gap that reads as coverage.
  const entries = [
    ...(b.endpoints || []).map((ep) => ({ metric: ep.metric, p95_red_ms: ep.p95_red_ms, name: ep.name })),
    ...Object.entries(b.metrics || {})
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => ({ metric: k, p95_red_ms: v?.p95_red_ms, name: k })),
  ];
  for (const ep of entries) {
    if (!ep.metric || !(ep.p95_red_ms > 0)) continue;
    const key = `${team}.${profile}.${ep.metric}`;
    const expr = `histogram_quantile(0.95, sum by (le) (increase(k6_${ep.metric}_milliseconds_bucket{product="${team}", test_file="${profile}", environment="${envTag(b.env || 'stg')}"}[30m])))`;
    rules.push({
      // Grafana uid cap is 40 chars — stable short hash, readable title
      uid: `rl-${createHash('sha1').update(key).digest('hex').slice(0, 12)}`,
      title: `RedLine red line — ${team}/${profile} ${ep.name || ep.metric} p95 > ${ep.p95_red_ms}ms`,
      condition: 'C',
      data: [
        {
          refId: 'A',
          relativeTimeRange: { from: 1800, to: 0 },
          datasourceUid: DS_UID,
          model: { expr, instant: true, refId: 'A' },
        },
        {
          refId: 'C',
          datasourceUid: '__expr__',
          model: {
            type: 'threshold', refId: 'C', expression: 'A',
            conditions: [{ evaluator: { type: 'gt', params: [ep.p95_red_ms] } }],
          },
        },
      ],
      for: '0s', // one breached evaluation = alert; runs are too sparse to wait out
      noDataState: 'OK',
      execErrState: 'OK',
      labels: { source: 'redline', team, profile },
      annotations: {
        summary: `${team}/${profile} — ${ep.name || ep.metric} p95 crossed its red line (${ep.p95_red_ms}ms). Baseline: baselines/${f}.`,
      },
    });
  }
}

const doc = {
  apiVersion: 1,
  groups: [{
    orgId: 1,
    name: 'RedLine red lines',
    folder: 'demo-perf',
    interval: '5m',
    rules,
  }],
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`wrote ${rules.length} rule(s) → ${OUT}`);
