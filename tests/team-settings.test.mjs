// Per-team settings, over the real HTTP API against a temp repo root.
//
// The bug this locks down (issue #1): the wizard kept ONE config, so onboarding
// a second team silently overwrote the first team's target URL and test account.
// Every assertion here is about isolation between two teams.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4319;                       // not 4242 — never collide with a real dashboard
const B = `http://127.0.0.1:${PORT}`;
let proc, root;

const api = async (path, body) => {
  const res = await fetch(B + path, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  const json = await res.json();
  return { status: res.status, json };
};

before(async () => {
  // A throwaway repo root: the server writes .local/, .env and state/ into cwd,
  // and a test must never touch the real ones.
  root = await mkdtemp(join(tmpdir(), 'redline-settings-'));
  await mkdir(join(root, 'dashboard'), { recursive: true });
  await mkdir(join(root, 'state'), { recursive: true });
  for (const f of ['server.mjs', 'wizard.mjs', 'runs-lib.mjs', 'schedule-lib.mjs', 'mcp-server.mjs']) {
    await cp(join(REPO, 'dashboard', f), join(root, 'dashboard', f));
  }
  await cp(join(REPO, 'dashboard', 'public'), join(root, 'dashboard', 'public'), { recursive: true });
  for (const d of ['baselines', 'envs', 'workbench']) await mkdir(join(root, d), { recursive: true });
  await writeFile(join(root, 'state', 'run-ledger.jsonl'), '', 'utf8');

  proc = spawn(process.execPath, [join(root, 'dashboard', 'server.mjs'), '--no-open'],
    { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {                       // wait for listen
    try { if ((await fetch(B + '/api/state')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('settings test server did not start');
});

after(() => { proc?.kill(); });

test('a second team does not overwrite the first team\'s target', async () => {
  await api('/api/mode', { mode: 'onboard' });
  await api('/api/team', { team: 'alpha' });
  await api('/api/path', { path: 'api' });
  const a = await api('/api/describe', { url: 'https://alpha.example.com/api/health', env: 'stg' });
  assert.equal(a.status, 200);

  await api('/api/team', { team: 'beta' });
  await api('/api/path', { path: 'api' });
  await api('/api/describe', { url: 'https://beta.example.com/api/health', env: 'local' });

  // Back to alpha: its own URL and environment must come back, not beta's.
  const { json } = await api('/api/team', { team: 'alpha' });
  assert.equal(json.config.api.url, 'https://alpha.example.com/api/health');
  assert.equal(json.config.env, 'stg');
});

test('a team with no saved settings starts blank, not inheriting the last one', async () => {
  await api('/api/team', { team: 'alpha' });
  const { json } = await api('/api/team', { team: 'gamma' });
  assert.equal(json.config.api.url, '');
  assert.equal(json.config.env, '');
  assert.equal(json.config.path, '');
});

test('GET /api/settings lists every team with its own settings', async () => {
  const res = await fetch(B + '/api/settings');
  const { teams, locked } = await res.json();
  const byName = Object.fromEntries(teams.map((t) => [t.team, t]));
  assert.equal(byName.alpha.url, 'https://alpha.example.com/api/health');
  assert.equal(byName.beta.url, 'https://beta.example.com/api/health');
  assert.equal(byName.alpha.env, 'stg');
  assert.equal(byName.beta.env, 'local');
  // Hard rule 7 is reported as locked, never as an editable per-team field.
  assert.deepEqual(locked, { iterations: 10, vus: 1, executor: 'per-vu-iterations' });
});

test('POST /api/settings edits one team and leaves the others alone', async () => {
  const r = await api('/api/settings', { team: 'alpha', url: 'https://alpha-2.example.com/api/health', env: 'prod' });
  assert.equal(r.status, 200);
  const { teams } = await (await fetch(B + '/api/settings')).json();
  const byName = Object.fromEntries(teams.map((t) => [t.team, t]));
  assert.equal(byName.alpha.url, 'https://alpha-2.example.com/api/health');
  assert.equal(byName.alpha.env, 'prod');
  assert.equal(byName.beta.url, 'https://beta.example.com/api/health');   // untouched
});

test('POST /api/settings rejects a bad url, env, and team name', async () => {
  assert.equal((await api('/api/settings', { team: 'alpha', url: 'not-a-url' })).status, 400);
  assert.equal((await api('/api/settings', { team: 'alpha', env: 'staging' })).status, 400);
  assert.equal((await api('/api/settings', { team: 'Bad Name' })).status, 400);
});

test('credentials are saved per team under suffixed keys, and never in settings', async () => {
  await api('/api/settings', { team: 'alpha', loginRequired: true, username: 'alpha-user', password: 'alpha-pass' });
  await api('/api/settings', { team: 'beta', loginRequired: true, username: 'beta-user', password: 'beta-pass' });
  const env = await readFile(join(root, '.env'), 'utf8');
  assert.match(env, /^PERF_USERNAME_ALPHA=alpha-user$/m);
  assert.match(env, /^STAGING_PASSWORD_ALPHA=alpha-pass$/m);
  assert.match(env, /^PERF_USERNAME_BETA=beta-user$/m);   // beta did not clobber alpha
  assert.match(env, /^STAGING_PASSWORD_BETA=beta-pass$/m);

  const saved = JSON.parse(await readFile(join(root, 'state', 'team-settings.json'), 'utf8'));
  const asText = JSON.stringify(saved);
  assert.ok(!asText.includes('alpha-pass'), 'passwords must never reach team-settings.json');
  assert.ok(!asText.includes('beta-pass'), 'passwords must never reach team-settings.json');
  assert.equal(saved.alpha.login.credsSet, true);
});

test('a newline in credentials is rejected at the boundary', async () => {
  const r = await api('/api/settings', { team: 'alpha', username: 'u\nNODE_OPTIONS=--inspect', password: 'p' });
  assert.equal(r.status, 400);
  const env = await readFile(join(root, '.env'), 'utf8');
  assert.ok(!env.includes('NODE_OPTIONS'), 'injected env line must never be written');
});

test('team-settings.json is created under state/, beside the other per-team maps', () => {
  assert.ok(existsSync(join(root, 'state', 'team-settings.json')));
});
