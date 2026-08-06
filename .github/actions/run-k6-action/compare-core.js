#!/usr/bin/env node
/**
 * compare-core — the ONE executable verdict implementation.
 *
 * Spec: .github/skills/compare-core/SKILL.md (this file implements it 1:1).
 * Used by BOTH delivery surfaces:
 *   - run-k6-action CI gate (action.yml in this folder) — zero model calls
 *   - the agentic loop (compare-to-baseline skill runs this same file)
 * Never duplicate the math — change the SKILL.md spec and this file together.
 *
 * Usage:
 *   node compare-core.js
 *     --summary <path>     k6 --summary-export JSON (or handleSummary JSON)   [or --contract]
 *     --contract <path>    contract.json from parse-k6-json-summary           [or --summary]
 *     --gate <path>        perf-gate.yaml threshold source                    [or --baseline]
 *     --baseline <path>    baselines/<team>.<profile>.json threshold source   [or --gate]
 *     --exit-code <n>      k6 process exit code (default 0; 97 = crash, 99 = k6 thresholds failed)
 *     --run-id <s>         run identifier (labeling only)
 *     --mode <m>           report-only | enforce (overrides gate.mode; default report-only)
 *     --out <path>         verdict.json output path (default ./verdict.json)
 *
 * Exit codes (the gate contract):
 *   green / no-baseline          -> 0
 *   red,  mode=enforce           -> gate.exit_code_on_red (default 99)
 *   fail, mode=enforce           -> 97
 *   red/fail, mode=report-only   -> 0 (report-only never blocks)
 */

'use strict';
const fs = require('fs');
const path = require('path');

// ---------- CLI args ----------
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) { args[k.slice(2)] = argv[i + 1]; i++; }
  }
  return args;
}

// ---------- minimal YAML parser for the fixed perf-gate.yaml schema ----------
// Handles: top-level scalars, `thresholds:` (list of flat maps), `gate:` (flat map).
// Comments (#) stripped; values unquoted/quoted scalars, ints, floats, booleans.
function parseGateYaml(text) {
  const doc = { thresholds: [], gate: {} };
  let section = null;   // null | 'thresholds' | 'gate'
  let current = null;   // current thresholds list item
  for (let raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indent = line.match(/^ */)[0].length;

    if (indent === 0) {
      current = null;
      const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!m) continue;
      const [, key, val] = m;
      if (val === '') { section = key; if (key !== 'thresholds' && key !== 'gate') doc[key] = {}; }
      else { section = null; doc[key] = coerce(val); }
      continue;
    }

    if (section === 'thresholds') {
      const item = line.match(/^\s*-\s+([A-Za-z0-9_-]+):\s*(.*)$/);
      if (item) { current = { [item[1]]: coerce(item[2]) }; doc.thresholds.push(current); continue; }
      const cont = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
      if (cont && current) { current[cont[1]] = coerce(cont[2]); }
    } else if (section === 'gate') {
      const m = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
      if (m) { doc.gate[m[1]] = coerce(m[2]); }
    }
  }
  return doc;
}

function coerce(s) {
  s = s.trim().replace(/^['"]|['"]$/g, '');
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

// ---------- threshold source -> normalized list ----------
// -> { team, profile, env, mode, exitCodeOnRed, thresholds: [{metric, p95_red_ms, error_rate_red?}] }
function loadThresholds(args) {
  if (args.gate) {
    const doc = parseGateYaml(fs.readFileSync(args.gate, 'utf8'));
    return {
      team: doc.team || '', profile: doc.profile || '', env: doc.env || '',
      mode: (doc.gate && doc.gate.mode) || 'report-only',
      exitCodeOnRed: (doc.gate && doc.gate.exit_code_on_red) || 99,
      thresholds: (doc.thresholds || []).filter(t => t.metric),
      source: args.gate,
    };
  }
  if (args.baseline) {
    const doc = JSON.parse(fs.readFileSync(args.baseline, 'utf8'));
    // two baseline shapes exist: endpoints[] (array with name+metric) and metrics{} (map keyed by metric)
    const thresholds = Array.isArray(doc.endpoints)
      ? doc.endpoints.map(e => ({
          metric: e.metric || e.name, name: e.name || e.metric,
          p95_red_ms: e.p95_red_ms, error_rate_red: e.error_rate_red,
        }))
      : Object.entries(doc.metrics || doc.endpoints || {}).map(([metric, m]) => ({
          metric, name: metric, p95_red_ms: m.p95_red_ms, error_rate_red: m.error_rate_red,
        }));
    return {
      team: doc.team || '', profile: doc.profile || '', env: doc.env || '',
      mode: 'report-only', exitCodeOnRed: 99, thresholds: thresholds.filter(t => t.metric), source: args.baseline,
    };
  }
  throw new Error('one of --gate <perf-gate.yaml> or --baseline <baseline.json> is required');
}

// ---------- run data -> p95/error_rate lookup ----------
function loadRunData(args) {
  if (args.contract) {
    const c = JSON.parse(fs.readFileSync(args.contract, 'utf8'));
    return {
      kind: 'contract',
      lookup(metric) {
        const ep = (c.endpoints || []).find(e => e.metric === metric || e.name === metric);
        if (!ep) return null;
        return { p95: ep.p95 == null ? null : Math.round(ep.p95), error_rate: ep.error_rate ?? null };
      },
      checksRate: c.checks ? c.checks.rate : null,
    };
  }
  if (args.summary) {
    const s = JSON.parse(fs.readFileSync(args.summary, 'utf8'));
    if (!s.metrics) throw new Error(`not a k6 summary (no "metrics" key): ${args.summary}`);
    const vals = (name) => { const m = s.metrics[name]; return m ? (m.values || m) : null; };
    const checks = vals('checks');
    // summary-export rate metrics carry the rate in "value"; handleSummary carries it in "rate"
    const checksRate = checks ? (checks.rate ?? checks.value ?? null) : null;
    return {
      kind: 'summary',
      lookup(metric) {
        const v = vals(metric);
        if (!v) return null;
        const p95 = v['p(95)'];
        return { p95: p95 == null ? null : Math.round(p95), error_rate: null };
      },
      checksRate,
    };
  }
  throw new Error('one of --summary <summary.json> or --contract <contract.json> is required');
}

// ---------- verdict (Steps 1-6 of the compare-core spec) ----------
function compare(args) {
  const src = loadThresholds(args);
  const exitCode = parseInt(args['exit-code'] ?? '0', 10);
  const mode = args.mode || src.mode || 'report-only';
  const runId = args['run-id'] || '';

  const verdict = {
    run_id: runId, team: src.team, profile: src.profile, env: src.env,
    overall_verdict: 'green', exit_code: exitCode,
    endpoints: [], missing_endpoints: [], summary_line: '',
    mode, threshold_source: src.source,
  };

  // Step 1 — crash short-circuit: exit 97 (k6 abort) or any code other than 0/99 = FAIL.
  if (exitCode !== 0 && exitCode !== 99) {
    verdict.overall_verdict = 'fail';
    verdict.summary_line = exitCode === 97
      ? 'FAIL — k6 abort (exit 97) — run did not complete'
      : `FAIL — unexpected k6 exit code ${exitCode} — run did not complete`;
    return { verdict, src, mode };
  }

  if (src.thresholds.length === 0) {
    verdict.overall_verdict = 'no-baseline';
    verdict.summary_line = `NO-BASELINE — no thresholds defined in ${src.source}`;
    return { verdict, src, mode };
  }

  const run = loadRunData(args);
  // error-rate source: per-endpoint from contract when present, else the global
  // checks failure rate (custom Trend metrics carry no per-metric error rate)
  const globalErrorRate = run.checksRate == null ? null : 1 - run.checksRate;

  for (const t of src.thresholds) {
    const ep = {
      name: t.name || t.metric, metric: t.metric,
      p95_ms: null, p95_red_ms: t.p95_red_ms,
      delta_ms: null, delta_pct: null, verdict: 'green',
    };
    const found = run.lookup(t.metric) || (t.name && t.name !== t.metric ? run.lookup(t.name) : null);

    if (!found) {                                  // Step 2 — missing endpoint = red
      ep.verdict = 'red'; ep.reason = 'missing from run output';
      verdict.missing_endpoints.push(t.metric);
    } else if (found.p95 == null || !Number.isFinite(found.p95)) {  // Step 3 — no usable p95 = red
      ep.verdict = 'red'; ep.reason = 'p95 not recorded';
    } else {
      ep.p95_ms = found.p95;
      // A gate must fail CLOSED: a non-numeric/absent threshold is a malformed
      // baseline, not a pass. NaN comparisons (found.p95 > undefined) silently
      // yield green, so guard both operands explicitly.
      const thr = Number(t.p95_red_ms);
      const hasP95 = Number.isFinite(thr);
      const hasErr = t.error_rate_red != null;
      if (!hasP95 && !hasErr) { ep.verdict = 'red'; ep.reason = 'no usable threshold in baseline'; }
      if (hasP95) {
        ep.delta_ms = Math.round(found.p95 - thr);                  // Step 5
        ep.delta_pct = Math.round((ep.delta_ms / thr) * 1000) / 10;
        if (found.p95 > thr) { ep.verdict = 'red'; ep.reason = 'p95 over threshold'; }
      }
      if (hasErr) {                                // error-rate override
        const er = found.error_rate ?? globalErrorRate;
        if (er != null && er > t.error_rate_red) { ep.verdict = 'red'; ep.reason = 'error_rate exceeded'; }
      }
    }
    verdict.endpoints.push(ep);
  }

  // Step 4 — overall = worst (fail > red > green)
  if (verdict.endpoints.some(e => e.verdict === 'red')) verdict.overall_verdict = 'red';

  // summary line
  if (verdict.overall_verdict === 'green') {
    const worst = verdict.endpoints.reduce((a, b) => (a.delta_ms ?? -Infinity) > (b.delta_ms ?? -Infinity) ? a : b);
    verdict.summary_line =
      `GREEN — all ${verdict.endpoints.length} metric(s) within thresholds` +
      (worst.delta_ms != null ? ` (closest: ${worst.metric} p95=${worst.p95_ms}ms vs ${worst.p95_red_ms}ms)` : '');
  } else {
    const reds = verdict.endpoints.filter(e => e.verdict === 'red');
    const w = reds.reduce((a, b) => (a.delta_ms ?? Infinity) > (b.delta_ms ?? Infinity) ? a : b);
    // Key the line on the actual red reason, not on p95 presence — an error-rate
    // or missing-threshold red still has a p95_ms, and citing its (often negative)
    // delta reads as a false p95 breach.
    verdict.summary_line = w.reason === 'p95 over threshold'
      ? `RED — ${w.metric} p95=${w.p95_ms}ms (threshold ${w.p95_red_ms}ms, +${w.delta_ms}ms +${w.delta_pct}%) — ${reds.length} of ${verdict.endpoints.length} red`
      : `RED — ${w.metric}: ${w.reason}${w.p95_ms != null ? ` (p95=${w.p95_ms}ms)` : ''} — ${reds.length} of ${verdict.endpoints.length} red`;
  }
  return { verdict, src, mode };
}

// ---------- GitHub Actions integration (no-ops outside CI) ----------
function emitGithub(verdict) {
  if (process.env.GITHUB_OUTPUT) {
    // Flatten newlines — a metric name carrying a newline could otherwise inject
    // extra key=value pairs into the Actions output file.
    const oneLine = String(verdict.summary_line).replace(/[\r\n]+/g, ' ');
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      `verdict=${verdict.overall_verdict}\nsummary-line=${oneLine}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const icon = { green: '🟢', red: '🔴', fail: '⛔', 'no-baseline': '⚪' }[verdict.overall_verdict];
    let md = `## ${icon} perf gate — ${verdict.overall_verdict.toUpperCase()} (${verdict.mode})\n\n`;
    md += `**${verdict.summary_line}**\n\n`;
    if (verdict.endpoints.length) {
      md += '| metric | p95 | threshold | delta | verdict |\n|---|---|---|---|---|\n';
      for (const e of verdict.endpoints) {
        md += `| ${e.metric} | ${e.p95_ms ?? '—'}ms | ${e.p95_red_ms}ms | ${e.delta_ms ?? '—'}ms | ${e.verdict}${e.reason ? ` (${e.reason})` : ''} |\n`;
      }
    }
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  }
}

// ---------- main ----------
function main() {
  const args = parseArgs(process.argv);
  const { verdict, src, mode } = compare(args);

  const outPath = args.out || 'verdict.json';
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(verdict, null, 2) + '\n');

  console.log(verdict.summary_line);
  console.log(`verdict.json -> ${outPath}`);
  emitGithub(verdict);

  if (mode === 'enforce') {
    if (verdict.overall_verdict === 'fail') process.exit(97);
    if (verdict.overall_verdict === 'red') process.exit(src.exitCodeOnRed);
  }
  process.exit(0);   // green, no-baseline, or report-only
}

try { main(); } catch (err) {
  console.error(`FAIL — compare-core error: ${err.message}`);
  process.exit(97);
}
