/**
 * quickpizza-team · api-benchmark profile
 * Type: API (k6 HTTP only)
 *
 * Target:   QuickPizza (https://quickpizza.grafana.com) — Grafana's public k6
 *           practice service, explicitly built to be load-tested.
 * Measures: GET /api/config  — app bootstrap signal (public, no auth)
 *           POST /api/pizza  — core business transaction (pizza recommendation)
 * Auth:     POST /api/pizza uses QuickPizza's PUBLIC demo token
 *           ("abcdef0123456789", documented in grafana/quickpizza README).
 *           Not a secret — overridable via QUICKPIZZA_TOKEN for self-hosted targets.
 *
 * Baseline: baselines/quickpizza-team.api-benchmark.json
 * Gate:     envs/quickpizza-team/api-benchmark/perf-gate.yaml
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

/* ─── Metrics ─────────────────────────────────────────────────────────── */
const trxConfig = new Trend("quickpizza_config_health", true);
const trxPizza  = new Trend("quickpizza_pizza_order", true);
const testRunPassed = new Rate("test_run_passed");

/* ─── Config ──────────────────────────────────────────────────────────── */
const BASE_URL = __ENV.BASE_URL || "https://quickpizza.grafana.com";
const TOKEN    = __ENV.QUICKPIZZA_TOKEN || "abcdef0123456789"; // public demo token, not a secret

/* ─── Options ─────────────────────────────────────────────────────────── */
export const options = {
  scenarios: {
    "api-benchmark": {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 10,
      maxDuration: "5m",
    },
  },
  thresholds: {
    // Red thresholds — source of truth: baselines/quickpizza-team.api-benchmark.json
    "quickpizza_config_health": ["p(95)<1000"],
    "quickpizza_pizza_order":   ["p(95)<1000"],
  },
  tags: {
    environment: __ENV.ENVIRONMENT || "staging",
    test_file:   "api-benchmark",
    test_type:   "benchmark",
    run_id:      __ENV.RUN_ID  || "local",
    branch:      __ENV.BRANCH  || "local",
    team:        "demo-perf",
    product:     "quickpizza-team",
  },
};

/* ─── Default — config + pizza order are measured ─────────────────────── */
export default function () {
  const t0 = Date.now();
  const cfgRes = http.get(`${BASE_URL}/api/config`, {
    headers: { Accept: "application/json" },
    tags: { step: "config", endpoint: "GET /api/config", measured: "true" },
  });
  trxConfig.add(Date.now() - t0);

  const t1 = Date.now();
  const pizzaRes = http.post(
    `${BASE_URL}/api/pizza`,
    JSON.stringify({
      maxCaloriesPerSlice: 1000,
      mustBeVegetarian: false,
      excludedIngredients: [],
      excludedTools: [],
      maxNumberOfToppings: 5,
      minNumberOfToppings: 2,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `token ${TOKEN}`,
      },
      tags: { step: "pizza", endpoint: "POST /api/pizza", measured: "true" },
    }
  );
  trxPizza.add(Date.now() - t1);

  const ok = check(cfgRes, {
    "config: status 200": (r) => r.status === 200,
  }) && check(pizzaRes, {
    "pizza: status 200":     (r) => r.status === 200,
    "pizza: has a name":     (r) => {
      try { return JSON.parse(r.body).pizza.name.length > 0; } catch (_) { return false; }
    },
  });
  testRunPassed.add(ok);
  sleep(0.5);
}

export function handleSummary(data) {
  const endpoints = [
    { metric: "quickpizza_config_health", threshold_ms: 1000 },
    { metric: "quickpizza_pizza_order",   threshold_ms: 1000 },
  ].map(({ metric, threshold_ms }) => {
    const m = data.metrics[metric];
    return {
      metric,
      p95_ms: m?.values?.["p(95)"] != null ? Math.round(m.values["p(95)"]) : null,
      threshold_ms,
      thresholds_ok: m?.thresholds ? Object.values(m.thresholds).every(t => t.ok) : null,
    };
  });
  // Guard: no samples recorded → "no-data", never a vacuous green
  const verdict = endpoints.some(e => e.p95_ms === null || e.thresholds_ok === null)
    ? "no-data"
    : endpoints.every(e => e.thresholds_ok) ? "green" : "red";
  return {
    "reports/summary-quickpizza-team-api-benchmark.json": JSON.stringify({
      team: "quickpizza-team", profile: "api-benchmark", env: __ENV.ENVIRONMENT || "stg",
      verdict, endpoints, run_id: __ENV.RUN_ID || "local",
    }, null, 2),
  };
}
