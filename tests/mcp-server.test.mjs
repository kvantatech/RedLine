// node tests/mcp-server.test.mjs — drives dashboard/mcp-server.mjs over real
// stdio JSON-RPC: initialize → tools/list → tools/call. Read tools hit the
// real repo files; the dashboard-bridge tool is tested against a dead port so
// the "dashboard not running" path is exercised without side effects.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'dashboard', 'mcp-server.mjs');
const proc = spawn(process.execPath, [SERVER], {
  env: { ...process.env, REDLINE_DASHBOARD_URL: 'http://127.0.0.1:59999' }, // dead port on purpose
});

const pending = new Map();
let nextId = 1;
createInterface({ input: proc.stdout }).on('line', (l) => {
  if (!l.trim()) return;
  const msg = JSON.parse(l);
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});
const call = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, resolve);
  setTimeout(() => { if (pending.delete(id)) reject(new Error(`timeout: ${method}`)); }, 10_000);
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const tool = async (name, args) => {
  const r = await call('tools/call', { name, arguments: args });
  return { isError: !!r.result.isError, body: r.result.content[0].text };
};

try {
  // handshake
  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.equal(init.result.serverInfo.name, 'redline');
  assert.ok(init.result.capabilities.tools);
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  // tools/list exposes the full set
  const list = await call('tools/list', {});
  const names = list.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['get_baseline', 'get_run', 'list_flakes', 'list_runs', 'list_tests', 'run_status', 'run_test']);
  assert.ok(list.result.tools.every((t) => t.description && t.inputSchema?.type === 'object'));

  // read tools work with no dashboard running
  const tests = JSON.parse((await tool('list_tests', {})).body);
  assert.ok(Array.isArray(tests) && tests.length >= 1, 'expected at least one runnable test');
  assert.ok(tests.every((t) => t.team && t.profile && t.baseline));

  const runs = JSON.parse((await tool('list_runs', { limit: 5 })).body);
  assert.ok(Array.isArray(runs) && runs.length >= 1 && runs.length <= 5);
  assert.ok(runs[0].run_id && runs[0].verdict);

  const one = JSON.parse((await tool('get_run', { run_id: runs[0].run_id })).body);
  assert.equal(one.run_id, runs[0].run_id);

  const missing = await tool('get_run', { run_id: 'nope_never_ran' });
  assert.equal(missing.isError, true);
  assert.match(missing.body, /no such run/);

  const bl = JSON.parse((await tool('get_baseline', { team: tests[0].team, profile: tests[0].profile })).body);
  assert.equal(bl.team, tests[0].team);

  const traversal = await tool('get_baseline', { team: '../etc', profile: 'x' });
  assert.equal(traversal.isError, true);

  const flakes = JSON.parse((await tool('list_flakes', {})).body);
  assert.ok(Array.isArray(flakes));

  // bridge tools fail SOFT with a helpful message when the dashboard is down
  const rt = await tool('run_test', { team: tests[0].team, profile: tests[0].profile });
  assert.equal(rt.isError, true);
  assert.match(rt.body, /dashboard is not reachable/);

  // unknown method and unknown tool answer with proper JSON-RPC errors
  const bad = await call('no/such', {});
  assert.equal(bad.error.code, -32601);
  const badTool = await call('tools/call', { name: 'nope', arguments: {} });
  assert.equal(badTool.error.code, -32602);

  console.log('mcp-server: all checks passed');
} finally {
  proc.kill();
}
