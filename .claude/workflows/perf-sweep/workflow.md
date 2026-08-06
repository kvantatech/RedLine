# perf-sweep — fleet workflow recipe

**Type:** Fleet workflow (fan-out) / **Trigger:** manual `/perf-sweep` (run all teams × profiles at once) / **Status: STUB (P0 scaffold)**

Run the operational loop across the whole fleet in one pass: fan out over `teams × profiles × envs`, run the deterministic O0–O2 body in each cell, then a single adversarial cross-check over the aggregate to drop correlated false-positives. **Stops at one cited report — Jira filing is a separate human gate, never automatic.**

## Steps (recipe)

1. **Enumerate the matrix.** Build the cell list from `teams × profiles × envs` (a cell = one `{team, profile, env}` triple). Heavy profiles on `env==prod` are excluded per `DEC-prod-scripts` (only 1-VU `k6-profile-benchmark` with an approval token may target prod).
2. **Per-target cost ceiling — fail closed.** Run `estimate-token-cost` to set a per-target token ceiling for the whole sweep. If projected fan-out cost exceeds budget, the sweep **fails closed** (refuses to start / trims the matrix) rather than overspending.
3. **Fan out, bounded.** Dispatch cells concurrently, **≤16 concurrent / ≤1000 agents per run**. Each cell runs the deterministic O0–O2.5 body below. One target failing does **not** stop the sweep — it is recorded `failed` and the rest continue (no silent drops).
   - **O0 — `run-ledger` gate** [DET]: idempotency gate keyed on the unified `dedupe_key`; a `done` key short-circuits the cell (return prior result, skip).
   - **O1 — `run-k6-script`** [DET]: execute the k6 script via `k6 x mcp`; on infra failure **retry ≤2 with backoff** (never emitted as a clean red); persisted artifacts only.
   - **O1.5 — `parse-k6-json-summary`** [DET]: JSON summary → canonical contract shape.
   - **O2 — `compare-to-baseline`** [DET]: summary + `baselines/<team>.<profile>.json` → verdict + deltas via `compare-core` (pure threshold math — no Grafana, no judgment).
   - **O2.5 — `corroborate-2-sources`** [DET, LIVE]: red cells only — ONE confirmation re-run (`<run_id>_confirm`) before the cell enters the aggregate (the ≥2-signal rule: two consecutive red runs, no external source). Confirm green → cell recorded as flake, excluded from the red aggregate. Doubles runtime for red cells only — budget sweep wall-clock accordingly.
4. **Aggregate** [DET]: collect every cell verdict (green / red / failed) into one fleet result set.
5. **Adversarial cross-check** [MODEL — the only model call]: one `reviewer` pass over the **aggregate** to filter correlated false-positives (e.g. a shared-dependency blip that turned many cells red at once). Cost-capped by the step-2 ceiling.
6. **Emit one cited report + ledger** [DET]: write a single fleet report citing each cell's verdict, deltas, retries, and `link-grafana-panel` deep-links; append terminal records via `run-ledger`. **STOP here.**

## Branching / gates

- **Per cell (O2 verdict):** GREEN → record; RED → surfaced into the aggregate for the cross-check.
- **Cost gate (step 2):** `estimate-token-cost` per-target ceiling is **fail-closed** — exceed budget ⇒ do not run.
- **Isolation:** one target failing isolates (recorded `failed`); the sweep continues.
- **Human gate (terminal):** the workflow stops at the cited report. Filing Jira (`triage-perf-verdict` / `file-perf-regression-jira`) is **human-initiated**, never triggered by this sweep.
- **Caps:** ≤16 concurrent, ≤1000 agents/run; retry ≤2 with backoff on infra failure; no mid-run human input.

## Model-call budget

**1 model call total** — the single adversarial cross-check (`reviewer`) over the aggregate (cost-capped). Every per-cell step (O0–O2), aggregation, reporting, and the ledger are fully deterministic (0 model calls).

---

Skills referenced live in `.github/skills/`. Full design: `AGENTS.md` in this repo
