# Results (Runs) view — design spec

> Date: 2026-07-10 · Status: APPROVED (Anton, 2026-07-10) · Origin: platform gap analysis
> Build note: UI work at implementation time uses the **impeccable** skill, matching the existing two-theme CSS.

## Context

The dashboard today is a wizard (author + run); after a run completes the operator sees one
results page and then the outcome is only recoverable by reading `state/run-ledger.jsonl` by
hand. The platform gap analysis (2026-07-10) identified run history / artifacts / trends as the
one platform capability worth adopting. Product decision: **no Grafana dependency** — the
dashboard renders everything from the ledger and `reports/`; OTLP→Grafana export stays an
optional enterprise add-on.

## Goals

1. Browsable run history with filters, backed by `state/run-ledger.jsonl` (SSOT, read-only).
2. Run detail with failures, artifacts (screenshots, traces, logs, Jira draft), and governance
   state (reviewer decision, corroboration, Jira filed/draft).
3. Trend charts (pass rate, p95 vs threshold) computed from the ledger — no metrics database.
4. Fix the data at the source so 1–3 actually work (structured perf metrics; failure artifacts).

## Non-goals (deferred, in roadmap order)

Scheduled runs · artifact retention/archive policy · fleet multi-team rollup views ·
deploy-event triggers · per-test flake analytics page · auth/RBAC. Nothing here blocks them.

## Hard constraints

- **Two verdicts only: green | red.** No third chip state. A non-corroborated red (confirm
  re-run green) renders as a red row with a "not reproduced on re-run" annotation; trend
  charts draw it as a hollow red marker. Flake is an annotation, never a verdict.
  Ledger records whose run never produced a verdict (`overall_verdict: "fail"` or
  `"no-baseline"` — runner crash, config error) render as a muted **"didn't finish"** row:
  that is a crash presentation, not a third verdict, and such runs contribute no chart points.
- Zero new dependencies. Same Node server, vanilla JS, inline SVG charts.
- Ledger is never written by the view. All rollups computed at render time, never stored.
- The view never files Jira or triggers anything irreversible — read-only surface;
  re-running goes through the existing wizard operate path.

## Design

### 1 · Navigation & IA

- Left rail gains a **Results** entry (UI label "Results"; code/API say "runs"), always visible.
- Hash routing: `#runs` (list) and `#runs/<run_id>` (detail) — deep-linkable so Slack alerts
  can link straight to a run later. The wizard keeps its current state-machine flow; the done
  screen gains a "View this run" link into `#runs/<run_id>`.
- New front-end module `dashboard/public/runs.js` (app.js is 926 lines; the new section gets
  its own file, same render-function pattern, loaded from index.html).

### 2 · API — three read-only endpoints in `dashboard/server.mjs`

- `GET /api/runs?team=&suite=&verdict=&limit=` → newest-first array of normalized records.
  A normalization layer absorbs heterogeneous JSONL (schema v1 evolved over time): missing
  fields → null, malformed lines skipped and counted (`unreadable` count in the envelope).
  Normalized record: `run_id, recorded_at, team, profile, suite, env, trigger, verdict,
  verdict_raw, flake, corroborated, sources, confirm_run_id, confirm_verdict, summary_line,
  counts{total,passed,failed,skipped}, failures[], endpoints[], reviewer_decision,
  jira{filed,key,draft_path}, report_path, has_report_dir`.
- `GET /api/runs/<run_id>` → one normalized record + artifact file listing (name, size, type)
  from `reports/<run_id>/` + a Grafana deep-link **only if** `GRAFANA_BASE_URL` is configured
  (optional add-on model; absent = link hidden).
- `GET /reports/<run_id>/<file>` → static artifact serving. Realpath-guarded to inside
  `reports/` (traversal attempt → 403), correct content types, inline render size-capped
  (larger files become downloads), traces served as zip download.

### 3 · Results list

Rows: verdict chip (green/red) · corroboration badge ("confirmed ×2" / "not reproduced on
re-run") · team · suite/profile · relative + absolute time · headline (functional: "14/16
passed"; perf: worst p95 vs threshold) · reviewer state · Jira state. Filters: team, suite
(functional|performance), verdict. Client-side "show more" pagination (ledger is small; no
server paging until it isn't).

### 4 · Run detail

Top-down: summary header (verdict, summary_line, run_id + confirm_run_id, env, trigger,
timestamps) → failure cards (test name, file, error, screenshot thumbnail, trace download —
when present) → perf metric table (per metric: p95, threshold, delta ms and %) → artifacts
list (jira-draft.md rendered as text, run.log, results.json, reviewer-decision.json
summarized) → governance strip (reviewer decision, corroboration, Jira draft/filed — read-only)
→ optional Grafana deep-link.

Missing report dir (gitignored artifacts wiped or other machine): detail still renders fully
from the ledger with an "artifacts not retained on this machine" note.

### 5 · Trends

Per team+profile sparkline over the last 30 runs, computed client-side from `/api/runs`:
- Functional: pass rate (passed/total), red markers on red runs, hollow markers when
  non-corroborated.
- Performance: p95 per metric with the threshold as a reference line.
Inline SVG, no chart library. Old ledger lines without structured metrics simply contribute
no perf chart points — **no regex parsing of `summary_line`** (fragile, rejected).

### 6 · Data-source fixes (prerequisites, same implementation)

- **Structured perf metrics — already satisfied (discovered 2026-07-10 during planning):**
  schema v1 (`run-ledger` WRITE) already REQUIRES `endpoints[]` with per-metric
  `p95_ms`/`p95_red_ms` on every green/red k6 record, and 8 real ledger lines carry it.
  The view reuses `endpoints[]` as-is; no new `metrics{}` field, no pipeline change.
  Pre-schema thin lines (June 2026 sims) simply contribute no perf chart points.
- **Failure artifacts:** functional suite configs (live/redline-dashboard, drafts/
  redline-dashboard, drafts/saucedemo-team + the spec-author authoring convention) get
  `screenshot: 'only-on-failure'` and `trace: 'retain-on-failure'`; `run-playwright-suite`
  copies screenshots into `reports/<run_id>/artifacts/` (both envs — a screenshot doesn't
  embed auth headers). Traces keep the existing hygiene hard rule unchanged: kept under
  `reports/<run_id>/traces/` on local, **deleted on stg** (may embed auth headers).
  `retries: 0` stays 0 (author-resilient-playwright hard rule).

### 7 · Error handling

Skipped malformed ledger lines surfaced as a count, never a crash · missing report dir
degrades gracefully (see §4) · traversal guard on all artifact paths · size caps on inline
artifact rendering · unknown/legacy ledger fields ignored, never fatal.

### 8 · Testing

One runnable check: `tests/runs-api.test.mjs` runs the server against a fixture ledger
containing all three real line shapes (thin old perf line, rich functional line,
non-corroborated red line) and asserts: normalization output, filter behavior, 403 on a
traversal attempt, graceful handling of a malformed line. UI verified by driving the live
dashboard; impeccable critique pass on the new section before done.

## Platform coverage after this build

In: execution history + filters, run drill-down (failures/logs/artifacts), health trends,
flake surfacing (annotation level), effective re-run (via wizard operate path).
Later: scheduling UI, trigger config, fleet aggregation, per-test flake analytics.
Never (deliberate): RBAC/SSO, multi-cluster control plane.
Ours alone: the governance strip — reviewer decision, corroboration, human-gated Jira state
on every run.
