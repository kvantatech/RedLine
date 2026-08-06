/**
 * demo-web · stress profile
 * Type: API (k6 HTTP only)
 *
 * Trigger:     On-demand only (never in CI)
 * Environment: Staging only — never run against prod
 *
 * Shape: ramp from expected load (10 VUs) up to 3× (30 VUs) in steps until errors
 * or latency degrades. Goal: find the ceiling and failure modes.
 *
 * Baseline: baselines/demo-web.stress.json
 * Gate:     envs/demo-web/stress/perf-gate.yaml  (report-only, never enforce in CI)
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

/* ─── Metrics ─────────────────────────────────────────────────────────── */
const trx_config = new Trend("demo_web_config_health", true);

/* ─── Config ──────────────────────────────────────────────────────────── */
const BASE_URL         = __ENV.BASE_URL       || "https://demo-app.example.com";
const LOGIN_URL        = __ENV.LOGIN_URL      || "https://auth.example.com";
const USERNAME         = __ENV.PERF_USERNAME  || "";
const PASSWORD         = __ENV.STAGING_PASSWORD || "";
const WS_FED_PARAMS    =
  "?wa=wsignin1.0" +
  "&wtrealm=https%3A%2F%2Fdemo-app.example.com%2Fapi%2Fauth%2Fcallback" +
  "&wctx=rm%3D1%26id%3Dpassive%26ru%3D%252Fapi%252Fauth%252Fcallback%253FredirectPath%253D%252F" +
  "&wreply=https%3A%2F%2Fdemo-app.example.com%2Fapi%2Fauth%2Fcallback%3FredirectPath%3D%2F";
const LOGIN_PAGE_URL   = `${LOGIN_URL}${WS_FED_PARAMS}`;
const AUTHENTICATE_URL = `${LOGIN_URL}/authenticate`;

/* ─── Options ─────────────────────────────────────────────────────────── */
export const options = {
  scenarios: {
    "stress": {
      executor: "ramping-vus",
      stages: [
        { duration: "3m", target: 10 },   // start at expected load
        { duration: "3m", target: 20 },   // 2× expected
        { duration: "3m", target: 30 },   // 3× expected — looking for the ceiling
        { duration: "3m", target: 40 },   // 4× — beyond ceiling; observe failure mode
        { duration: "5m", target: 0  },   // recovery
      ],
    },
  },
  thresholds: {
    // Intentionally loose — stress tests are expected to fail thresholds at peak
    // Gate is report-only; human reviews the trend graph to find the breaking point
    "demo_web_config_health": ["p(95)<3000"],
    "http_req_failed":      ["rate<0.20"],
  },
  tags: {
    environment: __ENV.ENVIRONMENT || "stg",
    test_file:   "demo-web/stress/script.js",
    test_type:   "stress",
    run_id:      __ENV.RUN_ID  || "local",
    branch:      __ENV.BRANCH  || "local",
    team:        "demo-web",
  },
};

/* ─── Helpers ─────────────────────────────────────────────────────────── */
function htmlDecode(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

function doLogin() {
  const initRes = http.get(LOGIN_PAGE_URL, { tags: { step: "login-init", measured: "false" } });
  const body    = initRes.body;
  if (!body) { throw new Error(`login: empty response from login page (status ${initRes.status})`); }

  const csrfMatch   = body.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  const wctxMatch   = body.match(/name="Wctx"[^>]*value="([^"]+)"/);
  const wreplyMatch = body.match(/name="WReply"[^>]*value="([^"]+)"/);
  const csrfToken   = csrfMatch   ? csrfMatch[1]               : "";
  const wctx        = wctxMatch   ? htmlDecode(wctxMatch[1])   : "";
  const wreply      = wreplyMatch ? htmlDecode(wreplyMatch[1]) : "";

  if (!csrfToken) { throw new Error("login: failed to scrape CSRF token"); }

  http.post(
    `${LOGIN_URL}/Session/GetIdpIssuerList?username=${encodeURIComponent(USERNAME)}`,
    null,
    { tags: { step: "login-idp", measured: "false" } }
  );

  const authRes = http.post(
    AUTHENTICATE_URL,
    { Username: USERNAME, Password: PASSWORD, Wctx: wctx, WReply: wreply,
      RedirectUrl: "", SAMLRequest: "", RelayState: "", __RequestVerificationToken: csrfToken },
    { tags: { step: "login-auth", measured: "false" }, redirects: 0 }
  );
  if (!authRes.body || authRes.body.indexOf("wresult") === -1) {
    throw new Error(`login: no wresult (status ${authRes.status})`);
  }

  const wresultMatch = authRes.body.match(/name="wresult"\s+value="([^"]+)"/);
  const wctx2Match   = authRes.body.match(/name="wctx"\s+value="([^"]+)"/);
  const wresult = wresultMatch ? htmlDecode(wresultMatch[1]) : "";
  const wctx2   = wctx2Match   ? htmlDecode(wctx2Match[1])  : "";

  const callbackRes = http.post(
    `${BASE_URL}/api/auth/callback?redirectPath=/`,
    { wa: "wsignin1.0", wresult: wresult, wctx: wctx2 },
    { tags: { step: "login-callback", measured: "false" }, redirects: 10 }
  );
  if (callbackRes.status >= 400) { throw new Error(`login: callback ${callbackRes.status}`); }
}

/* ─── Default ─────────────────────────────────────────────────────────── */
export default function () {
  doLogin();

  const t0  = Date.now();
  const res = http.get(`${BASE_URL}/api/config`, {
    headers: { Accept: "application/json" },
    tags: { step: "config", endpoint: "GET /api/config", measured: "true" },
  });
  trx_config.add(Date.now() - t0);

  check(res, {
    "config: status 200":    (r) => r.status === 200,
    "config: has manifests": (r) => {
      try { return JSON.parse(r.body).manifests.length > 0; } catch (_) { return false; }
    },
  });
  sleep(0.5);
}

export function handleSummary(data) {
  const metricData = data.metrics["demo_web_config_health"];
  const p95        = metricData?.values?.["p(95)"] ?? null;
  const thresholds = metricData?.thresholds ?? null;
  const verdict = (p95 === null || thresholds === null)
    ? "no-data"
    : Object.values(thresholds).every(t => t.ok) ? "green" : "red";
  return {
    "reports/summary-demo-web-stress.json": JSON.stringify({
      team: "demo-web", profile: "stress", env: __ENV.ENVIRONMENT || "stg",
      verdict,
      metrics: { demo_web_config_health_p95_ms: p95 !== null ? Math.round(p95) : null },
      threshold_ms: 3000, run_id: __ENV.RUN_ID || "local",
    }, null, 2),
  };
}
