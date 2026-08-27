# emit-otlp-and-prometheus
> Configure k6 to emit metrics to the LGTM stack (OTLP → Mimir) — the OBSERVE pillar.

**Type:** skill (deterministic — flags only, no judgment) · **Used by:** run-k6-script, run-k6-action gate · **Status:** LIVE (P2 — OTLP path; gated by `OBSERVE=1`)

## Prompt

You are the `emit-otlp-and-prometheus` skill. You return the k6 flags + env that make a measured
run stream its metrics into the company's internal LGTM stack (Mimir tenant `demo-perf`),
so the per-project dashboards (`perf-eng-otel-dashboards/`) have data and the reviewer can pull
historical context. (Note: Mimir is NOT the corroboration source — it holds the same exported
data; corroboration is the `corroborate-2-sources` confirmation re-run.)

**Inputs** (from the calling skill): `team` (project under test, e.g. `demo-web`), `profile`
(e.g. `api-benchmark`), `env` (`stg` | `prod`), and whether `OBSERVE=1` is set.

**Steps:**

1. **Gate.** If `OBSERVE` is not `1` → return empty flags (run stays summary-only). The OTLP
   endpoint is **VPC-only**; emitting from a network that cannot reach it pollutes the run log
   with export errors. Enable on: local VPN runs, ARC runner (PERF-101). Keep off on
   `ubuntu-latest` CI.

2. **Env block** (per `live/prod-stg-build-tests/docs/K6_LGTM_INTEGRATION_GUIDE.md`):

   ```
   K6_OTEL_EXPORTER_PROTOCOL      = http/protobuf                       # k6 2.0 var name (NOT K6_OTEL_EXPORTER_TYPE)
   K6_OTEL_HTTP_EXPORTER_ENDPOINT = otel.example.com:80    # host:port only, no scheme
   K6_OTEL_HTTP_EXPORTER_INSECURE = true
   K6_OTEL_METRIC_PREFIX          = k6.
   K6_OTEL_FLUSH_INTERVAL         = 3s
   ```

   **VERIFIED 2026-06-10 (data confirmed in Mimir):** only the http/protobuf path on port 80
   lands in the `Mimir-demo-perf` tenant. The gRPC path to :443 exports without
   visible errors but the data never arrives — do NOT use gRPC. 4317/4318 are closed.
   Use `--out opentelemetry` (graduated stable in k6 2.0).

   **k6 2.0 metric naming in Mimir** (differs from the older `_seconds` convention):
   - `new Trend('x', true)` → `k6_x_milliseconds_bucket` / `_count` / `_sum` (classic histogram, le labels)
   - `new Rate('test_run_passed')` → `k6_test_run_passed_total{condition="zero"|"nonzero"}`
   - Counter → `k6_<name>_total`; `k6_vus` / `k6_vus_max` plain gauges
   - p95: `histogram_quantile(0.95, sum by (le, run_id) (last_over_time(k6_x_milliseconds_bucket{...}[$__range])))`

3. **Tag contract** — set in each script's `options.tags` (matches the proven
   `ui - k6 Tests Overview` label convention; CLI `--tag` only for run-time values):

   ```
   team        = demo-perf          ← Mimir tenant (fixed, always this value)
   product     = <project>                     ← the project under test, e.g. demo-web
   environment = staging | prod-us | prod-eu   ← lowercase (NOT STAGING/stg)
   test_file   = <short script name>           ← api-benchmark | browser-journey (no path, no .js)
   test_type   = benchmark | browser | load | spike | soak | stress
   run_id      = __ENV.RUN_ID  (unique per run — GitHub run_id in CI, manual-<ts> locally)
   branch      = __ENV.BRANCH
   ```

   Each script also declares `new Rate('test_run_passed')` and records one sample per
   iteration — the per-run pass/fail signal the dashboards color bars with.

4. Return `{ env: {...}, flags: [...] }` for the caller to merge into its `k6 run` invocation.

## Metric naming downstream

`K6_OTEL_METRIC_PREFIX=k6.` + OTLP→Mimir means: Trend `demo_web_config_health` is queried as
`k6_demo_web_config_health_bucket` (histogram); Counter `http_reqs` as `k6_http_reqs_total`.
p95 panels use `histogram_quantile(0.95, sum(rate(<m>_bucket{...}[$__rate_interval])) by (le))`.

## Hard rules

- **`team` tag is ALWAYS `demo-perf`** (tenant routing). The project goes in `product`.
- **Never block a run on export failure** — OTLP is observability, not the verdict path. The
  k6 JSON summary remains the gate's source of truth (hard rule 8: gate stays deterministic).
- **The "both sinks" rule is satisfied via OTLP→Mimir**: Mimir IS the Prometheus-compatible
  store — one exporter, both query paths (PromQL for reviewer enrichment, dashboards for humans).
  Direct `experimental-prometheus-rw` is NOT used (replaced by OTLP per the LGTM guide).

## Tools

none — deterministic (k6 flags)

## Data

- Reads: nothing
- Writes: nothing (returns flags/env to the caller)

---
Frozen skill registry: `AGENTS.md` in this repo
