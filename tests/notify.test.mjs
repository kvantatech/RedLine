// node tests/notify.test.mjs — assert-based self-check for the notify fan-out.
// Everything runs with --dry-run: no network calls, payloads printed instead.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'skills', 'notify-responsible-team', 'notify.mjs');
const dir = mkdtempSync(join(tmpdir(), 'notify-test-'));
const cfgPath = join(dir, 'team-channels.json');
writeFileSync(cfgPath, JSON.stringify({
  '_schema': 'v2',
  'legacy-team': { channel: '#old', webhook_env: 'HOOK_LEGACY' }, // v1 shape = implicit slack
  'multi-team': [
    { type: 'slack', channel: '#alerts', webhook_env: 'HOOK_SLACK' },
    { type: 'msteams', channel: 'Perf alerts', webhook_env: 'HOOK_TEAMS' },
    { type: 'pagerduty', routing_key_env: 'PD_KEY' },
    { type: 'opsgenie', api_key_env: 'OG_KEY', region: 'eu' },
    { type: 'carrier-pigeon' },
  ],
}));

const run = (extraArgs, env) => execFileSync(process.execPath, [
  SCRIPT, '--team', extraArgs.team, '--env', 'stg', '--jira-key', 'PERF-42',
  '--summary', 'GET /config p95 1450ms > red 1000ms', '--grafana-url', 'https://g/d/1',
  '--dry-run', '--config', cfgPath,
], { env: { ...process.env, ...env }, encoding: 'utf8' }).trim().split('\n');

// v1 single-object shape still works as slack
{
  const out = run({ team: 'legacy-team' }, { HOOK_LEGACY: 'https://hooks.example/x' });
  assert.equal(out.length, 1);
  assert.match(out[0], /^dry-run: slack #old — .*:red_circle:.*PERF-42/);
}

// v2 array: all four channel types compose; unknown type is skipped, not fatal
{
  const out = run({ team: 'multi-team' }, {
    HOOK_SLACK: 'https://hooks.example/s', HOOK_TEAMS: 'https://hooks.example/t',
    PD_KEY: 'pd-secret', OG_KEY: 'og-secret',
  });
  assert.equal(out.length, 5);
  assert.match(out[0], /^dry-run: slack #alerts/);
  assert.match(out[1], /^dry-run: msteams Perf alerts — .*\u{1F534}/u);
  assert.match(out[2], /^dry-run: pagerduty — /);
  const pd = JSON.parse(out[2].replace('dry-run: pagerduty — ', ''));
  assert.equal(pd.routing_key, 'pd-secret');
  assert.equal(pd.dedup_key, 'PERF-42');
  assert.equal(pd.payload.source, 'redline/multi-team/stg');
  assert.equal(pd.payload.severity, 'error');
  assert.match(out[3], /^dry-run: opsgenie — /);
  const og = JSON.parse(out[3].replace('dry-run: opsgenie — ', ''));
  assert.equal(og.alias, 'PERF-42');
  assert.ok(og.message.length <= 130);
  assert.match(out[4], /^skipped: unknown channel type "carrier-pigeon"/);
}

// missing secret env → per-channel skip with the manual fallback line
{
  const out = run({ team: 'multi-team' }, {});
  assert.match(out[0], /^skipped: slack webhook env HOOK_SLACK not set — notify manually:/);
  assert.match(out[2], /^skipped: pagerduty routing key env PD_KEY not set/);
}

// unmapped team → single skip, exit 0
{
  const out = run({ team: 'ghost-team' }, {});
  assert.deepEqual(out, ['skipped: no channel mapped for ghost-team']);
}

console.log('notify: all checks passed');
