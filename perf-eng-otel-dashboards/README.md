# perf-eng-otel-dashboards

Grafana dashboard provisioning for **demo-perf**, mirroring the
`core-ui-otel-dashboards` pattern from the UI deployment manifests repo (Kustomize →
ConfigMap → Grafana sidecar → folder `demo-perf`).

## Convention: one dashboard per project

Every project the perf-eng-agent onboards gets **its own dashboard** in the
shared `demo-perf` Grafana folder:

| Project | File | Dashboard title | UID |
|---|---|---|---|
| demo-web | `base/common/dashboards/perf-demo-web.json` | `Perf — demo-web` | `perf-demo-web` |
| *(next project)* | `base/common/dashboards/perf-<project>.json` | `Perf — <project>` | `perf-<project>` |

Dashboards live in `base/common` so the **same JSON ships to staging and prod**
Grafana (dev-us, prod-us, prod-eu) — the `environment` template variable filters
the data, not the overlay.

## Data contract

All panels query the **`Mimir-demo-perf`** datasource and filter on
the k6 tag set defined in the LGTM integration guide
(`envs/prod-stg-build-tests/docs/K6_LGTM_INTEGRATION_GUIDE.md`):

```
team="demo-perf"   ← Mimir tenant (fixed)
product="<project>"           ← the project under test (per-dashboard)
environment="STAGING"|"PROD"  ← template variable
test_name="<profile>"         ← api-benchmark | browser-journey | ...
```

Metrics arrive via `k6 run --out experimental-opentelemetry` with
`K6_OTEL_METRIC_PREFIX=k6.` — Trend metrics land as histograms, so p95 panels use
`histogram_quantile(0.95, sum(rate(k6_<metric>_bucket{...}[$__rate_interval])) by (le))`.

**Until the `emit-otlp-and-prometheus` skill is live in run-k6-script (runs
pushing OTLP), these dashboards render empty.** The OTLP endpoint
(`otel.example.com`) is VPC-only — runs must be on VPN or on the
ARC runner (PERF-101).

Red thresholds on the panels are copied from `baselines/demo-web.*.json` at
authoring time. **When `curate-baselines` bumps a baseline, the matching
dashboard threshold must be updated in the same PR** (they are not dynamically
linked — Grafana cannot read our baseline files).

## Alert rules — generated from baselines (2026-07-16)

`base/common/alerts/redline-red-lines.json` holds one Grafana alert rule per
baseline metric: p95 of the metric's Mimir histogram over the last 30m vs that
metric's `p95_red_ms`. It is **generated, never hand-edited**:

```
node perf-eng-otel-dashboards/tools/gen-alerts.mjs
```

Re-run it whenever `curate-baselines` changes a red line — unlike the panel
thresholds above, alert thresholds never drift by hand because the baselines
stay the single source of truth. Rules use `noDataState: OK` (runs are
episodic; an idle day is not an alert) and stable UIDs (re-provisioning updates
in place). Where a firing alert *goes* (Slack/Teams/PagerDuty/OpsGenie contact
points) is Grafana notification-policy config on the Grafana side; the
RedLine-side real-time path is the `notify-responsible-team` skill.

## Adding the next project

1. Copy `perf-demo-web.json` → `perf-<project>.json`
2. Update `title`, `uid`, `tags`, every `product="..."` filter, metric names,
   and threshold values from `baselines/<project>.*.json`
3. Add the file to `base/common/kustomization.yaml` under `dashboards-common`
4. Commit — ArgoCD/sidecar does the rest once this tree is deployed

## Deployment

This tree is the **source artifact** — it deploys the same way core-ui's does
(ArgoCD app pointing at the overlay per Grafana instance). `envs/ui-deployments`
is a read-only submodule here, so wiring the ArgoCD Application for
`demo-perf` is a DevOps hand-off:

- staging Grafana (`grafana.example.com`) ← `overlays/dev-us`
- prod US Grafana (`grafana.example.com`) ← `overlays/prod-us`
- prod EU Grafana (`grafana.example.com`) ← `overlays/prod-eu`

Validate locally with: `kubectl kustomize overlays/dev-us`
