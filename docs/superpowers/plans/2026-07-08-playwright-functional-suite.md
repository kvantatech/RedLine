# Playwright Functional Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RedLine becomes a two-suite QA agent — functional (Playwright) beside performance (k6) — with `func-author`/`func-run-one` workflows, 5 new skills, a 3rd subagent, doc repositioning, a full two-path dashboard redesign via `impeccable`, and pilot proofs on the RedLine dashboard.

**Architecture:** Mirror the k6 pair ("parallel suite, shared spine" — spec §1–2). Suite-specific steps get new one-job skills; the ledger, corroboration, reviewer, scope gate, and filing gates are reused. Two deterministic skills ship a tiny Node script each (`parse.mjs`, `verdict.mjs`) so fails-closed is provable by fixtures, not claimed.

**Tech Stack:** Playwright `@playwright/test` (latest, ≥1.44 for `--last-failed`) + Chromium; Node ≥18 (already required by dashboard); PowerShell 5.1 checks; no other new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-08-playwright-functional-suite-design.md` — read it before starting.

## Global Constraints

- **Git:** Anton's standing order — never commit without being asked. At execution start, ask once: "commits approved for this plan?" If no, skip every commit step; the work still proceeds.
- **Verdicts:** `green | red` only (`fail` = crash). Functional: all tests pass = green; any corroborated failure = red.
- **PROD forbidden entirely for functional suites (v1).** `env ∈ { local, stg }`. No carve-out.
- **Doctrine labels** (`[DET] [MODEL] [MODEL grounded] [MODEL bounded] [HUMAN]`) on every workflow step. Budgets: func-author = 1 + 2 bounded grounded helpers; func-run-one = 2 (+2 on one REQUEST_CHANGES retry).
- **`retries: 0` in every Playwright config** — flake detection belongs to `corroborate-2-sources`, never to Playwright retries.
- **Canonical source is `.github/`** — skills in `.github/skills/<name>/SKILL.md`, subagents in `.github/agents/`. No `.claude/` copies.
- **`live/` is read-only** except the pilot carve-out `live/redline-dashboard/` (and existing `live/demo-web/`).
- **Absolute dates** in all authored docs; stamp facts with 2026-07-08.
- New skill files follow the house format: title, one-line quote, `**Type:** … · **Used by:** … · **Status:** …`, `## Prompt` (numbered steps), `## Tools`, `## Data`, `## Hard rules`.

---

### Task 1: Playwright dependency home

**Files:**
- Create: `package.json` (repo root)
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npx playwright test` runnable from repo root; every later task assumes this.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "redline",
  "private": true,
  "devDependencies": {
    "@playwright/test": "^1.54.0"
  }
}
```

(If `npm install` resolves a newer 1.x, keep it — floor is 1.44 for `--last-failed`.)

- [ ] **Step 2: Append to `.gitignore`**

```
node_modules/
test-results/
playwright-report/
```

- [ ] **Step 3: Install**

Run: `npm install` then `npx playwright install chromium`
Expected: both exit 0.

- [ ] **Step 4: Verify**

Run: `npx playwright --version`
Expected: `Version 1.54.x` (or newer).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "feat: add @playwright/test as the functional-suite runner"
```

---

### Task 2: Failing smoke registry (TDD anchor for the whole plan)

**Files:**
- Modify: `tests/smoke.ps1:52-88`

**Interfaces:**
- Produces: the red checklist every file-creating task turns green. Final task re-runs it expecting PASS.

- [ ] **Step 1: Extend the workflow list**

In `tests/smoke.ps1`, change the `$workflows` array to:

```powershell
$workflows = @(
    'perf-author',
    'perf-run-one',
    'perf-sweep',
    'prod-stg-parity-check',
    'mass-onboarding',
    'baseline-curate-all',
    'build-status',
    # functional suite (2026-07-08)
    'func-author',
    'func-run-one'
)
```

- [ ] **Step 2: Extend the skill list and reconcile the count**

Append to the `$skills` array (before the closing `)`):

```powershell
    # 2 on-disk but missing from this registry (reconciled 2026-07-08)
    'scope-review', 'impeccable',
    # 5 functional suite (2026-07-08)
    'run-playwright-suite', 'parse-playwright-summary', 'func-verdict',
    'verify-playwright-suite', 'triage-func-verdict'
```

(The count check already derives from `$skills.Count` — no literal to fix. New expected total: 35.)

- [ ] **Step 3: Add the new agent + dependency + check-script items**

After the two existing `Test-Item '.github/agents/...'` lines add:

```powershell
Test-Item '.github/agents/spec-author.agent.md'
```

After `Test-Item '.mcp.json'` add:

```powershell
Test-Item 'package.json'
Test-Item 'tests/func-contract-check.ps1'
```

- [ ] **Step 4: Run smoke — verify it fails on exactly the not-yet-created items**

Run: `powershell -File tests/smoke.ps1`
Expected: FAIL lines for `func-author`, `func-run-one` workflows, the 5 functional skills, `spec-author.agent.md`, `tests/func-contract-check.ps1`, and the skill-dir count (found 30, expected 35). PASS for `scope-review`, `impeccable`, `package.json`. Exit code 1.

- [ ] **Step 5: Commit**

```bash
git add tests/smoke.ps1
git commit -m "test: extend smoke registry for the functional suite (red until built)"
```

---

### Task 3: `run-playwright-suite` skill

**Files:**
- Create: `.github/skills/run-playwright-suite/SKILL.md`

**Interfaces:**
- Consumes: root `package.json` (Task 1).
- Produces: `reports/<run_id>/results.json` (raw Playwright JSON report), `reports/<run_id>/run-error.txt` on crash, `reports/<run_id>/traces/` (local only). Callers: `func-run-one` O1, `corroborate-2-sources`.

- [ ] **Step 1: Write the SKILL.md**

````markdown
# run-playwright-suite
> Execute one team's Playwright functional suite and save the raw JSON results artifact.

**Type:** skill (deterministic) · **Used by:** func-run-one, corroborate-2-sources · **Status:** LIVE (2026-07-08)

---

## Prompt

You will execute a single Playwright functional suite and save its output. Follow these steps exactly.

### 1 — Validate inputs

Required inputs (caller must supply all three):
- `suite_path` — e.g. `live/redline-dashboard/functional` (a directory containing `playwright.config.ts` and `tests/`)
- `run_id` — unique string, e.g. `redline-dashboard_functional_local_20260708T143022Z`
- `env` — `local` or `stg` (case-insensitive)

Optional:
- `extra_args` — extra CLI args (e.g. `--last-failed`, passed by corroborate-2-sources)

Reject and STOP if any of the following are true:
- `suite_path` does not start with `live/` (absolute or `../` paths are forbidden)
- `<suite_path>/playwright.config.ts` does not exist
- `env` is `prod` — **functional suites NEVER run on PROD (v1 hard rule — no carve-out, stricter than k6)**
- `run_id` is empty or missing

### 2 — Prepare the output directory

Create `reports/<run_id>/` if it does not exist.

### 3 — Run the suite

```powershell
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = "reports/<run_id>/results.json"
npx playwright test -c <suite_path>/playwright.config.ts --reporter=json <extra_args>
```

The suite's `webServer` config auto-starts the app under test — do not start it manually.
Capture stdout, stderr, and the exit code.

### 4 — Handle exit codes

| Exit code | Meaning | Action |
|-----------|---------|--------|
| 0 | all tests passed | Continue |
| 1 | ≥1 test failed | Continue — `parse-playwright-summary` will surface the failures |
| any other, OR `results.json` missing/empty | runner crash, config error, webServer failed to start | Write `reports/<run_id>/run-error.txt` with stderr; mark run as FAILED; STOP |

A broken runner is a **fail**, never a red — it must not enter the regression path.

### 5 — Trace handling (secret hygiene)

If `test-results/` contains `trace.zip` artifacts after the run:
- `env=local` → move them to `reports/<run_id>/traces/`.
- `env=stg` → **DELETE them unconditionally** and write `reports/<run_id>/trace-note.txt`
  with `traces deleted (may embed auth headers; scrub step not yet live)` — the same
  interim rule `run-k6-script` applies to HARs.

### 6 — Return

Return `{ "results_path": "reports/<run_id>/results.json", "exit_code": <n> }`.

---

## Tools

Bash (`npx playwright test`), Read, Write — no MCP, no model calls.

## Data

- Reads: `live/<team>/functional/` (config + specs)
- Writes: `reports/<run_id>/results.json`, `reports/<run_id>/run-error.txt`, `reports/<run_id>/traces/`, `reports/<run_id>/trace-note.txt`

## Hard rules

1. PROD is rejected before anything runs. No exceptions in v1.
2. Never persist a trace from a non-local env.
3. Exit 1 is a signal (test failures), not an error — only "other" codes are crashes.
````

- [ ] **Step 2: Verify smoke picks it up**

Run: `powershell -File tests/smoke.ps1`
Expected: `PASS  skill: run-playwright-suite` (other new items still FAIL).

- [ ] **Step 3: Commit**

```bash
git add .github/skills/run-playwright-suite/
git commit -m "feat: run-playwright-suite skill (DET executor for functional runs)"
```

---

### Task 4: `parse-playwright-summary` skill — fixtures first

**Files:**
- Create: `tests/fixtures/functional/green.json`, `red.json`, `empty.json`, `crash.json`
- Create: `tests/func-contract-check.ps1`
- Create: `.github/skills/parse-playwright-summary/parse.mjs`
- Create: `.github/skills/parse-playwright-summary/SKILL.md`

**Interfaces:**
- Consumes: `reports/<run_id>/results.json` from Task 3.
- Produces: `contract.json` shape consumed by Tasks 5, 8, 12:
  `{ run_id, suite: "functional", started_at, duration_s, tests_total, passed, failed, skipped, failures: [{ test, file, error }] }`
- CLI: `node .github/skills/parse-playwright-summary/parse.mjs <results.json> <run_id> <out.json>` — exit 0 = wrote contract; exit 1 = fails closed with `FAILED — <reason>` on stderr.

- [ ] **Step 1: Write the four fixtures**

`tests/fixtures/functional/green.json`:

```json
{
  "stats": { "startTime": "2026-07-08T12:00:00.000Z", "duration": 8300,
             "expected": 3, "unexpected": 0, "skipped": 0, "flaky": 0 },
  "suites": []
}
```

`tests/fixtures/functional/red.json`:

```json
{
  "stats": { "startTime": "2026-07-08T12:00:00.000Z", "duration": 9100,
             "expected": 2, "unexpected": 1, "skipped": 0, "flaky": 0 },
  "suites": [
    { "title": "wizard.spec.ts", "file": "wizard.spec.ts",
      "specs": [
        { "title": "creates a team", "file": "wizard.spec.ts",
          "tests": [ { "status": "unexpected",
            "results": [ { "error": { "message": "expect(locator).toBeVisible() failed\nCall log: ..." } } ] } ] }
      ] }
  ]
}
```

`tests/fixtures/functional/empty.json`:

```json
{ "stats": { "expected": 0, "unexpected": 0, "skipped": 0, "flaky": 0 }, "suites": [] }
```

`tests/fixtures/functional/crash.json` (deliberately not JSON):

```
k6BrowserHeadless is not a playwright report — simulated corrupt output
```

- [ ] **Step 2: Write the check script**

`tests/func-contract-check.ps1`:

```powershell
#requires -Version 5.1
# Behavior check for parse.mjs + verdict.mjs against the four fixtures.
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot
$fx  = 'tests/fixtures/functional'
$tmp = Join-Path $env:TEMP 'redline-func-check'
New-Item -ItemType Directory -Force $tmp | Out-Null
$script:Failures = 0
function Assert { param([bool]$Cond, [string]$Label)
  if ($Cond) { Write-Host "PASS  $Label" -ForegroundColor Green }
  else { Write-Host "FAIL  $Label" -ForegroundColor Red; $script:Failures++ } }

# parse: green fixture → contract with 3/3 passed
node .github/skills/parse-playwright-summary/parse.mjs "$fx/green.json" RUN-G "$tmp/c-green.json"
Assert ($LASTEXITCODE -eq 0) 'parse green exits 0'
$c = Get-Content "$tmp/c-green.json" -Raw | ConvertFrom-Json
Assert ($c.tests_total -eq 3 -and $c.passed -eq 3 -and $c.failed -eq 0) 'green contract counts'

# parse: red fixture → 1 failure with test name + first error line
node .github/skills/parse-playwright-summary/parse.mjs "$fx/red.json" RUN-R "$tmp/c-red.json"
Assert ($LASTEXITCODE -eq 0) 'parse red exits 0'
$c = Get-Content "$tmp/c-red.json" -Raw | ConvertFrom-Json
Assert ($c.failed -eq 1 -and $c.failures[0].test -like '*creates a team*') 'red contract failure row'
Assert (-not $c.failures[0].error.Contains("`n")) 'error is first line only'

# parse: empty + crash → fail closed (exit 1)
node .github/skills/parse-playwright-summary/parse.mjs "$fx/empty.json" RUN-E "$tmp/c-e.json"
Assert ($LASTEXITCODE -eq 1) 'parse empty fails closed'
node .github/skills/parse-playwright-summary/parse.mjs "$fx/crash.json" RUN-C "$tmp/c-c.json"
Assert ($LASTEXITCODE -eq 1) 'parse crash fails closed'

# verdict: green contract → green; red contract → red; malformed → fail closed
node .github/skills/func-verdict/verdict.mjs "$tmp/c-green.json" redline-dashboard "$tmp/v-green.json"
Assert ($LASTEXITCODE -eq 0) 'verdict green exits 0'
$v = Get-Content "$tmp/v-green.json" -Raw | ConvertFrom-Json
Assert ($v.overall_verdict -eq 'green' -and $v.summary_line -like 'GREEN*') 'green verdict'
node .github/skills/func-verdict/verdict.mjs "$tmp/c-red.json" redline-dashboard "$tmp/v-red.json"
$v = Get-Content "$tmp/v-red.json" -Raw | ConvertFrom-Json
Assert ($v.overall_verdict -eq 'red' -and $v.failing_tests.Count -eq 1) 'red verdict'
node .github/skills/func-verdict/verdict.mjs "$fx/crash.json" redline-dashboard "$tmp/v-c.json"
Assert ($LASTEXITCODE -eq 1) 'verdict fails closed on malformed contract'

Write-Host ''
if ($script:Failures -gt 0) { Write-Host "FUNC CHECK FAILED ($script:Failures)" -ForegroundColor Red; exit 1 }
Write-Host 'FUNC CHECK PASSED' -ForegroundColor Green; exit 0
```

- [ ] **Step 3: Run it — verify it fails (parse.mjs missing)**

Run: `powershell -File tests/func-contract-check.ps1`
Expected: FAIL — node cannot find `parse.mjs`. Exit 1.

- [ ] **Step 4: Write `parse.mjs`**

`.github/skills/parse-playwright-summary/parse.mjs`:

```js
#!/usr/bin/env node
// parse-playwright-summary — Playwright JSON reporter → canonical contract.json.
// Usage: node parse.mjs <results.json> <run_id> <out-contract.json>
// Fails closed: any structural problem exits 1 with "FAILED — <reason>" on stderr.
import { readFileSync, writeFileSync } from "node:fs";

const [resultsPath, runId, outPath] = process.argv.slice(2);
const fail = (r) => { console.error(`FAILED — ${r}`); process.exit(1); };
if (!resultsPath || !runId || !outPath) fail("usage: parse.mjs <results.json> <run_id> <contract.json>");

let raw;
try { raw = JSON.parse(readFileSync(resultsPath, "utf8")); }
catch (e) { fail(`unreadable or invalid JSON: ${e.message}`); }
const s = raw.stats;
if (!s || typeof s.expected !== "number" || typeof s.unexpected !== "number")
  fail("not a Playwright JSON report (stats missing)");

const failures = [];
const walk = (suite, path) => {
  for (const child of suite.suites ?? []) walk(child, [...path, child.title]);
  for (const spec of suite.specs ?? [])
    for (const t of spec.tests ?? []) {
      if (t.status === "unexpected" || t.status === "flaky")
        failures.push({
          test: [...path, spec.title].filter(Boolean).join(" > "),
          file: spec.file ?? suite.file ?? "",
          error: (t.results?.[0]?.error?.message ?? "").split("\n")[0],
        });
    }
};
for (const suite of raw.suites ?? []) walk(suite, [suite.title]);

const flaky = s.flaky ?? 0; // retries are 0 by convention; count any flaky as failed, defensively
const contract = {
  run_id: runId,
  suite: "functional",
  started_at: s.startTime ?? "",
  duration_s: Math.round((s.duration ?? 0) / 100) / 10,
  tests_total: s.expected + s.unexpected + (s.skipped ?? 0) + flaky,
  passed: s.expected,
  failed: s.unexpected + flaky,
  skipped: s.skipped ?? 0,
  failures,
};
if (contract.tests_total === 0) fail("zero tests found — refusing to report an empty run");
writeFileSync(outPath, JSON.stringify(contract, null, 2));
console.log(`OK — ${contract.passed}/${contract.tests_total} passed, ${contract.failed} failed`);
```

- [ ] **Step 5: Write the SKILL.md**

`.github/skills/parse-playwright-summary/SKILL.md`:

````markdown
# parse-playwright-summary
> Normalize a Playwright JSON report into the canonical functional contract shape.

**Type:** skill (deterministic, no model call — thin wrapper over `parse.mjs`) · **Used by:** func-run-one, corroborate-2-sources · **Status:** LIVE (2026-07-08)

---

## Prompt

You will normalize a raw Playwright JSON report. There is no judgment here — run the script:

```
node .github/skills/parse-playwright-summary/parse.mjs reports/<run_id>/results.json <run_id> reports/<run_id>/contract.json
```

- Exit 0 → contract written; report the script's `OK — …` line.
- Exit 1 → the run is FAILED. Report the script's `FAILED — <reason>` line and STOP.
  Fails-closed cases: missing/invalid JSON, missing `stats` (not a Playwright report), zero tests found.

### Contract shape (what the script writes)

```json
{
  "run_id": "<string>", "suite": "functional",
  "started_at": "<ISO or empty>", "duration_s": <number>,
  "tests_total": <n>, "passed": <n>, "failed": <n>, "skipped": <n>,
  "failures": [ { "test": "<suite > spec title>", "file": "<spec file>", "error": "<first line>" } ]
}
```

`flaky` results count as failed (retries are 0 by convention — flake detection is
corroborate-2-sources' job, never Playwright retries).

---

## Tools

Bash (`node`), Read — no MCP, no model calls.

## Data

- Reads: `reports/<run_id>/results.json`
- Writes: `reports/<run_id>/contract.json`

## Hard rules

1. Never hand-parse the report — the script is the parser; its fixtures live in `tests/fixtures/functional/`.
2. Fails closed — a malformed report is a FAILED run, never an empty-green contract.
3. Behavior check: `powershell -File tests/func-contract-check.ps1`.
````

- [ ] **Step 6: Run the check — parse assertions pass, verdict ones still fail**

Run: `powershell -File tests/func-contract-check.ps1`
Expected: all `parse *` assertions PASS; `verdict *` assertions FAIL (verdict.mjs not yet written). Exit 1.

- [ ] **Step 7: Commit**

```bash
git add .github/skills/parse-playwright-summary/ tests/fixtures/functional/ tests/func-contract-check.ps1
git commit -m "feat: parse-playwright-summary skill with fixture-proven fails-closed parser"
```

---

### Task 5: `func-verdict` skill

**Files:**
- Create: `.github/skills/func-verdict/verdict.mjs`
- Create: `.github/skills/func-verdict/SKILL.md`

**Interfaces:**
- Consumes: `contract.json` (Task 4 shape).
- Produces: `reports/<run_id>/verdict.json`:
  `{ run_id, suite: "functional", overall_verdict: "green"|"red", tests_total, passed, failed, failing_tests: [{ test, file, error }], summary_line }`
- CLI: `node .github/skills/func-verdict/verdict.mjs <contract.json> <team> <out-verdict.json>` — exit 0 = verdict written (green AND red are both exit 0; the workflow branches on file content); exit 1 = fails closed.

- [ ] **Step 1: Write `verdict.mjs`**

```js
#!/usr/bin/env node
// func-verdict — contract.json → verdict.json (green | red). Crashes never reach
// this step (run-playwright-suite STOPs at O1); still fails closed on malformed input.
// Usage: node verdict.mjs <contract.json> <team> <out-verdict.json>
import { readFileSync, writeFileSync } from "node:fs";

const [contractPath, team, outPath] = process.argv.slice(2);
const fail = (r) => { console.error(`FAILED — ${r}`); process.exit(1); };
if (!contractPath || !team || !outPath) fail("usage: verdict.mjs <contract.json> <team> <verdict.json>");

let c;
try { c = JSON.parse(readFileSync(contractPath, "utf8")); }
catch (e) { fail(`unreadable contract: ${e.message}`); }
if (typeof c.tests_total !== "number" || typeof c.failed !== "number" || !Array.isArray(c.failures))
  fail("malformed contract (tests_total/failed/failures missing)");
if (c.tests_total === 0) fail("zero-test contract — cannot verdict an empty run");

const verdict = c.failed > 0 ? "red" : "green";
const summary_line = verdict === "green"
  ? `GREEN — ${c.passed}/${c.tests_total} tests passed (${team} functional)`
  : `RED — ${c.failed}/${c.tests_total} tests failed: ${c.failures.map(f => f.test).join(", ")} (${team} functional)`;

writeFileSync(outPath, JSON.stringify({
  run_id: c.run_id, suite: "functional", overall_verdict: verdict,
  tests_total: c.tests_total, passed: c.passed, failed: c.failed,
  failing_tests: c.failures, summary_line,
}, null, 2));
console.log(summary_line);
```

- [ ] **Step 2: Run the full check — everything passes**

Run: `powershell -File tests/func-contract-check.ps1`
Expected: `FUNC CHECK PASSED`, exit 0.

- [ ] **Step 3: Write the SKILL.md**

````markdown
# func-verdict
> Map a functional contract to green | red — the two-verdict rule, pass/fail edition.

**Type:** skill (deterministic, no model call — thin wrapper over `verdict.mjs`) · **Used by:** func-run-one, corroborate-2-sources · **Status:** LIVE (2026-07-08)

---

## Prompt

Run the script — no judgment:

```
node .github/skills/func-verdict/verdict.mjs reports/<run_id>/contract.json <team> reports/<run_id>/verdict.json
```

- Exit 0 → verdict written (both green and red exit 0 — branch on `overall_verdict` in the file).
- Exit 1 → FAILED (malformed or zero-test contract). Report `FAILED — <reason>`, STOP.

Verdict rule (hard rule 6, functional edition): `failed == 0` → **green**; `failed > 0` → **red**.
There is no amber, no threshold, no baseline file — k6 owns performance numbers.

---

## Tools

Bash (`node`), Read — no MCP, no model calls.

## Data

- Reads: `reports/<run_id>/contract.json`
- Writes: `reports/<run_id>/verdict.json`

## Hard rules

1. No baselines for functional suites — by design (see `baselines/README.md`).
2. Fails closed on malformed/zero-test contracts.
3. Behavior check: `powershell -File tests/func-contract-check.ps1`.
````

- [ ] **Step 4: Commit**

```bash
git add .github/skills/func-verdict/
git commit -m "feat: func-verdict skill — deterministic green/red for functional runs"
```

---

### Task 6: Extend `corroborate-2-sources` for functional runs

**Files:**
- Modify: `.github/skills/corroborate-2-sources/SKILL.md`

**Interfaces:**
- Consumes: `run-playwright-suite` with `extra_args: --last-failed` (Task 3), parse + verdict CLIs (Tasks 4–5).
- Produces: same output JSON as today (`corroborated`, `sources`, `confirm_run_id`, `confirm_verdict`, `confirm_summary_line`, `reason`) — callers need no change.

- [ ] **Step 1: Update the header line**

Change `**Used by:** perf-run-one, perf-sweep` to `**Used by:** perf-run-one, perf-sweep, func-run-one`.

- [ ] **Step 2: Insert a functional branch after step 3 of the Prompt**

Add this block immediately after the existing step 3 (the k6 re-execution list), before step 4:

```markdown
**Functional runs** (parent `verdict.json` has `"suite": "functional"`): step 3 re-executes
the functional O1–O3 chain instead, re-running **only the failed tests**:

- `run-playwright-suite` with `extra_args: --last-failed` → `reports/<run_id>_confirm/results.json`
  (`--last-failed` needs Playwright ≥ 1.44 and reads `test-results/.last-run.json` from the
  parent run — run from the repo root, before any other suite executes, or the marker is stale)
- `node .github/skills/parse-playwright-summary/parse.mjs … <run_id>_confirm …` → `contract.json`
- `node .github/skills/func-verdict/verdict.mjs …` → `verdict.json`

The verdict table (step 4) applies unchanged: red/red → `sources: 2`; red/green → flake;
red/fail → cannot corroborate. `no-baseline` cannot occur for functional runs.
```

- [ ] **Step 3: Extend the hard rules**

Append one bullet:

```markdown
- **Functional confirm re-runs only the failures** (`--last-failed`) — a passing test that
  passed again adds no information; the failed set is the signal being corroborated.
```

And in the "identical script + baseline shas" rule, append: `For functional runs the "script sha" is the suite hash (config + specs — see run-ledger); the no-baseline sha is constant by design.`

- [ ] **Step 4: Verify doc consistency**

Run: `powershell -File tests/smoke.ps1`
Expected: no regressions (same failures as before this task, none new).

- [ ] **Step 5: Commit**

```bash
git add .github/skills/corroborate-2-sources/SKILL.md
git commit -m "feat: corroborate-2-sources learns functional re-runs via --last-failed"
```

---

### Task 7: Extend `run-ledger` (suite field) + schema doc + filing dedupe

**Files:**
- Modify: `.github/skills/run-ledger/SKILL.md`
- Modify: `state/README.md`
- Modify: `.github/skills/file-perf-regression-jira/SKILL.md` (one line)

**Interfaces:**
- Produces: schema v1.1 — `suite: "k6" | "functional"` (absent = k6). Functional records: `endpoints: []` allowed; require `tests_total`, `passed`, `failed`; red also requires `failures[]` (the contract's array). 3-strikes streak for functional keys on `team + profile + failures[0].test`.

- [ ] **Step 1: Extend CHECK in `run-ledger/SKILL.md`**

In Entry point A inputs, after `script_path`, add:

```markdown
- `suite` — `"k6"` (default when absent) | `"functional"`. For functional runs `script_path`
  is the suite directory (e.g. `live/redline-dashboard/functional`); `script_sha` is the
  SHA-256 of the concatenation of `playwright.config.ts` + every `tests/*.spec.ts` sorted
  by path (a spec fix → new sha → new dedupe_key → run re-arms). `baseline_path` is omitted:
  use the empty-string SHA-256 and note `no-baseline-by-design`.
```

- [ ] **Step 2: Extend WRITE validation**

In Entry point B step 2 (validate), change the `endpoints[]` bullet to:

```markdown
- `endpoints[]` — must be a non-empty array on green/red **for k6 records**. For
  `suite: "functional"` records `endpoints: []` is valid; instead `tests_total`, `passed`,
  `failed` must be present, and red records must carry `failures[]` (name/file/error) —
  the 24h Jira dedupe and 3-strikes streak key on `failures[0].test` for functional.
```

- [ ] **Step 3: Document schema v1.1 in `state/README.md`**

After the v1 record example, append:

```markdown
### v1.1 additions (2026-07-08 — functional suite)

- `suite`: `"k6" | "functional"` — absent means `"k6"` (all pre-2026-07-08 lines).
- Functional records: `endpoints` may be `[]`; instead `tests_total` / `passed` / `failed`
  are required, plus `failures[]` (`{test, file, error}`) on red. `iterations` does not
  apply and is omitted. Example:

```jsonc
{ "schema": "v1", "suite": "functional",
  "run_id": "redline-dashboard_functional_local_20260708T150000Z",
  "workflow": "func-run-one", "team": "redline-dashboard", "profile": "functional",
  "env": "local", "trigger": "manual", "tests_total": 8, "passed": 8, "failed": 0,
  "endpoints": [], "overall_verdict": "green", "...": "remaining v1 fields unchanged" }
```
```

- [ ] **Step 4: Generalize the filing dedupe line**

In `.github/skills/file-perf-regression-jira/SKILL.md`, find the 24h de-dupe gate wording ("team + endpoint") and extend it to: `team + endpoint name (k6) or first failing test name (functional) — both read from the ledger record (endpoints[0].name / failures[0].test)`.

- [ ] **Step 5: Commit**

```bash
git add .github/skills/run-ledger/SKILL.md state/README.md .github/skills/file-perf-regression-jira/SKILL.md
git commit -m "feat: ledger schema v1.1 — suite field + functional record shape"
```

---

### Task 8: `triage-func-verdict` skill

**Files:**
- Create: `.github/skills/triage-func-verdict/SKILL.md`

**Interfaces:**
- Consumes: `verdict.json` + `contract.json` (Tasks 4–5 shapes), corroboration output (Task 6).
- Produces: `reports/<run_id>/jira-draft.md` (Jira wiki markup) — consumed verbatim by `file-perf-regression-jira` and reviewed by `reviewer`.

- [ ] **Step 1: Write the SKILL.md**

````markdown
# triage-func-verdict
> Draft Jira ticket text for a red functional verdict — 1 AI narration line + deterministic template.

**Type:** skill (1 model narration) · **Used by:** func-run-one · **Status:** LIVE (2026-07-08)

---

## Prompt

You will draft a Jira regression ticket for a red functional verdict. Follow these steps exactly.

### 1 — Read inputs

**Inputs** (passed by the workflow): `run_id`, `confirm_run_id` (from O4).

Read: `reports/<run_id>/verdict.json`, `reports/<run_id>/contract.json`.

### 2 — Write ONE narration line (model call)

Exactly one sentence describing what broke. Rules:
- Neutral tone. No blame, no root-cause guessing.
- Name the failing test(s), the first error line, team, and env.
- Example: "The wizard's 'creates a team' flow fails on redline-dashboard local as of
  2026-07-08 — expect(locator).toBeVisible() failed on the team-slug input."

### 3 — Assemble the draft ticket (Jira wiki markup — NOT markdown)

```
h2. Functional Regression — Auto-detected

Team: <team>
Env: <env>
Run ID: <run_id>
Suite: functional (Playwright)
Verdict: red
Date: <started_at from contract, date part only>
Summary: [NARRATION]

h3. Failing tests

| Test | File | Error |
| <failing_tests[].test> | <file> | <error> |

h3. Run stats

- Tests: <passed>/<tests_total> passed, <failed> failed, <skipped> skipped
- Corroborated: sources=2 (confirmation run <confirm_run_id> also red)

h3. Links

- Run ledger: state/run-ledger.jsonl (filter run_id=<run_id>)

h3. Action required

Human review required before this ticket is filed. Route to reviewer subagent next.
```

All fields except `[NARRATION]` are deterministic — copy values verbatim, no invention.

### 4 — Write output

Write to `reports/<run_id>/jira-draft.md`. Return
`{ "draft_path": "reports/<run_id>/jira-draft.md", "narration": "<the sentence>" }`.

---

## Tools

Read and Write only — one model narration call, no MCP.

## Data

- Reads: `reports/<run_id>/verdict.json`, `reports/<run_id>/contract.json`
- Writes: `reports/<run_id>/jira-draft.md`

## Hard rules

1. **Exactly one model narration line** — the rest is templated from the data.
2. **Draft only** — `file-perf-regression-jira` is the separate human-gated filing step.
3. **Only runs on corroborated red verdicts** — green never reaches this skill.
4. Never quote latency numbers — performance is k6's jurisdiction.
````

- [ ] **Step 2: Verify smoke**

Run: `powershell -File tests/smoke.ps1`
Expected: `PASS  skill: triage-func-verdict`.

- [ ] **Step 3: Commit**

```bash
git add .github/skills/triage-func-verdict/
git commit -m "feat: triage-func-verdict skill (1-narration Jira draft for functional reds)"
```

---

### Task 9: `spec-author` subagent + AGENTS.md 2→3

**Files:**
- Create: `.github/agents/spec-author.agent.md`
- Modify: `AGENTS.md:15,22-26,63-77`

**Interfaces:**
- Consumes: flow map + locator inventory from `explore-product-structure`.
- Produces: DRAFT `drafts/<team>/functional/playwright.config.ts` + `tests/*.spec.ts`. Consumed by `verify-playwright-suite` (Task 10) and `func-author` (Task 11).

- [ ] **Step 1: Write the agent file**

````markdown
---
name: spec-author
description: "Generate a Playwright functional suite from a live-explored flow map."
allowedTools:
  - Read
  - Write
model: opus
---

# spec-author

> **Status: LIVE (2026-07-08).** The third subagent (others: `reviewer`, `script-author`).

## Justification (why this earns a model call)

Earns it by **(a) generation + large-context isolation** — the same clause as `script-author`.
Turning a flow map + live-confirmed locator inventory into a coherent multi-spec Playwright
suite is genuinely generative language work, and the map + inventory + conventions are verbose
enough to pollute the orchestrator's window.

**Only the generative step is the subagent.** Exploration (`explore-product-structure`),
scope approval (`scope-review`), verification (`verify-playwright-suite`), graduation and
delivery are deterministic skills the `func-author` workflow owns.

## Prompt

Given the **flow map and locator inventory** (from `explore-product-structure` — locators
confirmed against the live DOM, never guessed), generate a functional suite:

- `playwright.config.ts` — `testDir: './tests'`, **`retries: 0`** (flake detection is the
  workflow's corroborate gate, never Playwright retries), `reporter: 'line'`, and a
  `webServer` block when the app is locally startable (command + port + `reuseExistingServer`).
- `tests/*.spec.ts` — organized by flow (e.g. `happy-path.spec.ts`, `validation.spec.ts`).

Conventions (non-negotiable):
- `getByRole()` / `getByLabel()` / `getByText()` over CSS selectors.
- Tests independent — no shared state; `beforeEach` for setup.
- Names read like requirements: `test('creates a team and shows the confirmation card')`.
- `await expect()` on outcomes, not implementation details. One behavior per test.
- **Use ONLY locators present in the inventory.** If a flow lacks confirmed locators,
  stop and say so rather than inventing.

Output is a **DRAFT suite only** (write to the drafts path the workflow hands you).
**Never commit, never push, never write inside `live/*`.**

## Tools

`Read`, `Write` — a narrow allowlist (no Bash, no MCP; the live pass already happened
upstream, verification happens downstream).

## Data

- Reads: the flow map / locator inventory the workflow passes; `live/*/functional/` as
  read-only exemplars once the first suite is graduated.
- Writes: `drafts/<team>/functional/` only.
````

- [ ] **Step 2: Update AGENTS.md**

Three edits:
1. In the building-blocks table, change the Subagent row description from "Only **2** qualify." to "Only **3** qualify."
2. Retitle the section "## The 2 subagents (the only model loops)" to "## The 3 subagents (the only model loops)" and append a third bullet:

```markdown
- **`spec-author`** — generative authoring of a new Playwright functional suite (added
  2026-07-08 with the functional suite). Same justification clause as `script-author`:
  generation + large-context isolation. Only the generative step; explore / scope /
  verify / graduate are deterministic skills owned by `func-author`.
```

3. In the "5 → 2 subagent collapse" section, append after the table:

```markdown
2026-07-08: the functional (Playwright) suite added `spec-author` as a third subagent —
the same generation clause `script-author` passed, applied to a second test type. The
collapse discipline holds: running suites, parsing reports, and verdicts all landed as
deterministic skills (`run-playwright-suite`, `parse-playwright-summary`, `func-verdict`).
```

- [ ] **Step 3: Verify smoke**

Run: `powershell -File tests/smoke.ps1`
Expected: `PASS  .github/agents/spec-author.agent.md`.

- [ ] **Step 4: Commit**

```bash
git add .github/agents/spec-author.agent.md AGENTS.md
git commit -m "feat: spec-author subagent — 3rd justified model loop (functional generation)"
```

---

### Task 10: `verify-playwright-suite` skill

**Files:**
- Create: `.github/skills/verify-playwright-suite/SKILL.md`

**Interfaces:**
- Consumes: DRAFT suite in `drafts/<team>/functional/` (Task 9).
- Produces: a verified suite (edits in place) + PASS/FAIL result consumed by `func-author` step 4.

- [ ] **Step 1: Write the SKILL.md**

````markdown
# verify-playwright-suite
> Validate → run → fix a drafted functional suite. Bounded rounds; flakes recorded, never chased.

**Type:** skill (MODEL bounded — ≤3 fix rounds) · **Used by:** func-author · **Status:** LIVE (2026-07-08)

---

## Prompt

You will verify a drafted Playwright suite in `drafts/<team>/functional/`. Hard cap:
**3 fix rounds**, then stop.

### 1 — Run

```
npx playwright test -c drafts/<team>/functional/playwright.config.ts --reporter=line
```

All pass → return PASS with the summary line. Done.

### 2 — Corroborate before fixing (zero-token gate)

Any failure: re-run only the failures once — `npx playwright test -c <config> --last-failed --reporter=line`.
- Re-run passes → **flake**. Record it (test name + both outcomes) for the final report.
  During authoring a flaky test is a defect of the test: rewrite the wait/assertion to be
  deterministic — that rewrite counts as a fix round.
- Re-run fails → real failure → fix round.

### 3 — Fix round (≤3 total)

1. Read the failure output (expected vs actual, failing locator, page snippet).
2. Cause unclear → live Playwright MCP pass on the failing flow only:
   `browser_navigate` → `browser_snapshot` (accessibility tree) → `browser_click` to confirm
   the locator before writing it into the spec. (Shadow DOM: snapshot pierces it; prefer
   role/label locators which also pierce.)
3. Categorize explicitly: **test bug** (wrong locator, timing, wrong expectation) → fix the
   spec. **App bug** → STOP, report it — func-author's scope gate decides; authoring never
   silently patches the app.
4. Edit → re-run (step 1). One cycle per round.

### 4 — Exhaustion `[HUMAN]`

Still failing after round 3 → return FAIL with: failing tests, root cause per test,
test-bug/app-bug label, and what was tried. A human decides next.

---

## Tools

Bash (`npx playwright test`), Read, Write, Edit, Playwright MCP (`browser_navigate`,
`browser_snapshot`, `browser_click`, `browser_evaluate`) — no jira/slack/github.

## Data

- Reads/edits: `drafts/<team>/functional/` only — never `live/`.
- Writes: nothing outside the drafts suite.

## Hard rules

1. **3 rounds maximum.** Round 4 does not exist.
2. **Flakes are recorded, never dropped** — and during authoring, a flaky test gets rewritten, not retried.
3. **App bugs stop the loop** — verification fixes tests, not the product.
4. `retries: 0` stays `0` — never "fix" a failure by adding retries.
````

- [ ] **Step 2: Verify smoke**

Run: `powershell -File tests/smoke.ps1`
Expected: `PASS  skill: verify-playwright-suite`.

- [ ] **Step 3: Commit**

```bash
git add .github/skills/verify-playwright-suite/
git commit -m "feat: verify-playwright-suite skill (bounded 3-round authoring fix loop)"
```

---

### Task 11: `func-author` workflow

**Files:**
- Create: `.claude/workflows/func-author/workflow.md`

**Interfaces:**
- Consumes: skills from Tasks 3–10 by exact registry name.
- Produces: a graduated suite in `live/<team>/functional/` — the input `func-run-one` runs.

- [ ] **Step 1: Write the workflow.md**

````markdown
# func-author — Workflow Recipe

**Type:** CORE workflow #3 ("write a new functional suite") / **Trigger:** manual · dashboard wizard / **Status: LIVE (2026-07-08)**

A recipe is a fixed, ordered sequence of skills (`.github/skills/`, character-exact names).
`[DET]` = deterministic, zero tokens. `[MODEL]` = earns a model call. `[MODEL grounded]` =
model call grounded in live tools. `[MODEL bounded]` = hard round limit. `[HUMAN]` = human gate.
★ = subagent. Doctrine source: perf-author / perf-run-one.

**Entry:** `resolve-entry-mode` — one question: `author-first | run-existing`.
(No `api | browser` fork — a functional suite is always browser-driven; k6 owns API perf.)
`run-existing` short-circuits to `func-run-one`.

## Steps (recipe)

0. [HUMAN] `resolve-entry-mode` — `author-first | run-existing`
1. [MODEL grounded] `explore-product-structure` — live Playwright MCP pass: confirm the flows
   work now, build the locator inventory (locators that actually resolve), observe
   async/loading/redirect states
2. [DET] `scrub-har-secrets` — only if a HAR was captured during exploration
3. [MODEL] ★ `spec-author` (SUBAGENT) — generate `playwright.config.ts` (retries: 0,
   webServer) + `tests/*.spec.ts` from the inventory → `drafts/<team>/functional/`
3a. [HUMAN] `scope-review` — agent presents flows covered, exclusions, auth handling,
   open questions; human confirms or redirects. **No verify rounds are spent until scope
   is approved.**
4. [MODEL bounded] `verify-playwright-suite` — run → corroborate failures → fix (≤3 rounds;
   app bugs stop the loop)
5. [DET] `graduate-script` — copy proven `drafts/<team>/functional/` →
   `live/<team>/functional/`; extend the pre-commit `live/` allow-list if needed.
   **Building phase only** — replaced by `open-draft-pr` when GitHub MCP (P5) is wired.
6. [DET] `open-draft-pr` — P5+; skipped in building phase (graduation IS delivery)

## Branching / gates

- **Scope gate [HUMAN] — step 3a:** flows, exclusions, auth placement. Redirected → revise
  and re-present before any verify round.
- **App-bug gate:** `verify-playwright-suite` stops on app bugs — authoring never patches
  the product silently.
- **Close-out:** graduation + `run-ledger` WRITE (`suite: "functional"`, authoring record)
  close the recipe.

## Model-call budget

**1 model call** (`spec-author`) **+ 2 bounded grounded helpers** (`explore-product-structure`,
`verify-playwright-suite`). Everything else is [DET]. Human gates: entry (0), scope (3a).

---

Skills referenced live in `.github/skills/`. Design: `docs/superpowers/specs/2026-07-08-playwright-functional-suite-design.md`.
````

- [ ] **Step 2: Verify smoke**

Run: `powershell -File tests/smoke.ps1`
Expected: `PASS  workflow: func-author`.

- [ ] **Step 3: Commit**

```bash
git add .claude/workflows/func-author/
git commit -m "feat: func-author workflow — functional twin of perf-author"
```

---

### Task 12: `func-run-one` workflow

**Files:**
- Create: `.claude/workflows/func-run-one/workflow.md`

**Interfaces:**
- Consumes: every functional skill (Tasks 3–8) + shared spine (`run-ledger`, `corroborate-2-sources`, `reviewer`, `file-perf-regression-jira`, `notify-responsible-team`).
- Produces: ledger records, PASS proofs, corroborated Jira drafts.

- [ ] **Step 1: Write the workflow.md**

````markdown
# Workflow: func-run-one

**Type:** Core workflow #4 — "run + judge", functional edition / **Trigger:** manual · dashboard · cron (later) / **Status: LIVE (2026-07-08)**

Labels as in perf-run-one: `[DET]` deterministic · `[MODEL]` earns a model call · ★ subagent.

## Inputs

```
team      — e.g. "redline-dashboard"
env       — "local" | "stg"        (PROD is forbidden for functional suites — hard rule)
run_id    — e.g. "redline-dashboard_functional_local_20260708T143022Z"
trigger   — "cron" | "deploy" | "manual"
deploy_sha — (deploy trigger only)
```

`profile` is always `functional` — it fills the profile slot in run_id, ledger, and dedupe key.

## O0 — idempotency gate

- **[DET] run-ledger (CHECK mode)** — `suite: "functional"`; `script_sha` = suite hash
  (config + sorted specs, see run-ledger SKILL). `action=skip` → return prior result, STOP.
  `action=fail` → invalid path, STOP. Else carry `dedupe_key` + shas forward.

## Steps (recipe)

1. **[DET] run-playwright-suite** — path guard (`live/` only), prod-gate (reject), run
   `npx playwright test --reporter=json` → `reports/<run_id>/results.json`.
   Crash (exit ∉ {0,1} or results.json missing) → `run-error.txt`, ledger FAILED, STOP.
2. **[DET] parse-playwright-summary** — `parse.mjs` → `reports/<run_id>/contract.json`.
   Fails closed → ledger FAILED, STOP.
3. **[DET] func-verdict** — `verdict.mjs` → `reports/<run_id>/verdict.json` (green | red).
4. **[DET] corroborate-2-sources** — red only: ONE re-run of the failures (`--last-failed`)
   as `<run_id>_confirm` (bypasses O0 — result lives in the parent record).
   Confirm green → FLAKE, STOP. Confirm fail → cannot corroborate, STOP. Confirm red →
   `sources: 2`, continue.
5. **[MODEL] triage-func-verdict** — one narration line + templated draft → `jira-draft.md`.
6. **[MODEL] ★ reviewer** — spawned in a **fresh context** (anti-anchoring). Reads verdict +
   contract + draft **for BOTH runs** (`reports/<run_id>/`, `reports/<run_id>_confirm/`);
   re-derives the verdict from raw pass/fail counts (Pass 1); independent quality judgment —
   is this failure worth a human's time (Pass 2); ticket quality (Pass 3). Writes
   `reviewer-decision.json` with `sources` copied from O4.
7. **[DET] file-perf-regression-jira** — same four gates: verdict ≠ green → SIGN_OFF →
   `sources ≥ 2` → 24h de-dupe (functional: `failures[0].test`). Default `mode=dry-run`;
   `mode=file` only on explicit per-draft human approval (hard rule).
8. **[DET] notify-responsible-team** — only after a real `filed:` result.

(No `link-grafana-panel` — functional runs don't export OTLP in v1; slot reserved.
No `curate-baselines` — functional has no baselines by design.)

## Live path

```
GREEN → print "GREEN — <summary_line>" + ledger record. STOP.
RED   → O4 corroborate (ONE confirmation re-run, failures only)
          → confirm green  → print "FLAKE — original red not reproduced (<both summary lines>)"
                             → ledger (overall_verdict=red, corroborated=false, sources=1,
                               consecutive_rejects += 1 — same-test flakes hit the 3-strikes
                               escalation like reviewer REJECTs do). STOP.
          → confirm crashed → print "CONFIRM CRASHED — infra issue" → ledger
                               (corroborated=false, confirm_verdict="crashed"). STOP.
          → confirm red (sources=2):
        → O5 triage-func-verdict → jira-draft.md
        → O6 reviewer (fresh context, .github/agents/reviewer.agent.md)
          → SIGN_OFF:        ledger (jira_filed=false, jira_draft=path). STOP (human files).
          → REJECT:          ledger (reviewer_decision=REJECT, streak += 1). STOP.
                             3-strikes: ≥3 consecutive REJECTs/flakes on the same test →
                             reviewer must treat it as real (persistent failure is signal).
          → REQUEST_CHANGES: re-run O5+O6 once (max 1 retry, budget +2) → ledger. STOP.
FAIL  → print "FAIL — <reason>" + ledger record. STOP.
```

## Model-call budget

**2** — `triage-func-verdict` (1 narration line) + `reviewer` (dual-pass). Everything else [DET].

---

Skills referenced live in `.github/skills/`. Design: `docs/superpowers/specs/2026-07-08-playwright-functional-suite-design.md`.
````

- [ ] **Step 2: Verify smoke — the full registry now passes**

Run: `powershell -File tests/smoke.ps1`
Expected: `SMOKE PASSED`, exit 0 (all Task-2 additions now exist).

- [ ] **Step 3: Commit**

```bash
git add .claude/workflows/func-run-one/
git commit -m "feat: func-run-one workflow — functional twin of perf-run-one"
```

---

### Task 13: Doc repositioning (full QA identity)

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `PRODUCT.md`, `baselines/README.md`

**Interfaces:**
- Consumes: everything built in Tasks 1–12 (docs must describe reality, not plans).

- [ ] **Step 1: CLAUDE.md identity + rules**

Exact edits:
1. Title: `# perf-eng-agent — system prompt & rulebook` → `# RedLine qa-eng-agent — system prompt & rulebook`
2. Identity sentence: `You are the **Performance Engineering agent** — a universal performance-engineering agent usable by any company.` → `You are the **QA Engineering agent** — a universal QA agent usable by any company, running two suites on one spine: **functional (Playwright)** and **performance (k6)**.`
3. In the file-tree block, extend the workflows line to include `func-author · func-run-one` and add under skills a line: `run-playwright-suite · parse-playwright-summary · func-verdict · verify-playwright-suite · triage-func-verdict (functional)`.
4. Hard rule 2: append `Functional (Playwright) suites never run on PROD in v1 — no carve-out.`
5. Hard rule 6: append `Functional verdict: all tests pass = green; any corroborated failure = red — same two verdicts, pass/fail edition.`
6. Hard rule 3: append to the demo-web exception sentence: `The same carve-out applies to live/redline-dashboard/ (functional pilot).`
7. Pilot scope section: append one paragraph: `Functional pilot (2026-07-08): team redline-dashboard — the RedLine dashboard itself (local, no SSO). Suites live in live/redline-dashboard/functional/; no real team gets a functional suite until this pilot passes and a human signs off.`

- [ ] **Step 2: README.md + PRODUCT.md intro repositioning**

In both files, find the opening description of the project and reposition: RedLine is a
**universal QA agent** — two suites, one spine (functional = Playwright, performance = k6);
performance content stays, gains a "Functional suite (2026-07-08)" subsection in README
listing the 2 workflows + 5 skills + spec-author with one line each (copy the one-line
quotes from each SKILL.md). Do not rewrite historical/phase sections.

- [ ] **Step 3: baselines/README.md**

Append:

```markdown
## Functional suites have no baselines (by design — 2026-07-08)

Playwright verdicts are pass/fail: all tests pass = green, any corroborated failure = red.
There is no `baselines/<team>.functional.json` and none should ever be created — latency
thresholds are k6's jurisdiction (`<team>.<profile>.json` as before).
```

- [ ] **Step 4: Verify with the existing consistency skill**

Run the `doc-consistency-check` skill (`.github/skills/doc-consistency-check/SKILL.md`) over CLAUDE.md / README.md / AGENTS.md / PRODUCT.md.
Expected: no contradictions (subagent count says 3 everywhere, workflows count matches, functional described consistently).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md PRODUCT.md baselines/README.md
git commit -m "docs: reposition RedLine as two-suite QA agent (functional + performance)"
```

---

### Task 14: Dashboard full redesign — two paths (impeccable)

**Files:**
- Modify: `dashboard/public/*` (HTML/CSS/JS), possibly `dashboard/server.mjs` routes
- Reference: `.github/skills/impeccable/SKILL.md` — follow its Setup steps exactly

**Interfaces:**
- Consumes: nothing from Tasks 1–13 at the UI layer (wiring is Task 15).
- Produces: redesigned dashboard whose Start screen forks **Functional | Performance**; all downstream screens live under one path. Task 16's pilot suite is authored against THIS UI.

- [ ] **Step 1: Run impeccable setup**

Run: `node .github/skills/impeccable/scripts/context.mjs --target dashboard`
Follow what it prints (PRODUCT.md/DESIGN.md). Read `reference/product.md` (app register — design serves the product). Read one representative file (`dashboard/public/app-theme-canvas.css`) for existing tokens.

- [ ] **Step 2: Invoke the impeccable skill, `craft` register, with this brief**

> Full redesign of the RedLine dashboard (`dashboard/public/`, served by `dashboard/server.mjs`, zero-dependency constraint — no npm packages in the dashboard itself). Two-path information architecture: the Start screen forks into exactly two cards — **Functional (Playwright)**: "does the app work" and **Performance (k6)**: "is it fast". Every existing screen (onboarding wizard, build-status views, results cards) moves under one of the two paths; the k6 flows keep their current behavior. Evolve the canvas/void themes rather than discarding them; keep the theme toggle working. Audience: project manager / tech lead (plain language, no perf jargon on the functional path).

- [ ] **Step 3: Acceptance criteria (verify each, live)**

Start `node dashboard/server.mjs --no-open`, then via Playwright MCP (`browser_navigate` → `browser_snapshot`):
- Start screen shows exactly 2 path cards (Functional / Performance) with plain-language descriptions.
- Performance path reaches the existing k6 wizard unchanged in function.
- Functional path reaches a wizard shell (wiring lands in Task 15 — a "coming online" state is acceptable here ONLY if Task 15 immediately follows; otherwise static form).
- Theme toggle switches canvas/void on both paths; body text contrast ≥ 4.5:1 (impeccable's own rule).
- `dashboard/` still has zero npm dependencies (`node dashboard/server.mjs` runs with no install).

- [ ] **Step 4: Screenshot proof**

Via Playwright MCP `browser_take_screenshot` of: Start screen, Functional path landing, Performance path landing (both themes for Start). Save under `docs/superpowers/specs/assets/2026-07-08-dashboard-redesign/`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/ docs/superpowers/specs/assets/
git commit -m "feat: dashboard full redesign — two-path IA (functional | performance)"
```

---

### Task 15: Wizard functional path wiring

**Files:**
- Modify: `dashboard/wizard.mjs`, `dashboard/server.mjs`, `dashboard/public/` (wizard screens)

**Interfaces:**
- Consumes: `func-author` (Task 11), `func-run-one` (Task 12), redesigned UI (Task 14).
- Produces: dashboard "Create the test" on the functional path spawns Claude Code headlessly running `func-author`; "First results" runs `func-run-one`.

- [ ] **Step 1: Locate the existing headless spawn**

Read `dashboard/wizard.mjs`; find the `claude -p` spawn used by the k6 path (search: `claude`). Reuse its process-spawn/stream plumbing — do not duplicate it; parameterize the prompt.

- [ ] **Step 2: Add the functional prompt variant**

The functional "Create the test" spawn passes this prompt (team/url/journey interpolated from wizard answers):

```
Run the func-author workflow (.claude/workflows/func-author/workflow.md) end to end for
team "<team>". Entry mode: author-first. App under test: <url>. The user journey, in the
user's own words: "<journey>". Explore the app live with Playwright MCP first, then have
spec-author draft drafts/<team>/functional/. Stop at the scope-review gate and print
the scope summary for human confirmation. Do not graduate without approval.
```

And "First results" spawns:

```
Run the func-run-one workflow (.claude/workflows/func-run-one/workflow.md) for team
"<team>", env "<env>", trigger "manual", run_id "<team>_functional_<env>_<UTC timestamp>".
Print the verdict summary line when done.
```

- [ ] **Step 3: Verify the plumbing without burning an authoring run**

Run: `node dashboard/server.mjs --no-open`; walk the functional wizard to the spawn point via Playwright MCP; confirm the spawn command assembles correctly (log it server-side; do not launch a real `claude -p` in this step — assert on the logged command string).
Expected: logged command contains `func-author` and the interpolated team.

- [ ] **Step 4: Commit**

```bash
git add dashboard/
git commit -m "feat: wizard functional path drives func-author/func-run-one headlessly"
```

---

### Task 16: Pilot suite — dogfood `func-author` on the dashboard

**Files:**
- Create (via workflow): `drafts/redline-dashboard/functional/playwright.config.ts` + `tests/*.spec.ts`
- Create (graduation): `live/redline-dashboard/functional/` (same files)
- Modify: `.githooks/pre-commit` (extend the `live/` write carve-out to `live/redline-dashboard/`)

**Interfaces:**
- Consumes: Tasks 11, 14 (suite is authored against the redesigned UI).
- Produces: the graduated pilot suite Task 17 runs.

- [ ] **Step 1: Execute `func-author` for real**

team=`redline-dashboard`, entry=author-first, app=`http://127.0.0.1:4242` (webServer: `node dashboard/server.mjs --no-open`, `reuseExistingServer: true`, `retries: 0`). Explore live via Playwright MCP; spec-author drafts to `drafts/redline-dashboard/functional/`. Target coverage (guide, human may redirect at scope gate): Start-screen fork renders both paths; functional wizard walk to spawn point; performance wizard first screen loads; theme toggle persists.

- [ ] **Step 2: `[HUMAN]` scope gate — STOP and present to Anton**

Present flows covered, exclusions, and open questions. **Do not proceed to verify until approved.**

- [ ] **Step 3: Verify (≤3 rounds)**

`verify-playwright-suite` on the drafts suite.
Expected: PASS — all tests green, flakes (if any) rewritten and listed.

- [ ] **Step 4: Graduate + pre-commit carve-out**

Copy `drafts/redline-dashboard/functional/` → `live/redline-dashboard/functional/`. Read `.githooks/pre-commit`; find the `live/` write-guard allow-list (demo-web carve-out) and add `live/redline-dashboard/`.
Run: `powershell -File tests/smoke.ps1` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add drafts/redline-dashboard/ live/redline-dashboard/ .githooks/pre-commit
git commit -m "feat: redline-dashboard functional pilot suite (authored via func-author)"
```

---

### Task 17: Pilot proofs — GREEN, FUNC-SIM-001 RED, FLAKE-SIM

**Files:**
- Create/remove (transient): `live/redline-dashboard/functional/tests/sim-red.spec.ts`, `sim-flake.spec.ts`
- Modify: `state/run-ledger.jsonl` (via run-ledger WRITE only)

**Interfaces:**
- Consumes: everything. This is the end-to-end evidence.

- [ ] **Step 1: GREEN run**

Execute `func-run-one`: team=`redline-dashboard`, env=`local`, trigger=`manual`, run_id=`redline-dashboard_functional_local_<UTC now>`.
Expected: `GREEN — N/N tests passed (redline-dashboard functional)`; ledger line with `suite:"functional"`, `overall_verdict:"green"`, `status:"done"`.

- [ ] **Step 2: FUNC-SIM-001 — corroborated red through the full chain**

Add `live/redline-dashboard/functional/tests/sim-red.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

// FUNC-SIM-001 — deliberately failing probe; remove after the simulation.
test("SIM-RED: heading that does not exist", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "THIS HEADING DOES NOT EXIST" }))
    .toBeVisible({ timeout: 2000 });
});
```

Execute `func-run-one` with run_id=`redline-dashboard_functional_local_FUNC-SIM-001`.
Expected chain: red → O4 confirm re-run (`--last-failed`) also red → `sources: 2` →
`triage-func-verdict` writes `jira-draft.md` (one narration line) → `reviewer` (fresh context)
writes `reviewer-decision.json` → `file-perf-regression-jira` dry-run prints payload, files
nothing → ledger line `corroborated:true, sources:2, jira_filed:false`.
Then delete `sim-red.spec.ts`.

- [ ] **Step 3: FLAKE-SIM — flake dies at the deterministic gate**

Add `live/redline-dashboard/functional/tests/sim-flake.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { existsSync, writeFileSync } from "node:fs";

// FLAKE-SIM — fails on first run, passes on the corroboration re-run; remove after.
test("SIM-FLAKE: fails once then passes", async () => {
  const marker = "test-results/.flake-marker";
  if (!existsSync(marker)) {
    writeFileSync(marker, "1");
    expect(1, "first run fails by design").toBe(2);
  }
  expect(1).toBe(1);
});
```

Execute `func-run-one` with run_id=`redline-dashboard_functional_local_FLAKE-SIM-001`.
Expected: red → confirm re-run passes → `FLAKE — original red not reproduced`; ledger
`corroborated:false, sources:1`; **zero model calls spent** (no triage, no reviewer).
Then delete `sim-flake.spec.ts` and the marker file.

- [ ] **Step 4: Final full verification**

Run: `powershell -File tests/smoke.ps1` → `SMOKE PASSED`.
Run: `powershell -File tests/func-contract-check.ps1` → `FUNC CHECK PASSED`.
Run: `npx playwright test -c live/redline-dashboard/functional/playwright.config.ts --reporter=line` → all pass.

- [ ] **Step 5: Commit the proofs**

```bash
git add state/run-ledger.jsonl reports/.gitignore 2>/dev/null
git commit -m "feat: functional pilot proven — GREEN, FUNC-SIM-001 (2-source red), FLAKE-SIM"
```

(`reports/` is gitignored/transient — only the ledger is durable evidence.)

---

## Post-plan (explicitly OUT of scope — YAGNI)

- Functional fleet workflows (`func-sweep` etc.) — after the pilot earns them.
- `run-playwright-action` CI gate — the deterministic-gate twin comes with a real team, not the pilot.
- OTLP export from functional runs / `link-grafana-panel` wiring — slot reserved.
- demo-web functional suite — **requires Anton's sign-off on the pilot first.**
