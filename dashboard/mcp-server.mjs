// RedLine MCP server — lets any MCP client (Claude Code, Claude Desktop,
// other AI assistants) query RedLine and trigger runs.
//
//   node dashboard/mcp-server.mjs        (stdio transport)
//
// Register in a client's MCP config, e.g.:
//   { "mcpServers": { "redline": { "command": "node",
//       "args": ["<path-to-redline>/dashboard/mcp-server.mjs"] } } }
//
// Reads (tests, runs, baselines, flakes) go straight to the repo files via
// the same normalization the dashboard uses (runs-lib.mjs / agg.js) — they
// work with the dashboard closed. run_test / run_status bridge to the local
// dashboard HTTP API so the one-agent-at-a-time guard, event stream, and
// ledger flow stay in exactly one place. Zero dependencies: the MCP stdio
// protocol subset (initialize / tools/list / tools/call) is ~40 lines of
// JSON-RPC — no SDK needed.
// ponytail: tools/list+call only; add resources/prompts when a client needs them.

import { createInterface } from 'node:readline';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLedger, filterRuns } from './runs-lib.mjs';
import { flakyTests } from './public/agg.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DASHBOARD = process.env.REDLINE_DASHBOARD_URL || 'http://127.0.0.1:4242';
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

// ── data access (file-direct, same sources as the dashboard) ─────────

async function ledgerRuns() {
  const text = await readFile(join(ROOT, 'state', 'run-ledger.jsonl'), 'utf8').catch(() => '');
  return parseLedger(text).runs;
}

async function listTests() {
  const runs = await ledgerRuns();
  const out = [];
  for (const f of (await readdir(join(ROOT, 'baselines')).catch(() => [])).sort()) {
    const m = f.match(/^([a-z0-9-]+)\.([a-z0-9-]+)\.json$/);
    if (!m) continue;
    const [, team, profile] = m;
    const script = ['envs', 'workbench'].map((d) => join(ROOT, d, team, profile, 'script.js')).find((p) => existsSync(p));
    if (!script) continue;
    const last = runs.find((r) => r.team === team && r.profile === profile) || null;
    out.push({ team, profile, baseline: `baselines/${f}`, last: last && { run_id: last.run_id, verdict: last.verdict, recorded_at: last.recorded_at, summary: last.summary_line } });
  }
  return out;
}

async function dashboard(path, body) {
  let res;
  try {
    res = await fetch(`${DASHBOARD}${path}`, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }
      : { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error(`the RedLine dashboard is not reachable at ${DASHBOARD} — start it with "node dashboard/server.mjs" (run_test and run_status need it; read tools do not)`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `dashboard HTTP ${res.status}`);
  return json;
}

// ── tools ────────────────────────────────────────────────────────────

const TOOLS = {
  list_tests: {
    description: 'Every runnable RedLine test (team + profile with a script and a red/green baseline), with its latest verdict.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => listTests(),
  },
  list_runs: {
    description: 'Executions from the run ledger, newest first. Filter by team, suite (performance|functional), verdict (green|red|fail); limit defaults to 20.',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string' }, suite: { type: 'string', enum: ['performance', 'functional'] },
        verdict: { type: 'string', enum: ['green', 'red', 'fail'] }, limit: { type: 'number' },
      },
      additionalProperties: false,
    },
    handler: async (a = {}) => filterRuns(await ledgerRuns(), { team: a.team, suite: a.suite, verdict: a.verdict, limit: a.limit || 20 }),
  },
  get_run: {
    description: 'One execution by run_id — full normalized record (verdict, corroboration, endpoints, counts, Jira state).',
    inputSchema: { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'], additionalProperties: false },
    handler: async (a) => {
      const run = (await ledgerRuns()).find((r) => r.run_id === a.run_id);
      if (!run) throw new Error(`no such run: ${a.run_id}`);
      return run;
    },
  },
  get_baseline: {
    description: 'The red/green baseline (p95 red-line thresholds) for a team + profile.',
    inputSchema: { type: 'object', properties: { team: { type: 'string' }, profile: { type: 'string' } }, required: ['team', 'profile'], additionalProperties: false },
    handler: async (a) => {
      if (!SLUG.test(a.team || '') || !SLUG.test(a.profile || '')) throw new Error('team and profile must be slugs like demo-web / api-benchmark');
      return JSON.parse(await readFile(join(ROOT, 'baselines', `${a.team}.${a.profile}.json`), 'utf8'));
    },
  },
  list_flakes: {
    description: 'Tests whose red did not reproduce on the confirmation re-run (flaky tests), worst first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => flakyTests(await ledgerRuns()),
  },
  run_test: {
    description: 'Run a performance test now (the perf-run-one loop: run → compare → triage; filing stays human-gated). Requires the RedLine dashboard to be running; one run at a time.',
    inputSchema: { type: 'object', properties: { team: { type: 'string' }, profile: { type: 'string' } }, required: ['team', 'profile'], additionalProperties: false },
    handler: (a) => dashboard('/api/agent/run', { team: a.team, profile: a.profile }),
  },
  run_status: {
    description: 'Whether a run is in progress right now, and how the last one ended.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const s = await dashboard('/api/state');
      return s.agent || { running: false, note: 'no agent has run since the dashboard started' };
    },
  },
};

// ── MCP stdio plumbing (JSON-RPC 2.0, newline-delimited) ─────────────

const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const replyErr = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      return reply(id, {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'redline', version: '1.0.0' },
      });
    }
    if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return; // fire-and-forget
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') {
      return reply(id, { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
    }
    if (method === 'tools/call') {
      const t = TOOLS[params?.name];
      if (!t) return replyErr(id, -32602, `unknown tool: ${params?.name}`);
      try {
        const result = await t.handler(params?.arguments || {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        return reply(id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true });
      }
    }
    if (id !== undefined) replyErr(id, -32601, `method not found: ${method}`);
  } catch (e) {
    if (id !== undefined) replyErr(id, -32603, String(e.message || e));
  }
});
