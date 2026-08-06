// Regression tests for the product-review gate-hardening fixes:
//   - compare-core must FAIL CLOSED on a malformed/absent threshold (was green)
//   - compare-core error-rate red must not cite a false p95 delta
//   - func-verdict must not call an all-skipped suite green (was green)
// Both are CLI tools that process.exit, so we exercise them as subprocesses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const COMPARE = join(ROOT, '.github/actions/run-k6-action/compare-core.js');
const VERDICT = join(ROOT, '.github/skills/func-verdict/verdict.mjs');
const dir = mkdtempSync(join(tmpdir(), 'gate-'));
const w = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };

// runs compare-core; returns {code, verdict}
function compare(baseline, contract, mode = 'report-only') {
  const out = join(dir, `v-${Math.random().toString(36).slice(2)}.json`);
  let code = 0;
  try {
    execFileSync('node', [COMPARE, '--baseline', baseline, '--contract', contract, '--mode', mode, '--out', out], { stdio: 'pipe' });
  } catch (e) { code = e.status; }
  return { code, v: JSON.parse(readFileSync(out, 'utf8')) };
}

test('compare-core: metric with no usable threshold + high p95 fails CLOSED (red, exit 99 in enforce)', () => {
  const baseline = w('bad.json', { team: 't', profile: 'api-benchmark', env: 'stg', endpoints: [{ name: 'x', metric: 'http_req_duration' }] });
  const contract = w('huge.json', { endpoints: [{ name: 'x', metric: 'http_req_duration', p95: 99999 }], checks: { rate: 1 } });
  const { code, v } = compare(baseline, contract, 'enforce');
  assert.equal(v.overall_verdict, 'red', 'malformed threshold must not pass as green');
  assert.equal(code, 99, 'enforce mode must block on the red');
  assert.match(v.endpoints[0].reason, /no usable threshold/);
});

test('compare-core: well-formed baseline under threshold stays green (exit 0)', () => {
  const baseline = w('good.json', { team: 't', profile: 'api-benchmark', env: 'stg', endpoints: [{ name: 'cfg', metric: 'm', p95_red_ms: 1000 }] });
  const contract = w('ok.json', { endpoints: [{ name: 'cfg', metric: 'm', p95: 500 }], checks: { rate: 1 } });
  const { code, v } = compare(baseline, contract, 'enforce');
  assert.equal(v.overall_verdict, 'green');
  assert.equal(code, 0);
});

test('compare-core: error-rate red cites error_rate, not a bogus p95 delta', () => {
  const baseline = w('er-bl.json', { team: 't', profile: 'api-benchmark', env: 'stg', endpoints: [{ name: 'cfg', metric: 'm', p95_red_ms: 1000, error_rate_red: 0.01 }] });
  const contract = w('er-ct.json', { endpoints: [{ name: 'cfg', metric: 'm', p95: 500, error_rate: 0.25 }], checks: { rate: 0.75 } });
  const { v } = compare(baseline, contract);
  assert.equal(v.overall_verdict, 'red');
  assert.match(v.summary_line, /error_rate/);
  assert.doesNotMatch(v.summary_line, /threshold 1000ms/, 'must not present it as a p95 breach');
});

// func-verdict: <team> <out> as argv, exits 0 on success, 1 on malformed
function funcVerdict(contract) {
  const out = join(dir, `fv-${Math.random().toString(36).slice(2)}.json`);
  execFileSync('node', [VERDICT, contract, 'demoteam', out], { stdio: 'pipe' });
  return JSON.parse(readFileSync(out, 'utf8'));
}

test('func-verdict: all-skipped suite (0 passed, 0 failed) is RED, not green', () => {
  const c = w('skip.json', { run_id: 'x', tests_total: 12, passed: 0, failed: 0, failures: [] });
  const v = funcVerdict(c);
  assert.equal(v.overall_verdict, 'red', 'a run where nothing passed is not an all-clear');
  assert.match(v.summary_line, /skipped/);
});

test('func-verdict: all tests passed is GREEN', () => {
  const c = w('pass.json', { run_id: 'y', tests_total: 8, passed: 8, failed: 0, failures: [] });
  const v = funcVerdict(c);
  assert.equal(v.overall_verdict, 'green');
});
