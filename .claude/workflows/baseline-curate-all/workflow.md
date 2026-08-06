# baseline-curate-all

**Type: Fleet workflow (recipe) / Trigger: schedule — weekly Monday 09:00 UTC / Status: STUB (P0 scaffold)**

Weekly drift check across all teams. Fans the `curate-baselines` skill across every
`team × profile` cell, computes 7-day Mimir drift, and opens **baseline-bump PRs only
where drift > 15%**. The workflow never relaxes `error_rate_red`. Humans merge — the
workflow produces proposals only.

## Steps (recipe)

1. **Enumerate targets.** Build the `teams × profiles` matrix from the baseline registry
   (`baselines/<team>.<profile>.json`). This is loop iteration, not a separate mind.
2. **Idempotency check (`run-ledger`).** For each cell, compute the dedupe key with the
   `day_bucket` term and ask `run-ledger`: a `done` key for this week → skip the cell (no
   re-run, no duplicate PR). The week's Monday is the `day_bucket`.
3. **Curate drift (`curate-baselines`), per cell.** Run `curate-baselines` for each
   surviving cell: pull 7-day Mimir trend, compute drift vs the committed baseline, and
   draft a baseline-bump PR body. Deterministic drift math + PR templating — no judgment.
4. **Drift gate (> 15%).** Keep only cells whose drift exceeds **15%**; cells at or below
   threshold are recorded as `no-change` and dropped. See *Branching / gates*.
5. **Guard `error_rate_red`.** Before emitting any PR, verify the proposed baseline does
   **not** relax `error_rate_red` (the red error-rate ceiling). A bump that would loosen it
   is refused and recorded `refused` — never PR'd.
6. **Open baseline-bump PRs.** For each cell that passed steps 4–5, open a draft
   baseline-bump PR. One PR per cell; the diff touches only `baselines/<team>.<profile>.json`.
7. **Record + ledger (`run-ledger`).** Write a terminal `done` record per cell to
   `state/run-ledger.jsonl` and a dated run report. **Humans merge** the PRs — the workflow
   stops at draft PRs.

## Branching / gates

- **Drift gate (> 15%, hard).** drift ≤ 15% → `no-change`, no PR. drift > 15% → continue.
- **`error_rate_red` floor (refuse-only).** A bump that relaxes `error_rate_red` is
  refused, recorded `refused`, and produces no PR. The workflow can tighten but never loosen
  this ceiling.
- **Idempotency (`run-ledger`).** A `done` dedupe key for the current `day_bucket` → cell
  skipped. A re-fired identical week is a no-op.
- **Per-cell isolation.** One cell's failure is recorded `failed` and isolated; the fleet
  fan-out continues (no silent drops). Caps inherited from the fleet rules: ≤16 concurrent.
- **Human-gated terminus.** Output is **draft PRs only**. Merging is a reversible human
  decision after the run — nothing irreversible happens mid-run.

## Model-call budget

Zero model calls on the path — `curate-baselines` (drift math + PR templating),
the drift/`error_rate_red` gates, and `run-ledger` are all deterministic (pure code + IO).

---

Skills referenced live in `.github/skills/`. Full design: planning repo `agent/WORKFLOWS.md` —
`AGENTS.md` in this repo
