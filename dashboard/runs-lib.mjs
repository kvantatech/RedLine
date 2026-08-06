// Pure normalization + guard logic for the Results (runs) view.
// No fs, no http — unit-testable in isolation. server.mjs owns all I/O.
// Ledger schema reference: .github/skills/run-ledger/SKILL.md (schema v1;
// pre-v1 lines are thin — every field here degrades to null, never throws).

import { join, normalize, sep, isAbsolute } from 'node:path';

// One run-ledger JSONL text → { runs: [normalized, newest first], unreadable: n }.
// jira-filing lines are applied onto their run; correction lines are skipped.
export function parseLedger(text) {
  const byId = new Map(); // run_id → raw record; a later line for the same id wins
  const filings = [];
  const graduations = []; // heal-graduation lines — applied onto their run like filings
  let unreadable = 0;
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { unreadable++; continue; }
    if (o.type === 'jira-filing') { filings.push(o); continue; }
    if (o.type === 'heal-graduation') { graduations.push(o); continue; }
    if (o.type === 'correction' || !o.run_id) continue;
    byId.set(o.run_id, o);
  }
  const runs = [...byId.values()].map(normalizeRecord);
  for (const f of filings) {
    const r = runs.find((x) => x.run_id === f.run_id);
    if (r) { r.jira.filed = true; r.jira.key = f.jira_key || r.jira.key; }
  }
  for (const g of graduations) {
    const r = runs.find((x) => x.run_id === g.run_id);
    if (r?.heal) {
      r.heal.graduated = true;
      r.heal.graduated_at = g.graduated_at || null;
      // committed:true is sticky — a later committed:false line (a racing
      // duplicate approval that found nothing left to commit) must never
      // demote the view of a commit that really exists in git.
      if (r.heal.committed !== true) {
        r.heal.committed = g.committed ?? null; // null = pre-dates the commit-on-approve change
        r.heal.sha = g.sha || null;
      }
    }
  }
  runs.sort((a, b) => String(b.recorded_at || '').localeCompare(String(a.recorded_at || '')));
  return { runs, unreadable };
}

export function normalizeRecord(o) {
  const raw = o.overall_verdict ?? null;
  // Two verdicts only (CLAUDE.md hard rule 6); anything else is a crash → "fail"
  // ("didn't finish" in the UI — a presentation state, not a verdict).
  const verdict = raw === 'green' ? 'green' : raw === 'red' ? 'red' : 'fail';
  const sources = Number.isFinite(o.sources) ? o.sources : null;
  const hasCounts = o.tests_total != null || o.passed != null || o.failed != null;
  return {
    run_id: o.run_id,
    recorded_at: o.recorded_at ?? null,
    team: o.team ?? null,
    profile: o.profile ?? null,
    suite: o.suite === 'functional' || o.profile === 'functional' ? 'functional' : 'performance',
    env: o.env ?? null,
    trigger: o.trigger ?? null,
    verdict,
    verdict_raw: raw,
    // flake = the confirmation re-run explicitly cleared the red — absence of
    // corroboration data is NOT a flake (old reds render as plain red).
    flake: verdict === 'red' && (o.confirm_verdict ?? null) === 'green',
    corroborated: o.corroborated ?? (sources != null ? sources >= 2 : null),
    sources,
    confirm_run_id: o.confirm_run_id ?? null,
    confirm_verdict: o.confirm_verdict ?? null,
    // heal (O4.5, functional only): { outcome, policy, healed, escalated, diff } or null.
    // Present when heal-playwright-suite ran; drives the Self-healing review panel.
    heal: (o.heal && typeof o.heal === 'object') ? o.heal : null,
    summary_line: o.summary_line ?? null,
    counts: hasCounts
      ? { total: o.tests_total ?? null, passed: o.passed ?? null, failed: o.failed ?? null, skipped: o.skipped ?? null }
      : null,
    failures: Array.isArray(o.failures) ? o.failures : [],
    endpoints: Array.isArray(o.endpoints) ? o.endpoints : [],
    reviewer_decision: o.reviewer_decision ?? null,
    jira: { filed: !!o.jira_filed, key: o.jira_key ?? null, draft_path: o.jira_draft ?? null },
    report_path: o.report_path ?? `reports/${o.run_id}/`,
  };
}

// Merge the local ledger with remote feeds ("one dashboard, many clusters",
// read-side). Each remote set is { name, runs } (already parseLedger-ed).
// Local wins on a run_id collision — its artifacts are actually here; a remote
// duplicate is the same run seen through a mirror. Origin is stamped on every
// run so the UI can say where a result came from.
export function mergeRuns(localRuns, remoteSets = []) {
  const seen = new Set();
  const out = [];
  for (const r of localRuns) { r.origin = 'local'; seen.add(r.run_id); out.push(r); }
  for (const set of remoteSets) {
    for (const r of set.runs || []) {
      if (seen.has(r.run_id)) continue;
      seen.add(r.run_id);
      r.origin = set.name;
      out.push(r);
    }
  }
  out.sort((a, b) => String(b.recorded_at || '').localeCompare(String(a.recorded_at || '')));
  return out;
}

export function filterRuns(runs, { team, suite, verdict, limit } = {}) {
  let out = runs;
  if (team) out = out.filter((r) => r.team === team);
  if (suite) out = out.filter((r) => r.suite === suite);
  if (verdict) out = out.filter((r) => r.verdict === verdict);
  const n = Number(limit);
  if (Number.isFinite(n) && n > 0) out = out.slice(0, n);
  return out;
}

// reports/<run_id>/<rel> → absolute path, or null if anything escapes the run dir.
export function artifactSafePath(reportsRoot, runId, rel) {
  const id = String(runId || '');
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id.includes('..')) return null;
  const relPath = String(rel || '');
  if (!relPath || isAbsolute(relPath) || relPath.includes('\0') || /^[A-Za-z]:/.test(relPath)) return null;
  const base = join(reportsRoot, id);
  const full = normalize(join(base, relPath));
  return full.startsWith(base + sep) ? full : null;
}

// Grafana deep-link per link-grafana-panel conventions (pure string; no API,
// no token). Only for perf runs, only when a base URL is configured.
export function grafanaUrl(rec, base) {
  if (!base || rec.suite !== 'performance' || !rec.team || !rec.profile) return null;
  let u;
  try { u = new URL(`/d/perf-${rec.team}/perf-${rec.team}`, base); } catch { return null; }
  u.searchParams.set('orgId', '1');
  const t = Date.parse(rec.recorded_at || '');
  if (Number.isFinite(t)) {
    u.searchParams.set('from', String(t - 3_600_000));
    u.searchParams.set('to', String(t + 3_600_000));
  }
  if (rec.env) u.searchParams.set('var-environment', rec.env === 'prod' ? 'prod-us' : 'staging');
  u.searchParams.set('var-test_file', rec.profile);
  u.searchParams.append('var-run_id', rec.run_id);
  if (rec.confirm_run_id) u.searchParams.append('var-run_id', rec.confirm_run_id);
  return u.href;
}
