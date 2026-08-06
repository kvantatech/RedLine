/**
 * demo-web · benchmark profile
 *
 * What we observed (Playwright exploration 2026-06-09):
 *  - App is single-spa shell at demo-app.example.com
 *  - Auth: WS-Federation SSO via auth.example.com
 *    GET / → redirect to login page with wa/wtrealm/wctx/wreply params
 *    POST credentials (x-www-form-urlencoded) → redirects back → httpOnly session cookie set
 *  - POST /Session/GetIdpIssuerList fires after username entry (identity provider lookup)
 *  - GET /api/config (200) is the shell bootstrap signal — first meaningful authenticated response
 *  - API gateway gateway in front of all APIs (~0-700ms upstream latency observed)
 *  - k6 cookie jar handles httpOnly session cookie automatically via Set-Cookie headers
 *
 * Baseline: baselines/demo-web.api-benchmark.json  (demo-web.benchmark.json was renamed)
 * Thresholds enforced in perf-gate.yaml
 * NOTE: this workbench draft is SUPERSEDED by envs/demo-web/api-benchmark/script.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

/* ─── Metrics ─────────────────────────────────────────────────────────── */
const trx_login       = new Trend("demo_web_login", true);
const trx_config      = new Trend("demo_web_config_health", true);

/* ─── Config ──────────────────────────────────────────────────────────── */
const BASE_URL    = __ENV.BASE_URL    || "https://demo-app.example.com";
const LOGIN_URL   = __ENV.LOGIN_URL   || "https://auth.example.com";
const USERNAME    = __ENV.PERF_USERNAME    || "";
const PASSWORD    = __ENV.STAGING_PASSWORD || "";

// WS-Fed login page URL — observed via Playwright 2026-06-09
// GET this page first to scrape Wctx, WReply, __RequestVerificationToken (CSRF)
const WS_FED_PARAMS = "?wa=wsignin1.0" +
  "&wtrealm=https%3A%2F%2Fdemo-app.example.com%2Fapi%2Fauth%2Fcallback" +
  "&wctx=rm%3D1%26id%3Dpassive%26ru%3D%252Fapi%252Fauth%252Fcallback%253FredirectPath%253D%252F" +
  "&wreply=https%3A%2F%2Fdemo-app.example.com%2Fapi%2Fauth%2Fcallback%3FredirectPath%3D%2F";
const LOGIN_PAGE_URL  = `${LOGIN_URL}/${WS_FED_PARAMS}`;
// Actual POST target — form action="/authenticate" (observed from login page HTML)
const AUTHENTICATE_URL = `${LOGIN_URL}/authenticate`;

export const options = {
  scenarios: {
    benchmark: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 10,
      maxDuration: "5m",
    },
  },
  thresholds: {
    // Red threshold 900ms — baselines/demo-web.api-benchmark.json
    "demo_web_config_health": ["p(95)<900"],
    "demo_web_login":         ["p(95)<3000"],
    http_req_failed:        ["rate<0.02"],
  },
  tags: {
    environment: __ENV.ENVIRONMENT || "stg",
    test_file:   "demo-web/benchmark/script.js",
    test_type:   "benchmark",
    run_id:      __ENV.RUN_ID  || "local",
    branch:      __ENV.BRANCH  || "local",
    team:        "demo-web",
  },
};

/* ─── Default function ────────────────────────────────────────────────── */
export default function () {
  // Step 1: GET login page — scrape CSRF token + hidden WS-Fed fields
  const initRes = http.get(LOGIN_PAGE_URL, { tags: { step: "init" } });
  check(initRes, {
    "init: reached login page": (r) => r.url.indexOf("auth.example.com") !== -1,
  });

  // Parse hidden fields from the login form HTML
  const body = initRes.body;
  const csrfMatch  = body.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  const wctxMatch  = body.match(/name="Wctx"[^>]*value="([^"]+)"/);
  const wreplyMatch = body.match(/name="WReply"[^>]*value="([^"]+)"/);

  // HTML-entity decode (login page serves values with &amp; encoded)
  function htmlDecode(s) { return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'); }
  const csrfToken = csrfMatch  ? csrfMatch[1]          : "";
  const wctx      = wctxMatch  ? htmlDecode(wctxMatch[1])  : "";
  const wreply    = wreplyMatch ? htmlDecode(wreplyMatch[1]) : "";

  check(initRes, {
    "init: got CSRF token": () => csrfToken.length > 0,
  });

  sleep(0.5);

  // Step 2: POST IdP issuer lookup (fires after username entry in browser)
  http.post(
    `${LOGIN_URL}/Session/GetIdpIssuerList?username=${encodeURIComponent(USERNAME)}`,
    null,
    { tags: { step: "idp-lookup" } }
  );

  // Step 3: POST credentials to /authenticate (no redirect follow — we need the wresult body)
  // form action="/authenticate" — observed from login page HTML
  // Response is a WS-Fed auto-submit form with wresult token (JS-driven, k6 won't auto-submit)
  const t0 = Date.now();
  const authRes = http.post(
    AUTHENTICATE_URL,
    {
      Username:                    USERNAME,
      Password:                    PASSWORD,
      Wctx:                        wctx,
      WReply:                      wreply,
      RedirectUrl:                 "",
      SAMLRequest:                 "",
      RelayState:                  "",
      __RequestVerificationToken:  csrfToken,
    },
    { tags: { step: "authenticate" }, redirects: 0 }
  );

  check(authRes, { "authenticate: got wresult form": (r) => r.body.indexOf("wresult") !== -1 });

  // Parse wresult + wctx from the auto-submit form body
  const wresultMatch = authRes.body.match(/name="wresult"\s+value="([^"]+)"/);
  const wctx2Match   = authRes.body.match(/name="wctx"\s+value="([^"]+)"/);
  const wresult      = wresultMatch ? wresultMatch[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"') : "";
  const wctx2        = wctx2Match   ? htmlDecode(wctx2Match[1]) : "";

  check(authRes, { "authenticate: wresult non-empty": () => wresult.length > 0 });

  // Step 4: POST wresult to the callback URL — this is what the browser JS auto-submits
  // k6 cookie jar stores the resulting session cookie automatically
  const callbackRes = http.post(
    `${BASE_URL}/api/auth/callback?redirectPath=/`,
    { wa: "wsignin1.0", wresult: wresult, wctx: wctx2 },
    { tags: { step: "callback" }, redirects: 10 }
  );
  trx_login.add(Date.now() - t0);

  const loginOk = check(callbackRes, {
    "login: landed on tac app":   (r) => r.url.indexOf("demo-app.example.com") !== -1,
    "login: status not 4xx/5xx":  (r) => r.status < 400,
  });

  if (!loginOk) {
    console.error(`[FAIL] Login — status ${callbackRes.status}, url: ${callbackRes.url}`);
    return;
  }

  sleep(0.5);

  // Step 4: GET /api/config — shell bootstrap signal (first meaningful authenticated response)
  // Session cookie sent automatically by k6 per-VU cookie jar
  const t1 = Date.now();
  const configRes = http.get(`${BASE_URL}/api/config`, {
    headers: { Accept: "application/json" },
    tags:    { step: "config", endpoint: "GET /api/config" },
  });
  trx_config.add(Date.now() - t1);

  check(configRes, {
    "config: status 200":    (r) => r.status === 200,
    "config: has manifests": (r) => {
      try { return JSON.parse(r.body).manifests.length > 0; } catch (_) { return false; }
    },
  });

  console.log(`[OK] GET /api/config → ${configRes.status} (${Date.now() - t1} ms)`);
}
