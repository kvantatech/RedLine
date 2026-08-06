# prompt-tests/ — behavioral evals (P0 scaffold)

End-to-end **behavioral evals** for the agent's skills and subagents. These are
the quality bar for `perf-eng-agent`.

## How they run

- **Operator-run, on-demand.** No CI gate, no scheduled job. An operator runs an
  eval by hand when a prompt, skill, or subagent changes — or when a regression
  is suspected.
- Each eval dir holds a fixture: a defined **input** and the **expected output**
  (the behavior we assert, not a byte-exact diff). The README in each dir
  documents the input → expected-output contract.
- An eval "passes" when the agent's behavior matches the expected output for the
  fixture's input.

## Token-cost note

Each eval drives a real model turn (subagent invocation), so it **costs tokens**.
Run them deliberately — on change or on suspicion — not in a tight loop. Batch
related evals when iterating.

## Scope

- **Quality == these evals.** This is how we measure whether the agent behaves
  correctly.
- **GRPO is explicitly OUT of scope.** No fine-tuning, no reward-model training,
  no RL loop. We do not train the model; we evaluate prompts/skills/subagents
  behaviorally and fix the file tree.

## Eval fixtures

| Dir | Exercises |
|-----|-----------|
| `baseline-comparer-e2e/` | `compare-to-baseline` → green/red classification end-to-end |
| `reviewer-reject-e2e/`   | `reviewer` subagent rejects a non-compliant Jira draft |
| `reviewer-approve/`      | `reviewer` subagent approves a compliant draft (sign-off marker emitted) |
| `script-author/`         | `script-author` subagent produces a valid k6 script from a brief |
| `curator-drift/`         | `curate-baselines` / `detect-drift` proposes a baseline update on drift |
