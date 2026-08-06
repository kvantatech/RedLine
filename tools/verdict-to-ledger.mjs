// verdict-to-ledger.mjs — turn a run-k6-action verdict.json into ONE ledger
// JSONL line on stdout, so a CI gate run anywhere can publish its result to a
// feed the RedLine dashboard merges (state/remote-ledgers.json).
//
//   node tools/verdict-to-ledger.mjs --verdict reports/<id>/verdict.json \
//     [--trigger deploy|cron|manual] [--deploy-sha <sha>] >> my-cluster-feed.jsonl
//
// Publish the growing JSONL wherever your dashboard can read it — a raw file
// in a repo, an S3/GCS object, a network share. Then list it in
// state/remote-ledgers.json: [{ "name": "eu-cluster", "url": "https://…" }].
// This converter is a convenience for run-k6-action gates; ANY runner can emit
// the line directly — the contract is documented in tools/README.md.
// The line matches the run-ledger schema-v1 fields the dashboard normalizes;
// gate runs carry no corroboration/reviewer data (that is the perf-run-one
// loop, not the gate) — they render as plain green/red/fail.

import { readFile } from 'node:fs/promises';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const m = process.argv[i].match(/^--([a-z-]+)$/);
  if (m) args[m[1]] = process.argv[++i] || '';
}
if (!args.verdict) {
  console.error('usage: node tools/verdict-to-ledger.mjs --verdict <verdict.json> [--trigger deploy|cron|manual] [--deploy-sha <sha>]');
  process.exit(2);
}

const v = JSON.parse(await readFile(args.verdict, 'utf8'));
const trigger = ['deploy', 'cron', 'manual'].includes(args.trigger) ? args.trigger : 'deploy';
const now = new Date().toISOString();

const line = {
  schema: 'v1',
  run_id: v.run_id || `${v.team}_${v.profile}_${v.env}_${now.replace(/[-:.]/g, '').slice(0, 15)}Z`,
  recorded_at: now,
  workflow: 'run-k6-action',
  team: v.team ?? null,
  profile: v.profile ?? null,
  env: v.env ?? null,
  trigger,
  ...(args['deploy-sha'] ? { deploy_sha: args['deploy-sha'] } : {}),
  overall_verdict: v.overall_verdict === 'no-baseline' ? 'fail' : v.overall_verdict,
  summary_line: v.summary_line ?? '',
  endpoints: v.endpoints ?? [],
  gate_mode: v.mode ?? null,
  jira_filed: false,
};

process.stdout.write(JSON.stringify(line) + '\n');
