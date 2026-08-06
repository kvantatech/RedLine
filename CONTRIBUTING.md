# Contributing to RedLine

Thanks for looking under the hood. RedLine is deliberately small — the fastest way to help is to keep it that way.

## Run the tests

No install needed — the suite is pure Node:

```bash
npm test          # node --test tests/*.test.mjs — 38 checks, ~10s
```

Every PR must keep this green. If you add non-trivial logic, add one small test beside it (`tests/*.test.mjs`, `node:test` + `assert` only — no frameworks).

## Ground rules (from CLAUDE.md — the hard rules)

These are architectural invariants, not preferences. PRs that break them will be declined:

1. **Two verdicts only** — green or red. No ambers, no scores.
2. **The deploy gate makes zero model calls.** `compare-core.js` stays deterministic.
3. **Only 3 subagents** may call a model (`reviewer`, `script-author`, `spec-author`). New model calls carry the burden of proof.
4. **Filing is human-gated.** No workflow files a ticket or alerts a team on its own.
5. **`envs/<team>/` is the proven tier** — write only via graduation, never hand-edit in place.

## Practical notes

- Keep the dashboard **zero-dependency** (`dashboard/server.mjs` is one Node file; `devDependencies` exist only for the Playwright/a11y suites).
- Match the style around you; smallest working diff wins.
- Docs count as code here — if your change alters behavior, update the doc that describes it (README, dashboard/README, or the relevant SKILL.md).

## Reporting bugs / proposing features

Use the [issue templates](.github/ISSUE_TEMPLATE/). For security problems, see [SECURITY.md](SECURITY.md) — not a public issue.
