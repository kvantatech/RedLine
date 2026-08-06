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

# parse: flaky fixture → flaky counts as failed (retries:0 convention)
node .github/skills/parse-playwright-summary/parse.mjs "$fx/flaky.json" RUN-F "$tmp/c-flaky.json"
Assert ($LASTEXITCODE -eq 0) 'parse flaky exits 0'
$c = Get-Content "$tmp/c-flaky.json" -Raw | ConvertFrom-Json
Assert ($c.tests_total -eq 3 -and $c.failed -eq 1 -and @($c.failures).Count -eq 1) 'flaky counted as failed'

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
