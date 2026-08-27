# drafts/ — where new tests are written (one folder per team)

**In plain English:** this is the workshop. Write a new test here, run it, change it,
break it. Nothing in this folder is trusted yet and nothing here gates a deploy.

Once a test runs green it **graduates** to `live/` via the `perf-author` /
`func-author` workflows. That is the only way a script should reach `live/` — a
proven script is never hand-edited in place, so every test in `live/` has a passing
run behind it.

```
drafts/<team>/<profile>/script.js        # k6 performance script (api-benchmark, load, soak, ...)
drafts/<team>/functional/                # Playwright functional suite
```

| | `drafts/` | `live/` |
|---|---|---|
| Purpose | write and try | run for real |
| Trusted | no | yes |
| Gates a deploy | never | yes, once it has a baseline |
| How things get here | you write them | graduation from `drafts/` |
