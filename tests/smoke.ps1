#requires -Version 5.1
<#
.SYNOPSIS
  perf-eng-agent scaffold smoke test  --  P0 scaffold.

.DESCRIPTION
  Asserts the runtime-repo scaffold exists and matches the FROZEN skill
  registry (WORKFLOWS.md §2). Local dev is PowerShell (Rev 2026-06-01), so
  this is the canonical smoke check.

  Prints PASS/FAIL per check and exits non-zero on any failure.

.EXAMPLE
  pwsh ./tests/smoke.ps1
#>

$ErrorActionPreference = 'Stop'

# Repo root = parent of this tests/ directory.
$RepoRoot = Split-Path -Parent $PSScriptRoot

$script:Failures = 0

function Test-Item {
    param(
        [Parameter(Mandatory)][string]$RelPath,
        [string]$Label
    )
    if (-not $Label) { $Label = $RelPath }
    $full = Join-Path $RepoRoot $RelPath
    if (Test-Path -LiteralPath $full) {
        Write-Host ("PASS  {0}" -f $Label) -ForegroundColor Green
    } else {
        Write-Host ("FAIL  {0}  (missing: {1})" -f $Label, $RelPath) -ForegroundColor Red
        $script:Failures++
    }
}

Write-Host "perf-eng-agent smoke test  (root: $RepoRoot)`n"

# --- Top-level docs + config ------------------------------------------------
Test-Item 'CLAUDE.md'
Test-Item 'AGENTS.md'
Test-Item 'README.md'
Test-Item '.claude/settings.json'
Test-Item '.mcp.json'
Test-Item 'package.json'
Test-Item 'tests/func-contract-check.ps1'
Test-Item 'tests/runs-api.test.mjs'
Test-Item 'dashboard/runs-lib.mjs'
Test-Item 'dashboard/public/runs.js'
Test-Item 'dashboard/public/util.js'
Test-Item 'dashboard/public/shell.js'
Test-Item 'dashboard/public/home.js'
Test-Item 'dashboard/public/tests.js'
Test-Item 'dashboard/public/insights.js'
Test-Item 'dashboard/public/agg.js'
Test-Item 'dashboard/public/charts.js'
Test-Item 'dashboard/public/range.js'
Test-Item 'tests/agg.test.mjs'
Test-Item 'tests/charts.test.mjs'
Test-Item 'tests/gate-hardening.test.mjs'

# --- Subagents (the two that earned a model call) ---------------------------
Test-Item '.github/agents/reviewer.agent.md'
Test-Item '.github/agents/script-author.agent.md'
Test-Item '.github/agents/spec-author.agent.md'

# --- The 9 workflows (2 perf core + 2 func core + 4 fleet + build-status) ---
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
foreach ($wf in $workflows) {
    Test-Item (".claude/workflows/{0}/workflow.md" -f $wf) ("workflow: {0}" -f $wf)
}

# --- The 36 expected skills (registry amended 2026-07-09: +author-resilient-playwright) ---
$skills = @(
    # 5 profiles
    'k6-profile-benchmark', 'k6-profile-load', 'k6-profile-stress',
    'k6-profile-soak', 'k6-profile-spike',
    # 9 operational
    'run-k6-script', 'parse-k6-json-summary', 'compare-to-baseline',
    'corroborate-2-sources', 'triage-perf-verdict', 'file-perf-regression-jira',
    'notify-responsible-team', 'curate-baselines', 'link-grafana-panel',
    # 6 authoring
    'explore-product-structure', 'scrub-har-secrets', 'learn-via-k6-docs',
    'verify-k6-script', 'apply-ws2-conventions', 'open-draft-pr',
    # 7 cross-cutting
    'run-ledger', 'perf-run-log', 'choose-k6-execution-mode',
    'emit-otlp-and-prometheus', 'estimate-token-cost', 'build-status-views',
    'doc-consistency-check',
    # 1 shared lib
    'compare-core',
    # 1 on-disk but missing from this registry (reconciled 2026-07-08)
    'scope-review',
    # 5 functional suite (2026-07-08)
    'run-playwright-suite', 'parse-playwright-summary', 'func-verdict',
    'verify-playwright-suite', 'triage-func-verdict',
    # 1 functional authoring reference (2026-07-09)
    'author-resilient-playwright'
)
$skillsRoot = Join-Path $RepoRoot '.github/skills'
foreach ($sk in $skills) {
    Test-Item (".github/skills/{0}/SKILL.md" -f $sk) ("skill: {0}" -f $sk)
}

# Sanity: count the skill dirs actually present vs the 35 expected.
if (Test-Path -LiteralPath $skillsRoot) {
    $present = @(Get-ChildItem -LiteralPath $skillsRoot -Directory -ErrorAction SilentlyContinue).Count
    if ($present -eq $skills.Count) {
        Write-Host ("PASS  skill-dir count == {0}" -f $skills.Count) -ForegroundColor Green
    } else {
        Write-Host ("FAIL  skill-dir count: expected {0}, found {1}" -f $skills.Count, $present) -ForegroundColor Red
        $script:Failures++
    }
} else {
    Write-Host "FAIL  skill-dir count: .github/skills/ missing" -ForegroundColor Red
    $script:Failures++
}

# --- Data / infra scaffold --------------------------------------------------
Test-Item 'baselines/README.md'
Test-Item 'baselines/demo-web.api-benchmark.json'
Test-Item 'state/run-ledger.jsonl'
Test-Item 'live/README.md'
Test-Item '.githooks/pre-commit'
Test-Item 'prompt-tests/README.md'

Write-Host ""
if ($script:Failures -gt 0) {
    Write-Host ("SMOKE FAILED  --  {0} check(s) failed" -f $script:Failures) -ForegroundColor Red
    exit 1
}
Write-Host "SMOKE PASSED" -ForegroundColor Green
exit 0
