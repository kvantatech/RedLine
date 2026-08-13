# Issue #1 — Feedback

kvantatech/RedLine#1 · @joetherod (Joseph Rodriguez) · opened 2026-08-08 · OPEN · 0 comments

RedLine - First-Time User Feedback
===================================
Tested on Windows 11 / Visual Studio 2026 / PowerShell, August 2026.
Starting from a clean git clone with no prior context.


SETUP & INSTALLATION
--------------------

* README lists prerequisites (Node, k6, Playwright, Claude Code) but no install commands.
  Had to figure these out on my own:
	- npm install -g @anthropic-ai/claude-code
	- winget install Grafana.k6 (or brew install k6)
	- npm install (for Playwright deps)
	- npx playwright install chromium

* CLAUDE CODE AUTH WAS THE BIGGEST FRICTION POINT
  - Tried to create a test, got "Not logged in - Please run /login"
  - claude auth login wants a Claude Pro/Max subscription for the browser flow
  - If you don't have Pro/Max you need an Anthropic API key instead
  - Had to go to console.anthropic.com, create a key, add a payment method
  - Then set ANTHROPIC_API_KEY as an environment variable AND in the .env file
  - The dashboard spawns Claude Code as a child process so the .env file is required

  ** THIS MEANS REDLINE IS NOT FREE TO TRY **
  You need either a paid Claude subscription or an API key with funds loaded.
  The README says "What does it cost? Nothing" but that's misleading.

* RECOMMENDATION: Add a dedicated Authentication section with step-by-step instructions.
  Be upfront about the cost. Document the .env file setup.


WHERE IS MY DATA?
-----------------

* Nowhere in the README does it explain how data is persisted. I assumed a database.
  It's actually all flat files:
	- .local/dashboard-progress.json  (wizard state)
	- .env                            (credentials)
	- state/run-ledger.jsonl          (run history)
	- state/schedules.json            (scheduled runs)
	- workbench/<team>/<profile>/     (test scripts)
	- baselines/<team>.<profile>.json (red line thresholds)

* There's no reset or clear button. To start fresh you have to manually delete files.

* RECOMMENDATION: Document this. Add a "start fresh" section or a reset button in the dashboard.


DEMO PROJECTS ARE CONFUSING
----------------------------

* Repo ships with demo-web, demo-api, quickpizza-team, saucedemo-team
  - Unclear if these work out of the box
  - They clutter the Run & Judge picker
  - Hard to find your own new test among them

* RECOMMENDATION: Ship with ONE working end-to-end example and document how to run it.
  Move the rest to an examples/ folder or make them opt-in.


TEST CREATION IS TOO HEAVY
---------------------------

* URL ENVIRONMENT DETECTION BLOCKS YOU
  - App auto-detects staging vs production by checking for keywords (stg, staging, qa, dev)
  - If your URL doesn't have those words, it's classified as production and the agent REFUSES to run
  - Even when you explicitly select "Staging", the agent prompt still overrode that choice
  - Had to modify the source code to fix this

  RECOMMENDATION: Trust the user's explicit environment selection. Don't second-guess it.
  Make this a project setting, not a URL heuristic.

* 10-ITERATION BENCHMARK DURING SETUP IS TOO MUCH
  - Original flow: describe > create script > run 10 iterations > set baseline > done
  - That's a lot of waiting and API spend just to try the tool
  - Should be: describe > create script > 1 smoke test > done
  - Benchmark should be separate, triggered from Run & Judge when ready
  - Let users configure iteration count as a project setting

* RECOMMENDATION: Simplify test creation to just write + validate the script.
  Move benchmark to an explicit "run" step.


MISSING: PROJECT/TEAM SETTINGS
-------------------------------

* No settings screen for teams or projects. These should be configurable per team:
	- Target URL + environment (explicit, not guessed)
	- Iteration count and VU count for benchmarks
	- Login required (with saved credentials)
	- Alerting preferences (Slack channel, Jira project)

* Currently these are hardcoded in prompts, inferred from URLs, or scattered across files.

* RECOMMENDATION: Add a team settings screen or a settings.json per team.


RUNNING TESTS - CI AND MANUAL
-------------------------------

* README mentions run-k6-action for CI but doesn't walk through setup.
  Questions I had:
	- How do I run my test manually? (what command, what env vars?)
	- How do I wire this into GitHub Actions? (need a minimal workflow example)
	- How do I schedule recurring runs? (dashboard has it but it's not documented)

* RECOMMENDATION: Add a "Running your tests" section with manual command,
  CI workflow example, and scheduling instructions.


TOOL PERMISSION ISSUES
-----------------------

* Claude Code needs Bash permissions to run k6 commands.
  The default .claude/settings.json had no shell permissions configured.
  Every agent run failed until I manually added Bash(k6 *), Bash(mkdir *), etc.

* RECOMMENDATION: Ship settings.json with these permissions pre-configured.
  A first-time user should never debug Claude Code permission errors.


BOTTOM LINE
===========

The core idea is great - describe a test, get a real k6/Playwright script,
and a deterministic CI gate. But the first-time experience has too many walls:

  1. Auth and cost are not documented. You can't try it without paying.
  2. Setup requires tribal knowledge (.env file, Claude auth, shell permissions).
  3. Environment detection fights you instead of trusting your input.
  4. Test creation is too heavy - benchmark should be opt-in.
  5. No way to manage projects/teams - no settings, no reset.
  6. Demo projects create noise instead of a clear working example.

The tool works well once you get past setup. The gap is onboarding and defaults.

