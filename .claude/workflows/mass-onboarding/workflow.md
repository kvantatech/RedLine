# mass-onboarding — Workflow Recipe

**Type:** FLEET workflow ("author tests for every team in one go") / **Trigger:** manual / **Status: STUB (P0 scaffold)**

A recipe is a fixed, ordered sequence of skills. The skills themselves live in
`.github/skills/` and are referenced here by their character-exact registry name.
`[DET]` = deterministic skill, no model call. `[MODEL]` = earns a model call. ★ = subagent.

**What it does:** fan the `perf-author` core workflow across **every team you've defined**,
one leveled-up STG script per team delivered as a **DRAFT PR**. Prompt patterns that
worked are recorded for reuse on the next team. **A human reviews + merges per team.**

**Fleet = the teams you configure.** The fan-out iterates whatever teams are defined for this
run (passed in as a team list, or discovered from existing `drafts/<team>/` folders and
`baselines/<team>.*` entries). Some teams have several surfaces (e.g. a product with four
sub-apps) — model each surface as its own team slug. The benchmark profile is authored first,
`env=stg` for every cell.

## Steps (recipe)

1. **[DET]** `estimate-token-cost` — set the per-target ceiling for the whole fan-out; **fail closed** rather than overspend.
2. **[DET]** `run-ledger` — idempotency gate per `(team, profile, env=stg)`; teams already `done` are **skipped** (re-runnable).
3. **[DET]** fan-out loop — for each team in the run's team list, invoke the **`perf-author`** workflow with `{ team, profiles: [benchmark first], env: stg }`. Each `perf-author` cell internally runs (recipe-owned, not re-listed here): `resolve-entry-mode` → `explore-product-structure` [MODEL] → `scrub-har-secrets` [DET] → `learn-via-k6-docs` [MODEL] → `verify-k6-script` [MODEL] → `apply-ws2-conventions` [DET] → ★ `script-author` [MODEL] → `open-draft-pr` [DET].
4. **[DET]** `perf-run-log` — record the prompt patterns / explore findings that worked per team, for reuse on the next team.
5. **[DET]** `run-ledger` — write the terminal per-team record (delivered | failed | skipped).
6. **[DET]** `build-status-views` — refresh `status.json` views with the onboarding roll-up (N teams delivered as draft PRs).

## Branching / gates

- **Cost gate [DET] — `estimate-token-cost` (step 1):** the fan-out **fails closed** if the
  projected cost exceeds the per-target ceiling — nothing irreversible has happened yet.
- **Idempotency gate [DET] — `run-ledger` (step 2):** a team already recorded `done` is
  **skipped**; the workflow is safe to re-run after a partial fan-out.
- **Per-team isolation [DET]:** one team's `perf-author` failure is recorded `failed` and the
  fan-out **continues** — no silent drops, no halting the fleet.
- **Secret gate [DET]:** inherited from each `perf-author` cell — `scrub-har-secrets` MUST
  complete before any HAR artifact is persisted.
- **PR gate [DET]:** every cell ends at `open-draft-pr` — a **draft** PR on branch
  `perf-author/<team>-<profile>`, never `main`, never inside `live/*`.
  **A human reviews + merges per team.** This workflow produces **proposals only**.
- **Caps:** honor the fleet caps — **≤16 concurrent, ≤1000 agents/run**; **no mid-run human
  input** (human merge is a workflow boundary, after).

## Model-call budget

**Per team:** `perf-author`'s budget — **1** model call (★ `script-author`) **+ 2 bounded
grounded helpers** (`explore-product-structure`, `learn-via-k6-docs` / `verify-k6-script`).
**Fleet total:** that budget **× the number of teams in the run**, capped by `estimate-token-cost` (step 1).
The fan-out harness itself adds **0** model calls — steps 1, 2, 4, 5, 6 are all `[DET]`.

---

Skills referenced live in `.github/skills/`. Full design: `AGENTS.md` in this repo
