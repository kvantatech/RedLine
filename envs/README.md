# envs/ — the proven tier (one folder per team)

`envs/` holds each team's **graduated, proven** test scripts — the ones that have run green in
`workbench/<team>/` and been promoted. `run-k6-script` and `run-playwright-suite` read from here.

```
envs/<team>/<profile>/script.js        # k6 performance script (api-benchmark, load, soak, …)
envs/<team>/functional/                # Playwright functional suite
```

## How scripts get here

Scripts are **written to `workbench/<team>/` first** (the draft tier), verified, and only then
graduated into `envs/<team>/` via the `perf-author` / `func-author` workflows. The agent never
hand-edits a proven script in place — a change goes back through the draft → verify → graduate
path so every proven script has a passing run behind it.

## Optional: pin a team to an external repo

A company can pin a team's `envs/<team>/` to an external git repo as a **submodule** (e.g. when a
team owns its tests in its own repo). Submodule-pinned folders are **READ-ONLY** here: pull/update
only, and propose changes as draft PRs upstream — never commit into them from this repo. The
`pre-commit` hook (check a) enforces this by reading `.gitmodules`; plain in-repo team folders stay
writable through the normal graduation path. There are no submodules by default.
