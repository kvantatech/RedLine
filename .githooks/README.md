# .githooks/ — P0 scaffold

Repo-local git hooks for `perf-eng-agent`. These are **not** active until you
point git at this directory:

```sh
git config core.hooksPath .githooks
```

Run that once per clone. After it, `git commit` will execute `pre-commit`.

## Hooks

### `pre-commit` (STUB)

POSIX `sh` script (`#!/bin/sh`). On Windows it runs under git-for-windows'
bundled bash, so keep it portable — no bashisms.

It is a **P0 scaffold stub**: every check currently echoes its intent and
exits `0`. When implemented (P1) each check must exit **non-zero** to block
the offending commit.

| # | Check | Intent |
|---|-------|--------|
| a | live/ guard | DENY any staged path under `live/*` (read-only submodules) |
| b | doc-consistency-check | Run the literal-string consistency checks; block on failure |
| c | jira sign-off | DENY a `jira-create` draft that lacks the Reviewer sign-off marker (`Reviewed-by:`) |

## Notes

- Hooks live in-repo (not in `.git/hooks/`) so they are versioned and shared.
- `core.hooksPath` is per-clone config and is **not** set automatically — each
  developer/runner must run the `git config` command above.
- To bypass in an emergency: `git commit --no-verify` (avoid; defeats the gate).
