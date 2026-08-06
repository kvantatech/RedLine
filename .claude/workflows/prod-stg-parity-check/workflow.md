# prod-stg-parity-check — FLEET workflow recipe

**Type: Fleet workflow / Trigger: manual or scheduled (per-team fan-out) / Status: STUB (P0 scaffold)**

Per team, set-diff the STG vs PROD k6 scripts. For each PROD script that is **missing**, invoke the `perf-author` workflow to author it as a **DRAFT PR**. This closes the **13:3 STG:PROD coverage gap** toward parity — by *acquisition* (writing the missing scripts), not assertion. A human merges all PRs.

Until `DEC-prod-scripts` execution lands, first PROD runs are **benchmark, 1-VU only**, gated on a **one-time operator-approval token** (matching the WS3 "1 VU synthetic PROD" AC). Heavy profiles (load / stress / spike / soak) stay blocked on PROD.

## Steps (recipe)

1. **Enumerate teams** — read the team roster (the 13 teams) from `status.json`. One iteration per team. Caps: ≤16 concurrent, ≤1000 agents/run.
2. **Inventory STG scripts** — for each team, list the existing STG scripts under `envs/<team>/stg/` (`<team>_<profile>_stg.js`). This is the STG coverage set.
3. **Inventory PROD scripts** — for each team, list the existing PROD scripts under `envs/<team>/prod/` (`<team>_<profile>_prod.js`). This is the PROD coverage set.
4. **Set-diff (STG − PROD)** — compute the per-team set of profiles present in STG but **missing** from PROD. This is the parity gap to close. Empty diff → team already at parity, skip to step 7.
5. **Author each missing PROD script** — for each missing `<profile>`, invoke the **`perf-author`** workflow with `{ team, env=prod, profiles:[<profile>], mode=author-first }`. `perf-author` runs its EXPLORE → LEARN → VERIFY → DELIVER backbone and ends at a **draft PR** via `open-draft-pr` (branch `perf-author/<team>-<profile>`; never `main`; never inside `envs/*`). The fleet workflow does **not** run or merge anything.
6. **PROD benchmark caveat (until `DEC-prod-scripts`)** — any first PROD run authored here is constrained to **`k6-profile-benchmark`, vus ≤ 1**, and requires a **one-time operator-approval token**. `run-k6-script` is only ever invoked under that token; everyday verification stays on the STG mirror. Heavy profiles authored for PROD are delivered as draft PRs but remain **blocked from execution** on PROD.
7. **Record + report** — append per-team outcomes (gap size before/after, PRs opened) to the ledger via **`run-ledger`** and emit one cited parity report. **STOP — human merges all PRs.**

## Branching / gates

- **Per-team branch (step 4):** STG − PROD diff empty → team at parity, no authoring; non-empty → author the missing scripts.
- **PROD-execution gate (step 6):** `env==prod` runs are **denied** unless `profile==benchmark` AND `vus<=1` AND a one-time approval token is present (the `.githooks` `DEC-prod-scripts` rule). Heavy profiles: draft PR only, no execution.
- **Merge gate (step 7):** the workflow stops at draft PRs. Filing/merging is an external, **human-gated** step — nothing irreversible happens mid-run.
- **No mid-run human input:** human decisions (token grant, PR merge) are workflow boundaries, not inline prompts. The script does no fs/shell/network itself — skills and the `perf-author` subagent do all I/O.

## Model-call budget

**+1 per missing-script authoring** (the `script-author` generation step inside `perf-author`, plus its bounded grounded helpers); the fleet orchestration itself (enumerate, set-diff, ledger, report) is **0 model calls** — fully deterministic.

---

Skills referenced live in `.github/skills/`. Full design: `AGENTS.md` in this repo
