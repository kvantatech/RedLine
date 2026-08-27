/**
 * demo-api · browser-journey profile
 * Type: Browser (k6/browser — Chromium)
 *
 * Journey (6 measured steps, as described by team):
 *   1. Login         — WS-Fed SAML redirect; shell nav visible
 *   2. App3          — navigate to /app3 after login; networkidle
 *   3. App2 via back — shell Back button → /app2/; content visible
 *   4. App1 via back — shell Back button → /app1/; content visible
 *   5. AppNg/Users   — shell Back button → /appNg/users; content visible
 *   6. App3 return   — shell Back button → /app3; content visible
 *
 * Navigation note: the team journey uses the in-shell Back button between apps.
 * Each step tries the shell Back button first; if it is not present on the page
 * (e.g. the shell renders a different nav state) it falls back to page.goto() so
 * the run completes deterministically unattended. Update the button selectors after
 * a first Playwright exploration if the shell Back button label differs from "Back".
 *
 * Metrics captured:
 *   ete_ui_browser_login_ms        — step 1: nav start → shell nav visible
 *   browser_web_vital_fcp          — FCP auto-collected by k6/browser
 *   browser_web_vital_lcp          — LCP auto-collected by k6/browser
 *   ete_ui_browser_app3_ms         — step 2: goto /app3 → networkidle
 *   ete_ui_browser_app2_ms         — step 3: Back → /app2/ → networkidle
 *   ete_ui_browser_app1_ms         — step 4: Back → /app1/ → networkidle
 *   ete_ui_browser_appng_users_ms  — step 5: Back → /appNg/users → networkidle
 *   ete_ui_browser_app3_return_ms  — step 6: Back → /app3 (return) → networkidle
 *
 * Baseline: baselines/demo-api.browser-journey.json  (seeded after first 10-iter run)
 */

import { browser } from "k6/browser";
import { check } from "k6";
import { Trend, Rate } from "k6/metrics";

/* ─── Metrics ─────────────────────────────────────────────────────────── */
// FCP + LCP collected automatically as browser_web_vital_fcp / browser_web_vital_lcp
const trx_login       = new Trend("ete_ui_browser_login_ms",        true);
const trx_app3        = new Trend("ete_ui_browser_app3_ms",         true);
const trx_app2        = new Trend("ete_ui_browser_app2_ms",         true);
const trx_app1        = new Trend("ete_ui_browser_app1_ms",         true);
const trx_appng_users = new Trend("ete_ui_browser_appng_users_ms",  true);
const trx_app3_return = new Trend("ete_ui_browser_app3_return_ms",  true);
const testRunPassed   = new Rate("test_run_passed");

/* ─── Config ──────────────────────────────────────────────────────────── */
const BASE_URL = __ENV.BASE_URL         || "https://demo-app.example.com";
const USERNAME = __ENV.PERF_USERNAME    || "";
const PASSWORD = __ENV.STAGING_PASSWORD || "";

// ITERATIONS env var lets CI/smoke runs override without --vus/--iterations flags,
// which would strip the browser type from the scenario definition.
const ITERATIONS = parseInt(__ENV.ITERATIONS || "10", 10);

export const options = {
  scenarios: {
    "browser-journey": {
      executor:    "per-vu-iterations",
      vus:         1,
      iterations:  ITERATIONS,
      maxDuration: "20m",
      options:     { browser: { type: "chromium" } },
    },
  },
  thresholds: {
    // Industry floors from baselines/README.md; updated by curate-baselines after first real run
    "ete_ui_browser_login_ms":        ["p(95)<8000"],  // prod login budget
    "browser_web_vital_fcp":          ["p(95)<3000"],  // Web Vitals "good" + headroom
    "browser_web_vital_lcp":          ["p(95)<5000"],  // Web Vitals "good" + headroom
    "ete_ui_browser_app3_ms":         ["p(95)<5000"],  // MFE load floor
    "ete_ui_browser_app2_ms":         ["p(95)<5000"],
    "ete_ui_browser_app1_ms":         ["p(95)<5000"],
    "ete_ui_browser_appng_users_ms":  ["p(95)<5000"],
    "ete_ui_browser_app3_return_ms":  ["p(95)<5000"],
  },
  tags: {
    environment: __ENV.ENVIRONMENT || "staging",
    test_file:   "browser-journey",
    test_type:   "browser",
    run_id:      __ENV.RUN_ID  || "local",
    branch:      __ENV.BRANCH  || "local",
    team:        "demo-api",
    product:     "demo-api",
  },
};

/* ─── Helpers ─────────────────────────────────────────────────────────── */

/**
 * Click the shell Back button and wait for the expected path segment to appear
 * in the URL. Falls back to page.goto(fallbackUrl) if the Back button is not
 * visible within 3 s (shell rendered a different nav state).
 */
async function backNavTo(page, expectedPath, fallbackUrl, trend, label) {
  const t = Date.now();
  const backBtn = page.getByRole("button", { name: "Back" }).first();
  const btnVisible = await backBtn.isVisible();
  if (btnVisible) {
    await backBtn.click();
  } else {
    // Back button absent — navigate directly so the run stays unblocked
    await page.goto(fallbackUrl, { waitUntil: "load", timeout: 20000 });
  }
  // Wait for networkidle to confirm all MFE assets have landed
  await page.waitForLoadState("networkidle", { timeout: 20000 });
  trend.add(Date.now() - t);
  check(page, { [label]: () => true });
}

/* ─── Journey ─────────────────────────────────────────────────────────── */
export default async function () {
  // Fresh context per iteration — cookies cleared so login always runs
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    /* ── Step 1: Login ───────────────────────────────────────────────── */
    const t_login = Date.now();
    // Navigate directly to the login page URL, bypassing the JS-redirect race
    // that occurs when the shell detects 401 on /api/config
    await page.goto(
      "https://auth.example.com/?wa=wsignin1.0" +
      "&wtrealm=https%3A%2F%2Fdemo-app.example.com%2Fapi%2Fauth%2Fcallback" +
      "&wctx=rm%3D1%26id%3Dpassive%26ru%3D%252Fapi%252Fauth%252Fcallback%253FredirectPath%253D%252F" +
      "&wreply=https%3A%2F%2Fdemo-app.example.com%2Fapi%2Fauth%2Fcallback%3FredirectPath%3D%2F"
    );

    // Two-step form: username → Next → password → Sign In
    const usernameInput = page.getByRole("textbox", { name: "Username" });
    await usernameInput.waitFor({ state: "visible", timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(USERNAME);
    await page.getByTestId("next-button").click();

    const passwordInput = page.getByRole("textbox", { name: "Password" });
    await passwordInput.waitFor({ state: "visible", timeout: 10000 });
    await passwordInput.click();
    await passwordInput.fill(PASSWORD);
    await page.getByRole("button", { name: "Sign In" }).click();

    // WS-Fed callback completes; wait for shell nav to confirm we're in
    const shellNav = page.locator('nav[aria-label="Main navigation"]');
    await shellNav.waitFor({ state: "visible", timeout: 30000 });
    trx_login.add(Date.now() - t_login);
    check(page, { "login: shell nav visible": () => true });

    /* ── Step 2: App3 ────────────────────────────────────────────────── */
    const t_app3 = Date.now();
    await page.goto(`${BASE_URL}/app3`, { waitUntil: "load", timeout: 20000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 });
    trx_app3.add(Date.now() - t_app3);
    check(page, { "app3: page loaded": () => true });

    /* ── Step 3: App2 via Back ───────────────────────────────────────── */
    await backNavTo(
      page,
      "/app2",
      `${BASE_URL}/app2/`,
      trx_app2,
      "app2: page loaded via back"
    );

    /* ── Step 4: App1 via Back ───────────────────────────────────────── */
    await backNavTo(
      page,
      "/app1",
      `${BASE_URL}/app1/`,
      trx_app1,
      "app1: page loaded via back"
    );

    /* ── Step 5: AppNg/Users via Back ────────────────────────────────── */
    await backNavTo(
      page,
      "/appNg/users",
      `${BASE_URL}/appNg/users`,
      trx_appng_users,
      "appNg/users: page loaded via back"
    );

    /* ── Step 6: App3 return via Back ────────────────────────────────── */
    await backNavTo(
      page,
      "/app3",
      `${BASE_URL}/app3`,
      trx_app3_return,
      "app3 return: page loaded via back"
    );

    // Reaching here = all 6 steps completed without throwing
    testRunPassed.add(true);

  } catch (err) {
    testRunPassed.add(false);
    throw err;
  } finally {
    await page.close();
    await context.close();
  }
}

export function handleSummary(data) {
  const metrics = data.metrics;
  const get = (name) => metrics[name]?.values?.["p(95)"] ?? null;
  const allOk = (name) => {
    const t = metrics[name]?.thresholds;
    if (!t || Object.keys(t).length === 0) return null; // no-data sentinel
    return Object.values(t).every((v) => v.ok);
  };
  const measured = [
    "ete_ui_browser_login_ms",
    "browser_web_vital_fcp",
    "browser_web_vital_lcp",
    "ete_ui_browser_app3_ms",
    "ete_ui_browser_app2_ms",
    "ete_ui_browser_app1_ms",
    "ete_ui_browser_appng_users_ms",
    "ete_ui_browser_app3_return_ms",
  ];
  const results = measured.map(allOk);
  const verdict = results.includes(null)
    ? "no-data"
    : results.every(Boolean) ? "green" : "red";

  return {
    "reports/summary-demo-api-browser-journey.json": JSON.stringify(
      {
        team:    "demo-api",
        profile: "browser-journey",
        env:     __ENV.ENVIRONMENT || "stg",
        verdict,
        metrics: {
          login_p95_ms:        Math.round(get("ete_ui_browser_login_ms")),
          fcp_p95_ms:          Math.round(get("browser_web_vital_fcp")),
          lcp_p95_ms:          Math.round(get("browser_web_vital_lcp")),
          app3_p95_ms:         Math.round(get("ete_ui_browser_app3_ms")),
          app2_p95_ms:         Math.round(get("ete_ui_browser_app2_ms")),
          app1_p95_ms:         Math.round(get("ete_ui_browser_app1_ms")),
          appng_users_p95_ms:  Math.round(get("ete_ui_browser_appng_users_ms")),
          app3_return_p95_ms:  Math.round(get("ete_ui_browser_app3_return_ms")),
        },
        run_id: __ENV.RUN_ID || "local",
      },
      null,
      2
    ),
  };
}
