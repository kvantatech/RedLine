// The wizard's prompts and tool allowlists are the contract between the
// dashboard and the headless agent it spawns. Both halves have broken in the
// field (issue #1): a prompt told the agent to re-judge an environment the
// operator had already chosen, and another ordered `mkdir -p` with no mkdir in
// the allowlist — which a `claude -p` run cannot prompt for, so it just fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthorPrompt, buildBenchmarkPrompt, toolsFor } from '../dashboard/wizard.mjs';

const cfg = (env) => ({
  team: 'acme', path: 'api', env,
  api: { url: 'https://checkout.acme.com/api/health' },   // no stg/qa/dev marker in the host
  browser: { url: '', journey: '' },
  login: { required: false, credsSet: false },
});

test('author prompt: an explicit non-prod choice is authoritative — no URL re-classification', () => {
  for (const env of ['stg', 'local']) {
    const p = buildAuthorPrompt(cfg(env));
    assert.match(p, /selection is authoritative/i, env);
    assert.doesNotMatch(p, /STOP immediately/i, env);       // the old refusal clause
    assert.match(p, /environment "([a-z]+)"/i, env);
  }
});

test('author prompt: prod still carries the hard-rule-2 authorization gate', () => {
  const p = buildAuthorPrompt(cfg('prod'));
  assert.match(p, /TARGET IS PRODUCTION/);
  assert.match(p, /explicit operator authorization/i);
  assert.match(p, /STOP/);
});

test('benchmark prompt: env flows through to the house rules unchanged', () => {
  assert.match(buildBenchmarkPrompt(cfg('prod')), /TARGET IS PRODUCTION/);
  assert.match(buildBenchmarkPrompt(cfg('stg')), /selection is authoritative/i);
});

test('allowlists cover every shell command the prompts order', () => {
  // Any `cmd ...` in a backtick span of the prompt must have a matching Bash(cmd *) grant.
  for (const [kind, prompt] of [['author', buildAuthorPrompt(cfg('stg'))], ['benchmark', buildBenchmarkPrompt(cfg('stg'))]]) {
    const tools = toolsFor(kind);
    for (const cmd of ['mkdir', 'k6']) {
      if (new RegExp(`\`${cmd}\\b`).test(prompt)) {
        assert.ok(tools.includes(`Bash(${cmd} *)`), `${kind} prompt runs \`${cmd}\` but ${cmd} is not in its allowlist`);
      }
    }
  }
});

test('benchmark keeps the 10-iteration standard (CLAUDE.md hard rule 7)', () => {
  assert.match(buildBenchmarkPrompt(cfg('stg')), /10 iterations/);
  assert.match(buildAuthorPrompt(cfg('stg')), /Smoke-run it ONCE/);   // create stage stays 1 iteration
});
