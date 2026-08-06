// notify.mjs — deterministic multi-channel alert fan-out for notify-responsible-team.
//
//   node notify.mjs --team demo-web --env stg --jira-key PERF-123 \
//     --summary "GET /config p95 1450ms > red 1000ms" [--grafana-url URL] [--dry-run] [--config path]
//
// Reads state/team-channels.json, resolves the team's channels (Slack, MS Teams,
// PagerDuty, OpsGenie), and POSTs one alert per channel. Secrets come from env
// vars only — the config names the var, never holds the value. Prints one result
// line per channel: "posted: ..." | "skipped: ..." | "failed: ...". Exit 0 unless
// the invocation itself is invalid (exit 2) — a channel failure must never crash
// the filing flow; the caller reports the lines.

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const JIRA_BASE = process.env.JIRA_BASE_URL || 'https://jira.example.com';

// ── args ─────────────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const m = process.argv[i].match(/^--([a-z-]+)$/);
  if (!m) continue;
  const key = m[1];
  if (key === 'dry-run') { args.dryRun = true; continue; }
  args[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = process.argv[++i] || '';
}
const { team, env, jiraKey, summary } = args;
if (!team || !env || !jiraKey || !summary) {
  console.error('usage: node notify.mjs --team T --env E --jira-key K --summary "..." [--grafana-url U] [--dry-run] [--config path]');
  process.exit(2);
}

// ── message shapes ───────────────────────────────────────────────────
const jiraUrl = `${JIRA_BASE}/browse/${jiraKey}`;
const plain = `perf regression — ${team}/${env}: ${summary} → ${jiraUrl}${args.grafanaUrl ? ` · Grafana: ${args.grafanaUrl}` : ''}`;
const slackLine = `:red_circle: ${plain}`;   // Slack renders the shortcode
const teamsLine = `\u{1F534} ${plain}`;      // Teams needs the real emoji

// ── channel senders — each returns a result line ─────────────────────
const post = async (url, body, headers = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

const SENDERS = {
  async slack(ch) {
    const hook = process.env[ch.webhook_env || ''];
    if (!hook) return `skipped: slack webhook env ${ch.webhook_env} not set — notify manually: ${slackLine}`;
    if (args.dryRun) return `dry-run: slack ${ch.channel} — ${JSON.stringify({ text: slackLine })}`;
    const r = await post(hook, { text: slackLine });
    return r.ok ? `posted: slack ${ch.channel}` : `failed: slack ${ch.channel} HTTP ${r.status} — notify manually: ${slackLine}`;
  },
  async msteams(ch) {
    const hook = process.env[ch.webhook_env || ''];
    if (!hook) return `skipped: msteams webhook env ${ch.webhook_env} not set — notify manually: ${teamsLine}`;
    if (args.dryRun) return `dry-run: msteams ${ch.channel} — ${JSON.stringify({ text: teamsLine })}`;
    const r = await post(hook, { text: teamsLine });
    return r.ok ? `posted: msteams ${ch.channel}` : `failed: msteams ${ch.channel} HTTP ${r.status} — notify manually: ${teamsLine}`;
  },
  async pagerduty(ch) {
    const key = process.env[ch.routing_key_env || ''];
    if (!key) return `skipped: pagerduty routing key env ${ch.routing_key_env} not set — notify manually: ${plain}`;
    const body = {
      routing_key: key,
      event_action: 'trigger',
      dedup_key: jiraKey, // one incident per ticket — refiling the same key dedupes
      payload: {
        summary: plain.slice(0, 1024),
        source: `redline/${team}/${env}`,
        severity: 'error',
        custom_details: { jira: jiraUrl, grafana: args.grafanaUrl || '' },
      },
    };
    if (args.dryRun) return `dry-run: pagerduty — ${JSON.stringify(body)}`;
    const r = await post('https://events.pagerduty.com/v2/enqueue', body);
    return r.status === 202 ? 'posted: pagerduty' : `failed: pagerduty HTTP ${r.status} — notify manually: ${plain}`;
  },
  async opsgenie(ch) {
    const key = process.env[ch.api_key_env || ''];
    if (!key) return `skipped: opsgenie api key env ${ch.api_key_env} not set — notify manually: ${plain}`;
    const host = ch.region === 'eu' ? 'https://api.eu.opsgenie.com' : 'https://api.opsgenie.com';
    const body = {
      message: plain.slice(0, 130), // OpsGenie message cap
      alias: jiraKey,               // dedupe key
      description: plain,
      details: { jira: jiraUrl, grafana: args.grafanaUrl || '', team, env },
      priority: 'P2',
    };
    if (args.dryRun) return `dry-run: opsgenie — ${JSON.stringify(body)}`;
    const r = await post(`${host}/v2/alerts`, body, { authorization: `GenieKey ${key}` });
    return r.status === 202 ? 'posted: opsgenie' : `failed: opsgenie HTTP ${r.status} — notify manually: ${plain}`;
  },
};

// ── resolve team channels (v1 single-object and v2 array shapes) ─────
let cfg;
try {
  cfg = JSON.parse(await readFile(args.config || join(ROOT, 'state', 'team-channels.json'), 'utf8'));
} catch (e) {
  console.error(`failed: cannot read team-channels config — ${e.message}`);
  process.exit(2);
}
const entry = cfg[team];
if (!entry) { console.log(`skipped: no channel mapped for ${team}`); process.exit(0); }
const channels = (Array.isArray(entry) ? entry : [entry]).map((c) => ({ type: 'slack', ...c }));

for (const ch of channels) {
  const send = SENDERS[ch.type];
  if (!send) { console.log(`skipped: unknown channel type "${ch.type}" for ${team}`); continue; }
  try {
    console.log(await send(ch));
  } catch (e) {
    console.log(`failed: ${ch.type} ${e.message} — notify manually: ${plain}`);
  }
}
