# Performance Test Suite Policy
> Canonical trigger + environment rules for every team onboarded to perf-eng-agent.
> Apply this matrix when integrating tests into a build schedule for any project.
> Source of truth: this file. Updated by the PE; never overridden per-team without sign-off.

## Trigger & environment matrix

| Test | Trigger | Environment |
|---|---|---|
| **Benchmark** (smoke, API) | Every push | Staging. Prod: on-demand only, operator-approval token required |
| **Browser** (smoke, browser journey) | Every push | Staging only |
| **Load** | Every prod deploy — pre-promote gate | Staging only |
| **Spike** | Every prod deploy — pre-promote gate | Staging only |
| **Soak** | On-demand only | Staging only |
| **Stress** | On-demand only | Staging only |

## Production safety rules

PROD is allowed **only** for a 1-VU benchmark run with a one-time operator-approval token
(`DEC-prod-scripts` Option B — see CLAUDE.md hard rule 2). `run-k6-script` refuses every
other profile on prod. Everyday verification runs against the STG mirror.

| Test | Run in Prod? | Reason |
|---|---|---|
| Benchmark | ✅ With operator token | 1 VU, read-only, negligible impact |
| Browser | ❌ Never (v1.0) | Hard rule 2: prod = 1-VU benchmark only |
| Load | ❌ Never | Real concurrency on live infra |
| Spike | ❌ Never | Burst hits real users |
| Soak | ❌ Never | Hours of sustained load on prod |
| Stress | ❌ Never | Intentionally breaks things |

## Profile definitions

| Profile | VUs | Duration / shape | Purpose |
|---|---|---|---|
| **benchmark** | 1 | 10 iterations | Latency baseline; p95 meaningful at 10 samples; prod-safe with operator token |
| **browser** | 1 | 10 iterations (full journey) | Core Web Vitals + UX journey; p95 meaningful at 10 samples; staging only |
| **load** | ramp 0→N→0 | 5min ramp + 10min hold + 5min ramp-down | Expected concurrency — production readiness gate |
| **spike** | ramp 0→peak in 30s → back down | ~5min total | Auto-scaling + recovery; surge simulation |
| **soak** | 50–80% of load-test VUs | 1–4 hours sustained | Memory leaks, connection exhaustion, time-dependent bugs |
| **stress** | load → 2–3× load until failure | Until errors/latency degrades | Ceiling + failure mode discovery |

## Gate mode progression

All profiles start in **report-only** mode and earn **enforce** after burn-in sign-off:

1. **report-only** — runs, emits JSON summary, exits 0 regardless of verdict
2. **enforce** — exits 99 on red (k6-native thresholds-failed code); blocks the CI step (merge gate or pre-promote gate)

**Exit code contract (both delivery surfaces):** `0` = green · `99` = red (threshold breach — verdict, not an error) · `97` = crash/abort (never a verdict) · any other non-zero = unexpected error. The agent loop and `run-k6-action` use the same codes.

Benchmark and Browser earn enforce fastest (low variance, 1 VU).
Load and Spike earn enforce after 2 weeks of clean runs on staging.
Soak and Stress are always report-only in CI (on-demand, results reviewed by human).

## Applying this policy to a new team (mass-onboarding checklist)

1. Author benchmark + browser scripts via `perf-author` workflow
2. Verify both pass smoke run in `workbench/<team>/`
3. Graduate to `envs/<team>/`
4. Wire `run-k6-action` in team's CI (report-only mode for all)
5. After 2-week burn-in: promote benchmark + browser to enforce
6. Author load + spike scripts via `perf-author` workflow
7. Wire as pre-promote gate (report-only → enforce after sign-off)
8. Author soak + stress scripts; mark as on-demand only (no CI trigger)
