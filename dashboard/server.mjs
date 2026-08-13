// RedLine onboarding wizard — zero-dependency local server.
//
//   node dashboard/server.mjs            → http://127.0.0.1:4242
//   node dashboard/server.mjs --no-open  → don't launch the browser
//
// Serves the wizard UI, persists answers to .local/dashboard-progress.json
// (gitignored), and — for the "Create the test" and "First results" stages —
// spawns Claude Code headlessly (`claude -p`) to author and benchmark the
// test, streaming its activity to the browser as server-sent events.
// Credentials, if provided, live only in the gitignored .env file.

import { createServer } from 'node:http';
import { spawn, exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, dirname, extname, normalize, sep, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stagesFor, profileFor, buildAuthorPrompt, buildBenchmarkPrompt, buildRunPrompt, buildFilePrompt, buildFuncAuthorPrompt, buildFuncRunPrompt, toolsFor } from './wizard.mjs';
import { parseLedger, filterRuns, mergeRuns, artifactSafePath, grafanaUrl } from './runs-lib.mjs';
import { envForUrl } from './public/env-detect.js';
import { validateSchedule, isDue, nextFire, dayKey } from './schedule-lib.mjs';

const ENVS = ['stg', 'prod', 'local']; // the environment codes the wizard accepts

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PUBLIC = join(HERE, 'public');
const PROGRESS_FILE = join(ROOT, '.local', 'dashboard-progress.json');
const ENV_FILE = join(ROOT, '.env');
const LEDGER_FILE = join(ROOT, 'state', 'run-ledger.jsonl');
const SCHEDULES_FILE = join(ROOT, 'state', 'schedules.json');
const TEAM_SETTINGS_FILE = join(ROOT, 'state', 'team-settings.json');
const TEAM_CHANNELS_FILE = join(ROOT, 'state', 'team-channels.json');
const HEAL_POLICY_FILE = join(ROOT, 'state', 'heal-policy.json');
const REMOTE_LEDGERS_FILE = join(ROOT, 'state', 'remote-ledgers.json');
const REPORTS_DIR = join(ROOT, 'reports');
const PORT = Number(process.env.PORT) || 4242;
const HOST = '127.0.0.1';
// Same-origin guard. Binding to 127.0.0.1 keeps the network out but not the
// browser: any site the operator visits can POST here with no preflight (JSON
// body + text/plain content-type = a CORS "simple request"), and DNS rebinding
// can point an attacker domain at 127.0.0.1. Browsers always send Origin on a
// cross-origin POST, so a mismatched Origin is rejected; Host pins the name the
// request arrived under, which also covers the GET/read side — a rebound
// request is same-origin to the browser and carries no Origin at all.
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((h) => `http://${h}`));
const CHECK_TTL_MS = 15_000;
const AGENT_TIMEOUT_MS = 20 * 60_000;
const healInFlight = new Set(); // run_ids with a graduation in progress (double-click/two-tab guard)

// ── config persistence ───────────────────────────────────────────────

// benchSkipped: the operator chose "Skip for now" on the first benchmark, so the
// wizard may finish without a baseline. A real baseline always takes precedence
// over the flag, so it can never mask or downgrade a red line that exists.
const EMPTY = { suite: '', mode: '', team: '', path: '', env: '', benchSkipped: false, api: { url: '' }, browser: { url: '', journey: '' }, login: { required: false, credsSet: false }, operate: { team: '', profile: '', pickedAt: '' }, func: { team: '', url: '', journey: '', login: { required: false } } };

async function loadConfig() {
  try {
    const raw = JSON.parse(await readFile(PROGRESS_FILE, 'utf8'));
    return { ...EMPTY, ...raw, api: { ...EMPTY.api, ...raw.api }, browser: { ...EMPTY.browser, ...raw.browser }, login: { ...EMPTY.login, ...raw.login }, operate: { ...EMPTY.operate, ...raw.operate }, func: { ...EMPTY.func, ...raw.func, login: { ...EMPTY.func.login, ...raw.func?.login } } };
  } catch {
    return structuredClone(EMPTY);
  }
}

async function saveConfig(cfg) {
  await mkdir(dirname(PROGRESS_FILE), { recursive: true });
  await writeFile(PROGRESS_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

// ── per-team settings ────────────────────────────────────────────────
// .local/dashboard-progress.json holds ONE wizard session — which team you are
// setting up right now. It is not a home for a team's durable settings: the
// second team you onboard would overwrite the first team's target URL. So the
// durable half lives here, keyed by team, alongside the other state/*.json
// per-team maps (team-channels, heal-policy, schedules).
//
// Shape: { "<team>": { url, env, path, login: { required, credsSet } } }
// Secrets are NEVER stored here — credsSet is a flag; the values live in the
// gitignored .env as PERF_USERNAME_<TEAM> / STAGING_PASSWORD_<TEAM>.
const TEAM_SETTING = { url: '', env: '', path: '', login: { required: false, credsSet: false } };

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
};

async function loadTeamSettings() {
  try {
    const raw = JSON.parse(await readFile(TEAM_SETTINGS_FILE, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

async function saveTeamSettings(all) {
  await mkdir(dirname(TEAM_SETTINGS_FILE), { recursive: true });
  await writeFile(TEAM_SETTINGS_FILE, JSON.stringify(all, null, 2) + '\n', 'utf8');
}

const teamSettingOf = (all, team) => {
  const s = (team && all[team]) || {};
  return { ...TEAM_SETTING, ...s, login: { ...TEAM_SETTING.login, ...s.login } };
};

// Mirror the active wizard session's answers into that team's durable settings.
async function persistTeamSetting(cfg) {
  if (!cfg.team) return;
  const all = await loadTeamSettings();
  all[cfg.team] = {
    ...teamSettingOf(all, cfg.team),
    url: cfg.path === 'browser' ? cfg.browser.url : cfg.api.url,
    env: cfg.env,
    path: cfg.path,
    login: { required: !!cfg.login.required, credsSet: !!cfg.login.credsSet },
  };
  await saveTeamSettings(all);
}

// Team name → env-var suffix: demo-web → DEMO_WEB. Scripts keep reading the
// unsuffixed PERF_USERNAME / STAGING_PASSWORD; startAgent maps the active
// team's suffixed pair onto those names, so a generated script never has to
// know which team it belongs to and existing scripts keep working unchanged.
const envSuffix = (team) => String(team || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');

// The credentials the agent should see for `team`: its own pair if set,
// otherwise the legacy unsuffixed pair (installs that predate per-team creds).
function credsForTeam(fileEnv, team) {
  const sfx = envSuffix(team);
  const user = fileEnv[`PERF_USERNAME_${sfx}`] ?? fileEnv.PERF_USERNAME;
  const pass = fileEnv[`STAGING_PASSWORD_${sfx}`] ?? fileEnv.STAGING_PASSWORD;
  const out = {};
  if (user !== undefined) out.PERF_USERNAME = user;
  if (pass !== undefined) out.STAGING_PASSWORD = pass;
  return out;
}

// ── helpers ──────────────────────────────────────────────────────────

function sh(cmd) {
  return new Promise((resolve) => {
    const opts = { cwd: ROOT, timeout: 10_000, windowsHide: true };
    if (process.platform === 'win32') opts.shell = 'cmd.exe';
    exec(cmd, opts, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || stderr || '').trim() }));
  });
}

// Reject whitespace/control chars in a URL before accepting it: new URL()
// silently strips a trailing newline + injected text, but we store the raw
// string and later embed it in the agent prompt, so treat it as not-a-URL.
const isHttpUrl = (u) => {
  if (typeof u !== 'string' || /\s/.test(u)
      || [...u].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return false;
  try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; }
};

async function parseEnvFile() {
  try {
    const raw = await readFile(ENV_FILE, 'utf8');
    const env = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2];
    }
    return env;
  } catch {
    return {};
  }
}

// Per-team credentials: each team gets its own suffixed pair so onboarding a
// second team cannot overwrite the first team's test account. Only this team's
// two keys are rewritten; every other line in .env is preserved verbatim.
async function writeCreds(username, password, team) {
  const sfx = envSuffix(team);
  const keys = sfx ? [`PERF_USERNAME_${sfx}`, `STAGING_PASSWORD_${sfx}`] : ['PERF_USERNAME', 'STAGING_PASSWORD'];
  const drop = new RegExp(`^\\s*(${keys.join('|')})\\s*=`);
  let lines = [];
  try {
    lines = (await readFile(ENV_FILE, 'utf8')).split('\n')
      .filter((l) => !drop.test(l) && l.trim() !== '');
  } catch {}
  lines.push(`${keys[0]}=${username}`, `${keys[1]}=${password}`);
  await writeFile(ENV_FILE, lines.join('\n') + '\n', 'utf8');
}

// ── prerequisite checks ──────────────────────────────────────────────

const checks = {
  async claude() {
    const r = await sh('claude --version');
    return r.ok
      ? { pass: true, detail: r.out.split('\n')[0].slice(0, 40) }
      : { pass: false, detail: 'Claude Code is not installed — get it at claude.com/claude-code' };
  },
  async k6() {
    const r = await sh('k6 version');
    if (!r.ok) return { pass: false, detail: 'k6 is not installed — grafana.com/docs/k6/latest/set-up/install-k6' };
    const m = r.out.match(/v?(\d+)\.(\d+)\.(\d+)/);
    return m && Number(m[1]) >= 2
      ? { pass: true, detail: `k6 v${m[1]}.${m[2]}.${m[3]}` }
      : { pass: false, detail: `k6 ${m ? 'v' + m.slice(1, 4).join('.') : '(unknown version)'} found — version 2.0 or newer is required` };
  },
  async submodules() {
    const ok = ['workbench', 'envs', 'baselines'].every((d) => existsSync(join(ROOT, d)));
    return { pass: ok, detail: ok ? 'workbench/, envs/, baselines/ — all present' : 'some project folders are missing — re-download or re-clone RedLine' };
  },
};

let checkCache = { at: 0, results: null };
let checkInFlight = null;

// The prerequisite checks shell out (`claude --version` alone costs ~1.7s), so a
// request that lands on an expired cache must never pay for them: it serves the
// stale result and lets the refresh finish in the background. Without this, one
// request per CHECK_TTL_MS window blocked for 1.5-3.5s — including the very first
// page load, which is a new user's first impression of the dashboard.
function refreshChecks() {
  if (checkInFlight) return checkInFlight;   // collapse concurrent refreshes into one
  checkInFlight = (async () => {
    const results = {};
    await Promise.all(Object.keys(checks).map(async (id) => { results[id] = await checks[id](); }));
    checkCache = { at: Date.now(), results };
    return results;
  })().finally(() => { checkInFlight = null; });
  return checkInFlight;
}

async function runChecks({ fresh = false } = {}) {
  // Explicit refresh (?fresh=1) means the user asked for current truth — await it.
  if (fresh) return refreshChecks();
  // Nothing cached yet (pre-warm still running): join it rather than spawning a second.
  if (!checkCache.results) return refreshChecks();
  // Stale: hand back what we have and revalidate behind the request.
  if (Date.now() - checkCache.at >= CHECK_TTL_MS) refreshChecks();
  return checkCache.results;
}

// ── the agent runner (headless Claude Code) ──────────────────────────

let job = null; // { kind, events, listeners:Set, proc, running, ok, summary }

function pushEvent(ev) {
  ev.id = job.events.length;
  job.events.push(ev);
  for (const res of job.listeners) {
    res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
  }
}

const rel = (p) => (p ? relative(ROOT, p).replaceAll('\\', '/') : '');

function describeTool(name, input = {}) {
  if (name === 'Write') return `Writing ${rel(input.file_path)}`;
  if (name === 'Edit' || name === 'MultiEdit') return `Editing ${rel(input.file_path)}`;
  if (name === 'Read') return `Reading ${rel(input.file_path)}`;
  if (name === 'Glob' || name === 'Grep') return `Searching the project`;
  if (name === 'TodoWrite') return 'Planning the work';
  if (name === 'Bash') return `Running: ${String(input.command || '').slice(0, 110)}`;
  if (name === 'mcp__k6__validate_script') return 'Validating the k6 script';
  if (name.startsWith('mcp__k6__')) return 'Consulting the k6 documentation';
  if (name === 'Task' || name === 'Agent') return 'Asking the independent reviewer for a second opinion';
  if (name.startsWith('mcp__jira__')) return 'Working in Jira';
  return name;
}

function handleStreamLine(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return; }
  if (obj.type === 'system' && obj.subtype === 'init') {
    pushEvent({ t: 'info', text: 'Agent is up and reading the project…' });
  } else if (obj.type === 'assistant') {
    for (const c of obj.message?.content || []) {
      if (c.type === 'text' && c.text?.trim()) pushEvent({ t: 'say', text: c.text.trim() });
      if (c.type === 'tool_use') pushEvent({ t: 'tool', text: describeTool(c.name, c.input) });
    }
  } else if (obj.type === 'result') {
    job.ok = obj.subtype === 'success' && /(?:AUTHOR|BENCH|RUN|FILE|FUNC_AUTHOR|FUNC_RUN)_RESULT: ok/.test(obj.result || '');
    const m = (obj.result || '').match(/(?:AUTHOR|BENCH|RUN|FILE|FUNC_AUTHOR|FUNC_RUN)_RESULT: (?:ok|failed) — (.*)/);
    job.summary = m ? m[1] : (obj.result || 'finished').slice(0, 300);
  }
}

async function startAgent(kind, cfg) {
  if (job?.running) throw new Error('the agent is already working — one task at a time');
  // Claim the slot synchronously, BEFORE any await below — otherwise two
  // concurrent /api/agent/start calls both pass the guard during an await gap
  // and both spawn (a double-click on "File" could file the same ticket twice).
  job = { kind, events: [], listeners: new Set(), proc: null, running: true, ok: false, summary: '' };

  let prompt, proc;
  try {
    if (kind === 'author') {
      await mkdir(join(ROOT, 'workbench', cfg.team, profileFor(cfg.path)), { recursive: true });
      prompt = buildAuthorPrompt(cfg);
    } else if (kind === 'benchmark') {
      prompt = buildBenchmarkPrompt(cfg);
    } else if (kind === 'run') {
      prompt = buildRunPrompt(cfg);
    } else if (kind === 'func-author') {
      await mkdir(join(ROOT, 'workbench', cfg.func.team, 'functional'), { recursive: true });
      prompt = buildFuncAuthorPrompt(cfg);
    } else if (kind === 'func-run') {
      prompt = buildFuncRunPrompt(cfg);
    } else if (kind === 'file') {
      const op = await readOperate(cfg);
      if (!op.fileable) throw new Error('the filing gates have not all passed');
      prompt = buildFilePrompt(cfg, op.latest.run_id);
    } else if (kind === 'file-override') {
      const op = await readOperate(cfg);
      if (!op.overrideable) throw new Error('an override is only possible for a corroborated red with a drafted ticket and a reviewer REJECT');
      prompt = buildFilePrompt(cfg, op.latest.run_id, true);
    } else {
      throw new Error(`unknown task: ${kind}`);
    }

    // Pinned: headless dashboard runs always use Sonnet (cheap, deterministic),
    // regardless of the operator's personal default model.
    const claudeArgs = ['-p', '--output-format', 'stream-json', '--verbose',
      '--model', 'claude-sonnet-4-6',
      '--permission-mode', 'acceptEdits', '--allowedTools', toolsFor(kind)];
    // The team this run belongs to decides which saved test account it sees:
    // credsForTeam maps PERF_USERNAME_<TEAM> onto the plain PERF_USERNAME the
    // scripts read, so one team's account never leaks into another's run.
    const fileEnv = await parseEnvFile();
    const runTeam = kind === 'func-author' || kind === 'func-run' ? cfg.func?.team
      : kind === 'run' || kind === 'file' || kind === 'file-override' ? cfg.operate?.team
      : cfg.team;
    const childEnv = { ...process.env, ...fileEnv, ...credsForTeam(fileEnv, runTeam) };
    proc = process.platform === 'win32'
      ? spawn('cmd', ['/c', 'claude', ...claudeArgs], { cwd: ROOT, env: childEnv, windowsHide: true })
      : spawn('claude', claudeArgs, { cwd: ROOT, env: childEnv });
  } catch (e) {
    job = null; // release the slot claimed above so a failed start doesn't wedge the dashboard
    throw e;
  }

  job.proc = proc; // attach to the slot claimed at entry (keeps any listeners added meanwhile)
  pushEvent({ t: 'info', text:
    kind === 'benchmark' ? 'Starting the first benchmark run…'
    : kind === 'func-author' ? 'Exploring your app live, then writing the functional test. It stops for your OK before finishing…'
    : kind === 'func-run' ? 'Running your functional test and judging the result — a moment…'
    : kind === 'run' ? 'Starting the run — about 10 careful rounds, then the judgment. A few minutes…'
    : kind === 'file' ? 'Filing the ticket and alerting the team…'
    : kind === 'file-override' ? 'Filing the ticket on your override and alerting the team…'
    : 'Starting the agent…' });

  proc.stdin.end(prompt);
  createInterface({ input: proc.stdout }).on('line', handleStreamLine);
  createInterface({ input: proc.stderr }).on('line', (l) => { if (l.trim()) pushEvent({ t: 'err', text: l.slice(0, 200) }); });

  const timeout = setTimeout(() => { pushEvent({ t: 'err', text: 'Timed out after 20 minutes — stopping.' }); killJob(); }, AGENT_TIMEOUT_MS);

  proc.on('close', (code) => {
    clearTimeout(timeout);
    job.running = false;
    if (code !== 0 && !job.summary) job.summary = `the agent exited unexpectedly (code ${code})`;
    pushEvent({ t: 'end', ok: job.ok, text: job.summary });
    for (const res of job.listeners) res.end();
    job.listeners.clear();
  });
}

function killJob() {
  if (!job?.proc) return;
  if (process.platform === 'win32') exec(`taskkill /pid ${job.proc.pid} /T /F`, () => {});
  else job.proc.kill('SIGTERM');
}

// ── remote ledgers — "one dashboard, many clusters", read-side ──────
// state/remote-ledgers.json: [{ "name": "eu-cluster", "url": "https://…/run-ledger.jsonl" }]
// url may also be a local/UNC path (network share). Feeds are merged into the
// READ views only (/api/runs) — operational gates (filing, operate, schedules)
// stay strictly local: their artifacts and approvals live on this machine.
// A dead remote degrades soft: its runs vanish, an error line is reported.

let remoteCache = { at: 0, sets: [], errors: [] };
const REMOTE_TTL_MS = 60_000;

async function remoteLedgerSets() {
  if (Date.now() - remoteCache.at < REMOTE_TTL_MS) return remoteCache;
  let cfg = [];
  try { cfg = JSON.parse(await readFile(REMOTE_LEDGERS_FILE, 'utf8')); } catch {}
  const sets = [], errors = [];
  await Promise.all((Array.isArray(cfg) ? cfg : []).filter((s) => s?.name && s?.url).map(async (s) => {
    try {
      const text = /^https?:\/\//.test(s.url)
        ? await (await fetch(s.url, { signal: AbortSignal.timeout(10_000) })).text()
        : await readFile(join(ROOT, s.url), 'utf8').catch(() => readFile(s.url, 'utf8'));
      sets.push({ name: String(s.name), runs: parseLedger(text).runs });
    } catch (e) {
      errors.push({ name: String(s.name), error: String(e.message || e) });
    }
  }));
  remoteCache = { at: Date.now(), sets, errors };
  return remoteCache;
}

// Local ledger + remote feeds, origin-tagged, deduped (local wins).
async function mergedRuns() {
  const text = await readFile(LEDGER_FILE, 'utf8').catch(() => '');
  const { runs, unreadable } = parseLedger(text);
  const { sets, errors } = await remoteLedgerSets();
  return { runs: mergeRuns(runs, sets), unreadable, remote_errors: errors };
}

// ── schedules — timed runs (performance tests only) ─────────────────
// Fires while the dashboard is running; a window the server was closed for
// is skipped for that day. Scheduled runs reuse the exact Run-test path
// (startAgent 'run') with a synthetic operate — the wizard's own picked
// state is never touched.

async function loadSchedules() {
  try {
    const a = JSON.parse(await readFile(SCHEDULES_FILE, 'utf8'));
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}

async function saveSchedules(list) {
  await mkdir(dirname(SCHEDULES_FILE), { recursive: true });
  await writeFile(SCHEDULES_FILE, JSON.stringify(list, null, 2) + '\n', 'utf8');
}

async function tickSchedules() {
  if (job?.running) return; // one agent at a time — due schedules retry next tick
  let list;
  try {
    list = await loadSchedules();
    const now = new Date();
    const due = list.find((s) => isDue(s, now));
    if (!due) return;
    if (!(await schedulable()).some((i) => i.team === due.team && i.profile === due.profile)) {
      due.enabled = false; // the test is gone — disable instead of retrying forever
      due.note = 'test not found — schedule disabled';
      await saveSchedules(list);
      return;
    }
    const cfg = await loadConfig();
    if (due.profile === 'functional') {
      // Target URL comes from the suite's own playwright.config.ts, never the
      // shared wizard slot (which may point at a different team's app).
      const url = await funcBaseUrl(due.team);
      if (!url) {
        due.enabled = false;
        due.note = 'suite has no baseURL — schedule disabled';
        await saveSchedules(list);
        return;
      }
      await startAgent('func-run', { ...cfg, trigger: 'scheduled', func: { team: due.team, url } });
    } else {
      await startAgent('run', { ...cfg, trigger: 'scheduled', operate: { team: due.team, profile: due.profile, pickedAt: now.toISOString() } });
    }
    due.lastFired = now.toISOString();
    due.lastFiredDay = dayKey(now);
    await saveSchedules(list);
  } catch (e) {
    console.error(`scheduler: ${e.message || e}`); // spawn race/failure — retry next tick
  }
}
const scheduleTimer = setInterval(tickSchedules, 30_000);
scheduleTimer.unref?.(); // never keep the process alive just for the timer

// True once a functional run for this team has been recorded in the ledger
// (schema v1.1 carries suite:"functional"; profile is "functional" too).
async function funcHasRun(team) {
  return !!(await funcLatest(team));
}

// Most recent functional-suite ledger record for this team (any status —
// done, failed, fail-before-run) so the UI can show the real verdict instead
// of a generic "check the log" message.
async function funcLatest(team) {
  try {
    const lines = (await readFile(join(ROOT, 'state', 'run-ledger.jsonl'), 'utf8')).split('\n');
    let latest = null;
    for (const l of lines) {
      if (!l.trim()) continue;
      let o; try { o = JSON.parse(l); } catch { continue; }
      if (o.team === team && (o.suite === 'functional' || o.profile === 'functional') && o.run_id) latest = o;
    }
    return latest;
  } catch {}
  return null;
}

// ── workflow 2 · the run ledger, test inventory, and gates ───────────

// Latest schema-v1 run per team|profile, with jira-filing lines applied.
async function ledgerEntries() {
  const latest = new Map();
  try {
    const lines = (await readFile(join(ROOT, 'state', 'run-ledger.jsonl'), 'utf8')).split('\n');
    const filings = [];
    for (const l of lines) {
      if (!l.trim()) continue;
      let o; try { o = JSON.parse(l); } catch { continue; }
      if (o.type === 'jira-filing') { filings.push(o); continue; }
      if (o.type === 'correction' || !o.run_id || !o.team || !o.profile) continue;
      latest.set(`${o.team}|${o.profile}`, o);
    }
    for (const e of latest.values()) {
      const f = filings.find((x) => x.run_id === e.run_id);
      if (f) { e.jira_filed = true; e.jira_key = f.jira_key || e.jira_key; }
    }
  } catch {}
  return latest;
}

// Every team·profile that has both a script and a red line — i.e. runnable.
async function inventory() {
  const led = await ledgerEntries();
  const combos = [];
  let files = [];
  try { files = await readdir(join(ROOT, 'baselines')); } catch {}
  for (const f of files) {
    const m = f.match(/^([a-z0-9-]+)\.([a-z0-9-]+)\.json$/);
    if (!m) continue;
    const [, team, profile] = m;
    const script = ['envs', 'workbench'].map((d) => join(ROOT, d, team, profile, 'script.js')).find((p) => existsSync(p));
    if (!script) continue;
    const last = led.get(`${team}|${profile}`) || null;
    combos.push({
      team, profile, script: rel(script),
      last: last ? { verdict: last.overall_verdict, at: last.recorded_at, summary: last.summary_line } : null,
    });
  }
  return combos;
}

// Functional suites that can be scheduled — any team with a runnable suite.
// The target URL comes from the suite's OWN playwright.config.ts (baseURL),
// never the shared wizard slot, which may hold a different team's app.
async function funcInventory() {
  const teams = new Set();
  for (const tier of ['envs', 'workbench']) {
    let dirs = [];
    try { dirs = await readdir(join(ROOT, tier)); } catch {}
    for (const t of dirs) {
      if (existsSync(join(ROOT, tier, t, 'functional', 'playwright.config.ts'))) teams.add(t);
    }
  }
  return [...teams].sort().map((team) => ({ team, profile: 'functional' }));
}

async function funcBaseUrl(team) {
  const cfgPath = ['envs', 'workbench']
    .map((d) => join(ROOT, d, team, 'functional', 'playwright.config.ts'))
    .find((p) => existsSync(p));
  if (!cfgPath) return null;
  try {
    // Quote-PAIRED alternation — an unpaired class ([`'"]...[`'"]) would let a
    // template literal close on an inner quote and capture JS source instead
    // of a URL. Interpolated baseURLs ($) can't be resolved statically → null;
    // new URL() rejects any other non-URL garbage.
    const m = (await readFile(cfgPath, 'utf8')).match(/baseURL:\s*(?:'([^'\n]+)'|"([^"\n]+)"|`([^`\n]+)`)/);
    const raw = m && (m[1] ?? m[2] ?? m[3]);
    if (!raw || raw.includes('$')) return null;
    try { new URL(raw); return raw; } catch { return null; }
  } catch { return null; }
}

// Everything the scheduler may run: perf tests (script + baseline) and
// functional suites (config with a baseURL of their own).
async function schedulable() {
  const [perf, func] = await Promise.all([inventory(), funcInventory()]);
  return [...perf.map((i) => ({ team: i.team, profile: i.profile })), ...func];
}

// The workflow steps of a functional suite — the test() cases across its spec
// files, read straight from the suite the run executes. Perf steps come from
// the run's endpoints[] instead (already in the ledger). team/profile are
// slug-validated so they can never escape the suite directory.
async function testSteps(team, profile) {
  const slug = /^[a-z0-9][a-z0-9-]{0,40}$/;
  if (!slug.test(team) || profile !== 'functional') return [];
  const dir = ['envs', 'workbench']
    .map((d) => join(ROOT, d, team, 'functional', 'tests'))
    .find((p) => existsSync(p));
  if (!dir) return [];
  const out = [];
  let names = [];
  try { names = await readdir(dir); } catch { return []; }
  for (const f of names.filter((n) => /\.spec\.(ts|js|mjs)$/.test(n))) {
    let text;
    try { text = await readFile(join(dir, f), 'utf8'); } catch { continue; }
    // test('name', …) / test("name", …) / test(`name`, …) — skip test.describe/step.
    for (const m of text.matchAll(/\btest\s*\(\s*(['"`])([^'"`\n]{1,160})\1/g)) {
      out.push({ name: m[2], file: f });
    }
  }
  return out;
}

async function readOperate(cfg) {
  const { team = '', profile = '' } = cfg.operate || {};
  if (!team || !profile) return { picked: false };
  const latest = (await ledgerEntries()).get(`${team}|${profile}`) || null;
  let draft = null;
  if (latest?.run_id) {
    try {
      let raw = await readFile(join(ROOT, 'reports', latest.run_id, 'jira-draft.md'), 'utf8');
      // Inject the real tested URL from config so the ticket is human-readable
      const testedUrl = cfg.api?.url || cfg.browser?.url || '';
      if (testedUrl && !/https?:\/\//.test(raw.split('\n').find((l) => /URL|Endpoint.*http/i.test(l)) || '')) {
        raw = raw.replace(/(h3\. Failing endpoints[\s\S]*?\n)/, `$1Tested URL: ${testedUrl}\n`);
      }
      draft = raw;
    } catch {}
  }
  const gates = latest ? {
    red: latest.overall_verdict === 'red',
    sources: latest.sources ?? 0,
    reviewer: latest.reviewer_decision || null,
    filed: !!latest.jira_filed,
    jiraKey: latest.jira_key || null,
    draftReady: !!draft,
  } : null;
  // Hard rule 1: filing unlocks only with red + 2 sources + reviewer sign-off,
  // never twice for the same run. The headless agent re-verifies all gates too.
  const fileable = !!(gates && gates.red && gates.sources >= 2 && gates.reviewer === 'SIGN_OFF' && !gates.filed && gates.draftReady);
  // Human-override path: a reviewer REJECT may be overruled per-draft by an explicit
  // human confirmation in the dashboard. Only the reviewer gate is relaxed — corroboration,
  // draft, and de-dupe still hold, and the override is recorded in ticket + ledger.
  const overrideable = !!(gates && gates.red && gates.sources >= 2 && gates.reviewer === 'REJECT' && !gates.filed && gates.draftReady);
  // A run only counts for THIS pick if it happened after the pick — otherwise
  // old ledger entries pre-check the Run/Verdict stages on first load.
  const current = !!(latest && cfg.operate.pickedAt
    && Date.parse(latest.recorded_at || 0) >= Date.parse(cfg.operate.pickedAt));
  return { picked: true, team, profile, latest, draft, gates, fileable, overrideable, current };
}

// ── state assembly ───────────────────────────────────────────────────

const scriptPath = (cfg) => join(ROOT, 'workbench', cfg.team, profileFor(cfg.path), 'script.js');
const baselinePath = (cfg) => join(ROOT, 'baselines', `${cfg.team}.${profileFor(cfg.path)}.json`);

async function readResults(cfg) {
  if (!cfg.team || !cfg.path) return null;
  try {
    const b = JSON.parse(await readFile(baselinePath(cfg), 'utf8'));
    return { profile: b.profile, updated: b.updated, source: b.source, endpoints: b.endpoints || [], file: rel(baselinePath(cfg)) };
  } catch {
    return null;
  }
}

// Recursive file listing of reports/<run_id>/ — [{path (posix, rel to run dir), size}].
async function listArtifacts(runId) {
  const dir = join(REPORTS_DIR, runId);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const full = join(e.parentPath, e.name);
    out.push({ path: relative(dir, full).replaceAll('\\', '/'), size: (await stat(full)).size });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function describeDone(cfg) {
  if (cfg.path === 'api') return isHttpUrl(cfg.api.url);
  if (cfg.path === 'browser') return isHttpUrl(cfg.browser.url) && cfg.browser.journey.trim().length >= 10;
  return false;
}

async function buildState({ fresh = false } = {}) {
  const cfg = await loadConfig();
  const checkResults = await runChecks({ fresh });
  const ready = Object.values(checkResults).every((c) => c.pass);
  const created = !!cfg.team && !!cfg.path && existsSync(scriptPath(cfg));
  const results = await readResults(cfg);
  const inv = await inventory();
  const op = await readOperate(cfg);

  const v = op.latest?.overall_verdict;
  const flake = v === 'red' && (op.latest?.sources ?? 0) < 2;
  const outcomeDone = !!op.current && (v === 'green' || flake || !!op.gates?.filed || op.gates?.reviewer === 'REJECT');

  const fteam = cfg.func?.team;
  const funcDescribeDone = !!(fteam && cfg.func.url && cfg.func.journey);
  // "Create the test" unlocks "First results" once a suite exists anywhere runnable —
  // envs/ (committed) or workbench/ (freshly authored, not yet committed). Both are
  // real, runnable suites; run-playwright-suite accepts either. "Graduating" to envs/
  // only matters for putting a script under source control — never for running it.
  const funcSuite = (t) => !!t && (existsSync(join(ROOT, 'envs', t, 'functional', 'playwright.config.ts'))
    || existsSync(join(ROOT, 'workbench', t, 'functional', 'playwright.config.ts')));

  const funcLatestRecord = fteam ? await funcLatest(fteam) : null;

  const doneById = {
    start: !!cfg.suite,
    'func-intro': true,        // informational landing — always advanceable
    'func-describe': funcDescribeDone,
    'func-create': funcSuite(fteam),
    'func-results': !!funcLatestRecord,
    ready,
    team: !!cfg.team,
    path: !!cfg.path,
    describe: describeDone(cfg),
    create: created,
    // A real baseline always wins; "Skip for now" only unblocks the last two
    // stages so a first-time user can leave the wizard without paying for a
    // 10-iteration run. The test stays out of Run & Judge until a baseline
    // exists — compare-to-baseline has nothing to judge against without one.
    benchmark: !!results || (created && cfg.benchSkipped),
    done: !!results || (created && cfg.benchSkipped),
    pick: !!(op.picked && inv.some((i) => i.team === op.team && i.profile === op.profile)),
    run: !!op.current,
    outcome: outcomeDone,
  };

  return {
    config: cfg,
    checks: checkResults,
    stages: stagesFor(cfg.suite, cfg.mode).map((s) => ({ ...s, done: !!doneById[s.id] })),
    results,
    inventory: inv,
    operate: op,
    funcRun: { latest: funcLatestRecord },
    agent: job ? { kind: job.kind, running: job.running, ok: job.ok, summary: job.summary, events: job.events.length } : null,
  };
}

// ── http plumbing ────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8', '.jsonl': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webm': 'video/webm',
  '.zip': 'application/zip',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 64_000) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

const server = createServer(async (req, res) => {
  // Checked before anything is parsed — new URL() below trusts the Host header.
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) return send(res, 403, { error: 'forbidden' });
  if (req.headers.origin && !ALLOWED_ORIGINS.has(req.headers.origin)) {
    return send(res, 403, { error: 'forbidden' });
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/state' && req.method === 'GET') {
      return send(res, 200, await buildState({ fresh: url.searchParams.has('fresh') }));
    }

    if (url.pathname === '/api/suite' && req.method === 'POST') {
      const { suite } = await readBody(req);
      if (!['functional', 'performance', ''].includes(suite)) return send(res, 400, { error: 'unknown choice' });
      const cfg = await loadConfig();
      cfg.suite = suite;
      // Create test authors a new test → performance defaults to 'onboard'.
      // Running an existing test is the separate #run entry (sets mode='operate').
      cfg.mode = suite === 'performance' ? 'onboard' : '';
      await saveConfig(cfg);
      return send(res, 200, await buildState());
    }

    if (url.pathname === '/api/mode' && req.method === 'POST') {
      const { mode } = await readBody(req);
      if (!['onboard', 'operate', ''].includes(mode)) return send(res, 400, { error: 'unknown choice' });
      const cfg = await loadConfig();
      cfg.mode = mode;
      if (mode) cfg.suite = 'performance'; // mode only exists under the performance path
      await saveConfig(cfg);
      return send(res, 200, await buildState());
    }

    if (url.pathname === '/api/pick' && req.method === 'POST') {
      const { team, profile } = await readBody(req);
      const inv = await inventory();
      if (!inv.some((i) => i.team === team && i.profile === profile)) {
        return send(res, 400, { error: 'that test does not exist yet — set it up first' });
      }
      const cfg = await loadConfig();
      cfg.operate = { team, profile, pickedAt: new Date().toISOString() };
      await saveConfig(cfg);
      return send(res, 200, await buildState());
    }

    if (url.pathname === '/api/team' && req.method === 'POST') {
      const team = String((await readBody(req)).team || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(team)) {
        return send(res, 400, { error: 'use letters, numbers and dashes — e.g. demo-web' });
      }
      const cfg = await loadConfig();
      cfg.team = team;
      // Switching teams loads THAT team's saved settings into the session, so
      // the wizard never shows the previous team's target URL. A team with no
      // saved settings yet starts blank rather than inheriting a stranger's.
      const s = teamSettingOf(await loadTeamSettings(), team);
      cfg.path = s.path || '';
      cfg.env = s.env || '';
      cfg.api.url = s.path === 'api' ? s.url : '';
      cfg.browser.url = s.path === 'browser' ? s.url : '';
      if (s.path !== 'browser') cfg.browser.journey = '';
      cfg.login = { required: !!s.login.required, credsSet: !!s.login.credsSet };
      cfg.benchSkipped = false;
      await saveConfig(cfg);
      return send(res, 200, await buildState());
    }

    // ── settings ─────────────────────────────────────────────────────
    // Every team the install knows about, with the settings that are actually
    // editable here (target URL, environment, sign-in) plus the ones that live
    // in their own files and are shown read-only (alert channels, heal policy).
    if (url.pathname === '/api/settings' && req.method === 'GET') {
      const [settings, perf, func, channels, heal] = await Promise.all([
        loadTeamSettings(), inventory(), funcInventory(),
        readJson(TEAM_CHANNELS_FILE, {}), readJson(HEAL_POLICY_FILE, {}),
      ]);
      const names = new Set([...Object.keys(settings), ...perf.map((i) => i.team), ...func.map((i) => i.team)]);
      for (const k of Object.keys(channels)) if (!k.startsWith('_')) names.add(k);
      const teams = [...names].sort().map((team) => {
        const s = teamSettingOf(settings, team);
        const ch = channels[team];
        return {
          team,
          url: s.url, env: s.env, path: s.path, login: s.login,
          profiles: perf.filter((i) => i.team === team).map((i) => i.profile),
          functional: func.some((i) => i.team === team),
          channels: !ch ? [] : (Array.isArray(ch) ? ch : [ch]).map((c) => ({
            type: c.type || 'slack', channel: c.channel || '', secret_env: c.webhook_env || c.routing_key_env || c.api_key_env || '',
          })),
          heal: heal[team]?.policy || heal[team] || null,
        };
      });
      // Fixed by CLAUDE.md hard rule 7 — surfaced so the page can explain why
      // iteration/VU count is shown but not editable.
      return send(res, 200, { teams, locked: { iterations: 10, vus: 1, executor: 'per-vu-iterations' } });
    }

    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const body = await readBody(req);
      const team = String(body.team || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(team)) return send(res, 400, { error: 'use letters, numbers and dashes — e.g. demo-web' });
      const all = await loadTeamSettings();
      const cur = teamSettingOf(all, team);
      const next = { ...cur };
      if (body.url !== undefined) {
        const u = String(body.url).trim();
        if (u && !isHttpUrl(u)) return send(res, 400, { error: 'that does not look like a web address — it should start with https://' });
        next.url = u;
      }
      if (body.env !== undefined) {
        if (!ENVS.includes(body.env)) return send(res, 400, { error: `environment must be one of ${ENVS.join(', ')}` });
        next.env = body.env;
      }
      if (body.path !== undefined) {
        if (!['api', 'browser', ''].includes(body.path)) return send(res, 400, { error: 'test type must be api or browser' });
        next.path = body.path;
      }
      if (body.loginRequired !== undefined) next.login = { ...next.login, required: !!body.loginRequired };
      if (body.username && body.password) {
        const user = String(body.username), pass = String(body.password);
        // Same trust boundary as /api/describe: a newline would inject extra
        // KEY=VALUE lines into .env and thus into the agent's process env.
        if (/[\r\n]/.test(user + pass)) return send(res, 400, { error: 'the username and password cannot contain line breaks' });
        await writeCreds(user, pass, team);
        next.login = { ...next.login, credsSet: true };
      }
      all[team] = next;
      await saveTeamSettings(all);
      // Keep the live wizard session in step when it is editing this same team.
      const cfg = await loadConfig();
      if (cfg.team === team) {
        cfg.env = next.env; cfg.path = next.path;
        if (next.path === 'api') cfg.api.url = next.url; else if (next.path === 'browser') cfg.browser.url = next.url;
        cfg.login = { required: !!next.login.required, credsSet: !!next.login.credsSet };
        await saveConfig(cfg);
      }
      return send(res, 200, { ok: true, team, settings: next });
    }

    // "Skip for now" on the first benchmark — lets a first-time user finish the
    // wizard without a 10-iteration run (and its model/API spend). Only valid
    // once the script itself exists; there is nothing to defer before that.
    if (url.pathname === '/api/skip-benchmark' && req.method === 'POST') {
      const cfg = await loadConfig();
      if (!(cfg.team && cfg.path && existsSync(scriptPath(cfg)))) {
        return send(res, 400, { error: 'create the test first' });
      }
      cfg.benchSkipped = true;
      await saveConfig(cfg);
      return send(res, 200, await buildState());
    }

    if (url.pathname === '/api/path' && req.method === 'POST') {
      const { path } = await readBody(req);
      if (!['api', 'browser'].includes(path)) return send(res, 400, { error: 'pick api or browser' });
      const cfg = await loadConfig();
      cfg.path = path;
      await saveConfig(cfg);
      return send(res, 200, await buildState());
    }

    if (url.pathname === '/api/describe' && req.method === 'POST') {
      const body = await readBody(req);
      const cfg = await loadConfig();
      if (!cfg.path) return send(res, 400, { error: 'pick a test type first' });
      const u = String(body.url || '').trim();
      if (!isHttpUrl(u)) return send(res, 400, { error: 'that does not look like a web address — it should start with https://' });
      if (cfg.path === 'api') cfg.api.url = u;
      else {
        cfg.browser.url = u;
        cfg.browser.journey = String(body.journey || '').trim();
        if (cfg.browser.journey.length < 10) return send(res, 400, { error: 'describe the journey in a sentence or two — what should the user do?' });
      }
      // Environment: honor an explicit user choice, else auto-detect from the URL.
      cfg.env = ENVS.includes(body.env) ? body.env : envForUrl(u);
      cfg.login.required = !!body.loginRequired;
      if (cfg.login.required && body.username && body.password) {
        const user = String(body.username), pass = String(body.password);
        // .env is KEY=VALUE per line and is spread into the agent's process env
        // (startAgent) — a newline here would define arbitrary extra variables
        // for that child (NODE_OPTIONS, PATH, …). Reject at the boundary.
        if (/[\r\n]/.test(user + pass)) {
          return send(res, 400, { error: 'the username and password cannot contain line breaks' });
        }
        await writeCreds(user, pass, cfg.team);
        cfg.login.credsSet = true;
      }
      await saveConfig(cfg);
      await persistTeamSetting(cfg);   // durable half — survives onboarding another team
      return send(res, 200, await buildState());
    }

    if (url.pathname === '/api/func' && req.method === 'POST') {
      const body = await readBody(req);
      const cfg = await loadConfig();
      const team = String(body.team || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(team)) return send(res, 400, { error: 'use letters, numbers and dashes — e.g. demo-web' });
      const u = String(body.url || '').trim();
      if (!isHttpUrl(u)) return send(res, 400, { error: 'that does not look like a web address — it should start with https://' });
      const journey = String(body.journey || '').trim();
      if (journey.length < 10) return send(res, 400, { error: 'describe the journey in a sentence or two — what should the user do?' });
      cfg.func = { team, url: u, journey, login: { required: !!body.loginRequired } };
      await saveConfig(cfg);
      return send(res, 200, await buildState());
    }

    if (url.pathname === '/api/agent/start' && req.method === 'POST') {
      const { kind } = await readBody(req);
      if (!['author', 'benchmark', 'run', 'file', 'file-override', 'func-author', 'func-run'].includes(kind)) return send(res, 400, { error: 'unknown task' });
      const cfg = await loadConfig();
      const state = await buildState();
      const dok = Object.fromEntries(state.stages.map((s) => [s.id, s.done]));
      if (kind === 'author' && !(dok.team && dok.path && dok.describe)) return send(res, 400, { error: 'finish the earlier steps first' });
      if (kind === 'benchmark' && !dok.create) return send(res, 400, { error: 'create the test first' });
      if (kind === 'func-author' && !dok['func-describe']) return send(res, 400, { error: 'describe the flow first' });
      if (kind === 'func-run' && !dok['func-create']) return send(res, 400, { error: 'create the test first' });
      if (kind === 'run' && !dok.pick) return send(res, 400, { error: 'pick a test first' });
      if (kind === 'file' && !state.operate?.fileable) return send(res, 400, { error: 'the filing gates have not all passed' });
      if (kind === 'file-override' && !state.operate?.overrideable) return send(res, 400, { error: 'an override is only possible for a corroborated red with a drafted ticket and a reviewer REJECT' });
      await startAgent(kind, cfg);
      return send(res, 200, { started: true });
    }

    // Direct run of a known test by name — the scheduler's path over HTTP.
    // Used by the RedLine MCP server (dashboard/mcp-server.mjs); a synthetic
    // operate keeps the wizard's own picked state untouched.
    if (url.pathname === '/api/agent/run' && req.method === 'POST') {
      const { team, profile } = await readBody(req);
      if (!(await inventory()).some((i) => i.team === team && i.profile === profile)) {
        return send(res, 400, { error: 'that test does not exist yet — create it first' });
      }
      const cfg = await loadConfig();
      await startAgent('run', { ...cfg, operate: { team, profile, pickedAt: new Date().toISOString() } });
      return send(res, 200, { started: true, team, profile });
    }

    if (url.pathname === '/api/agent/stream' && req.method === 'GET') {
      if (!job) return send(res, 404, { error: 'nothing running' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      const after = Number(url.searchParams.get('after') ?? -1);
      for (const ev of job.events) if (ev.id > after) res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
      if (!job.running) return res.end();
      job.listeners.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => { clearInterval(ping); job?.listeners.delete(res); });
      return;
    }

    if (url.pathname === '/api/agent/cancel' && req.method === 'POST') {
      killJob();
      return send(res, 200, { ok: true });
    }

    // ── heal graduation — the ONE human click that finishes a self-heal ──
    // The target audience is non-technical: nobody here can open a terminal
    // and run `git commit`. So this explicit, human-clicked action does the
    // WHOLE job — copy (ask policy only; trust already copied at run time)
    // AND commit, scoped to only the healed suite's files. This is not the
    // unattended agent committing on its own (still forbidden) — it is the
    // dashboard executing the one explicit thing a human just clicked.
    // Local runs only: remote-ledger runs are visibility, never actionable.
    if (url.pathname === '/api/heal/graduate' && req.method === 'POST') {
      const { run_id } = await readBody(req);
      // Per-run lock: two near-simultaneous clicks (two tabs, reload mid-commit)
      // must not both run the git sequence — the loser would record a
      // committed:false line that demotes the winner's committed:true in the view.
      if (healInFlight.has(run_id)) return send(res, 409, { error: 'already being saved — refresh in a moment' });
      healInFlight.add(run_id);
      try {
      const ledgerText = await readFile(LEDGER_FILE, 'utf8').catch(() => '');
      const { runs } = parseLedger(ledgerText); // LOCAL ledger only, by design
      const run = runs.find((r) => r.run_id === run_id);
      if (!run) return send(res, 404, { error: 'no such local run' });
      if (!run.heal || !/^(HEALED|PARTIAL)(_AUTO)?$/.test(run.heal.outcome || '')) {
        return send(res, 400, { error: 'this run has no heal proposal awaiting approval' });
      }
      if (run.heal.graduated && run.heal.committed) return send(res, 409, { error: 'already saved' });
      const slug = /^[a-z0-9][a-z0-9-]{0,40}$/;
      if (!slug.test(run.team || '')) return send(res, 400, { error: 'bad team slug' });
      const auto = /_AUTO$/.test(run.heal.outcome);
      const relDst = join('envs', run.team, 'functional');
      const dst = join(ROOT, relDst);
      const src = join(ROOT, 'workbench', run.team, 'functional-heal');
      const { cp, rm, appendFile } = await import('node:fs/promises');

      if (!auto && !run.heal.graduated) {
        // ask policy, first click: the copy hasn't happened yet — this click
        // authorizes it. (auto, or already-graduated-but-not-committed —
        // e.g. approved before this commit step existed — skip straight to
        // the commit below; the files are already correct in envs/.)
        if (existsSync(join(src, 'playwright.config.ts'))) {
          await cp(src, dst, { recursive: true, force: true });
          // The workbench copy is removed only AFTER the commit succeeds —
          // deleting it first would wedge the retry path if git fails.
        } else {
          // Workbench copy gone. If envs/ still holds uncommitted heal changes
          // (a previous click copied then failed at git), retry just the commit;
          // only 410 when there is genuinely nothing left to save.
          const { stdout } = await execFileP('git', ['status', '--porcelain', '--', relDst], { cwd: ROOT });
          if (!stdout.trim()) {
            return send(res, 410, { error: 'the proposed fix is no longer available — ask a developer to check reports/…/heal/suite.diff' });
          }
        }
      }
      // trust policy: files were already copied into envs/ when the run
      // finished (unattended) — this click is the first human review, and
      // what's left to do is make it permanent.

      let committed = false, sha = null;
      try {
        const { stdout: statusOut } = await execFileP('git', ['status', '--porcelain', '--', relDst], { cwd: ROOT });
        if (statusOut.trim()) {
          await execFileP('git', ['add', '--', relDst], { cwd: ROOT });
          const plain = (run.heal.plain || 'A production test was self-repaired.').replace(/\s+/g, ' ').trim();
          const message = `test(${run.team}): self-heal functional suite\n\n${plain}\n\nRun: ${run_id}\nApproved via RedLine dashboard.`;
          // Pathspec on commit = --only mode: unrelated files someone left
          // staged in the index stay out of this commit (and stay staged).
          await execFileP('git', ['commit', '-m', message, '--', relDst], { cwd: ROOT });
          const { stdout: shaOut } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: ROOT });
          committed = true; sha = shaOut.trim();
        } // else: nothing to commit (already committed, or reverted by hand) — still record approval below
      } catch (e) {
        return send(res, 500, { error: `Saved the fix to the file, but couldn't record it in git: ${String(e.message || e).slice(0, 200)}. Ask a developer to check the repo.` });
      }

      // Commit succeeded (or nothing needed committing) — now the workbench
      // duplicate is safe to drop. force:true → no-op when already gone.
      await rm(src, { recursive: true, force: true }).catch(() => {});
      await appendFile(LEDGER_FILE, JSON.stringify({
        type: 'heal-graduation', run_id, graduated_at: new Date().toISOString(), committed, sha,
      }) + '\n');
      return send(res, 200, { ok: true, committed, sha });
      } finally { healInFlight.delete(run_id); }
    }

    // ── results (runs) view — read-only over the ledger + reports/,
    //    merged with any configured remote ledgers (read-side multi-cluster) ──
    if (url.pathname === '/api/runs' && req.method === 'GET') {
      const { runs, unreadable, remote_errors } = await mergedRuns();
      const filtered = filterRuns(runs, {
        team: url.searchParams.get('team') || '',
        suite: url.searchParams.get('suite') || '',
        verdict: url.searchParams.get('verdict') || '',
        limit: url.searchParams.get('limit') || '',
      });
      for (const r of filtered) r.has_report_dir = existsSync(join(REPORTS_DIR, r.run_id));
      return send(res, 200, { runs: filtered, unreadable, remote_errors });
    }

    // ── schedules — timed runs CRUD ─────────────────────────────────
    if (url.pathname === '/api/schedules' && req.method === 'GET') {
      const [list, tests] = await Promise.all([loadSchedules(), schedulable()]);
      return send(res, 200, {
        schedules: list.map((s) => ({
          ...s,
          exists: tests.some((i) => i.team === s.team && i.profile === s.profile),
          next: nextFire(s),
          due: isDue(s),
        })),
        // schedulable tests — perf (script + baseline) AND functional suites
        // (their target URL comes from each suite's own playwright.config.ts)
        tests,
      });
    }

    if (url.pathname === '/api/schedules' && req.method === 'POST') {
      const v = validateSchedule(await readBody(req));
      if (v.error) return send(res, 400, { error: v.error });
      const tests = await schedulable();
      if (!tests.some((i) => i.team === v.schedule.team && i.profile === v.schedule.profile)) {
        return send(res, 400, { error: 'that test does not exist yet — create it first' });
      }
      // Knowable-now failures fail NOW, not silently at first fire: a
      // functional suite whose config has no static baseURL can't be scheduled.
      if (v.schedule.profile === 'functional' && !(await funcBaseUrl(v.schedule.team))) {
        return send(res, 400, { error: 'that suite has no fixed web address (baseURL) in its config — add one before scheduling' });
      }
      const list = await loadSchedules();
      if (list.some((s) => s.id === v.schedule.id)) return send(res, 400, { error: 'that schedule already exists' });
      list.push(v.schedule);
      await saveSchedules(list);
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/schedules/toggle' && req.method === 'POST') {
      const { id } = await readBody(req);
      const list = await loadSchedules();
      const s = list.find((x) => x.id === id);
      if (!s) return send(res, 404, { error: 'no such schedule' });
      s.enabled = !s.enabled;
      delete s.note; // re-enabling clears the "test not found" flag; next tick re-checks
      await saveSchedules(list);
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/schedules/delete' && req.method === 'POST') {
      const { id } = await readBody(req);
      const list = await loadSchedules();
      if (!list.some((x) => x.id === id)) return send(res, 404, { error: 'no such schedule' });
      await saveSchedules(list.filter((x) => x.id !== id));
      return send(res, 200, { ok: true });
    }

    // ── a functional test's workflow steps (its spec test() cases) ──
    if (url.pathname === '/api/test-steps' && req.method === 'GET') {
      const steps = await testSteps(url.searchParams.get('team') || '', url.searchParams.get('profile') || '');
      return send(res, 200, { steps });
    }

    if (url.pathname.startsWith('/api/runs/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/runs/'.length));
      const run = (await mergedRuns()).runs.find((r) => r.run_id === id);
      if (!run) return send(res, 404, { error: 'no such run' });
      run.has_report_dir = existsSync(join(REPORTS_DIR, id));
      const env = await parseEnvFile();
      return send(res, 200, {
        run,
        artifacts: await listArtifacts(id),
        grafana_url: grafanaUrl(run, process.env.GRAFANA_BASE_URL || env.GRAFANA_BASE_URL || ''),
      });
    }

    if (url.pathname.startsWith('/reports/') && req.method === 'GET') {
      const parts = url.pathname.slice('/reports/'.length).split('/').map(decodeURIComponent);
      const file = artifactSafePath(REPORTS_DIR, parts[0], parts.slice(1).join('/'));
      if (!file) return send(res, 403, { error: 'forbidden' });
      try {
        const body = await readFile(file);
        const ext = extname(file).toLowerCase();
        const headers = { 'content-type': MIME[ext] || 'text/plain; charset=utf-8', 'cache-control': 'no-store' };
        if (ext === '.zip') headers['content-disposition'] = 'attachment';
        res.writeHead(200, headers);
        return res.end(body);
      } catch {
        return send(res, 404, { error: 'not found' });
      }
    }

    // static
    if (req.method === 'GET') {
      const file = normalize(join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname.slice(1)));
      if (!file.startsWith(PUBLIC + sep) && file !== join(PUBLIC, 'index.html')) return send(res, 403, { error: 'forbidden' });
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
        return res.end(body);
      } catch {
        return send(res, 404, { error: 'not found' });
      }
    }

    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  const addr = `http://${HOST}:${PORT}`;
  console.log(`RedLine onboarding → ${addr}`);
  // Warm the prerequisite checks now so the first page load doesn't pay for them.
  refreshChecks().catch(() => {});
  if (!process.argv.includes('--no-open')) {
    const cmd = process.platform === 'win32' ? `start "" "${addr}"`
      : process.platform === 'darwin' ? `open "${addr}"` : `xdg-open "${addr}"`;
    exec(cmd, () => {});
  }
});
