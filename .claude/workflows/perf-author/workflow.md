# perf-author — Workflow Recipe

**Type:** CORE workflow #1 ("write a new test") / **Trigger:** manual · mass-onboarding fan-out / **Status: STUB (P0 scaffold)**

A recipe is a fixed, ordered sequence of skills. The skills themselves live in
`.github/skills/` and are referenced here by their character-exact registry name.

**Entry:** `resolve-entry-mode` — asks two questions before anything else:
1. `author-first | run-existing` — author a new script or run an existing one
2. `api | browser` — **what kind of test?** determines exploration tooling and script shape

`api` tests use k6 HTTP only; login goes in `setup()` so auth latency is never reported.
`browser` tests use `k6/browser`; login is part of the scripted user journey.
In `run-existing` mode both authoring steps and the type question are skipped.

## Steps (recipe)

0. [HUMAN] `resolve-entry-mode` — `author-first | run-existing`; then `api | browser`
1. [MODEL grounded] `explore-product-structure` — map pages/APIs with Playwright + HAR
2. [DET] `scrub-har-secrets` — strip auth tokens before saving
3. [MODEL grounded] `learn-via-k6-docs` — look up correct k6 v2 APIs for chosen type
4. [MODEL] ★ `script-author` (SUBAGENT) — generate script; `api`: login in setup(), report endpoints only; `browser`: full user journey with k6/browser
4a. [HUMAN] `scope-review` — agent presents endpoints, exclusions, auth placement, metrics; human confirms or redirects
5. [DET] `apply-ws2-conventions` — tags, Prometheus output, exit-code checklist
6. [MODEL bounded] `verify-k6-script` — validate → smoke run → fix (bounded rounds)
6b. [DET] `graduate-script` — copy proven `workbench/<team>/<profile>/` → `envs/<team>/<profile>/`; update pre-commit allow-list if needed. **Building phase only:** when GitHub MCP (P5) is wired this step is replaced by `open-draft-pr` targeting the team's upstream repo.
7. [DET] `open-draft-pr` — open PR against team's upstream repo (P5+); in building phase, graduation to envs/ (step 6b) IS the delivery — skip this step until GitHub MCP is wired

## Branching / gates

- **Entry gate — `resolve-entry-mode`:** `author-first` runs steps 1–7; `run-existing`
  short-circuits authoring and defers to the perf-run workflow.
- **Profile select [DET]:** a deterministic profile step selects a `k6-profile-*`
  (benchmark profile first) before the script is exercised.
- **Secret gate [DET]:** `scrub-har-secrets` (step 2) MUST complete before any HAR
  artifact is persisted — auth tokens are stripped on the way to disk.
- **Scope gate [HUMAN] — step 4a:** agent presents chosen endpoints, exclusions, and rationale.
  Human confirms or redirects. **No verify rounds are spent until scope is approved.**
  If redirected, agent revises the script and re-presents before proceeding.
- **PR gate [DET]:** `open-draft-pr` (step 7) opens a draft PR and never commits to
  `main`. **A human merges the PR.**
- **Close-out:** `open-draft-pr` (step 7) + `run-ledger` record the run and close out the recipe.

## Model-call budget

**1 model call** (`script-author` subagent) **+ 2 bounded grounded helpers**
(`explore-product-structure`, and `learn-via-k6-docs` / `verify-k6-script`). Everything
else is [DET]. Human gates: scope review (step 4a) + PR merge (step 7).

---

Skills referenced live in `.github/skills/`. Full design: planning repo
`AGENTS.md` in this repo
