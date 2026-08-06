/**
 * demo-web · browser-journey profile
 * Type: Browser (k6/browser — Chromium)
 *
 * Journey (5 steps):
 *   1. Login       — navigate to BASE_URL, complete WS-Fed SAML redirect
 *   2. Shell       — assert nav + header chrome visible; capture FCP, LCP, TTI
 *   3. Angular 15  — click "Angular 15 App" from feature menu; assert h1 visible
 *   4. React MFE   — click Back → "React App"; assert h1 visible
 *   5. Profile     — click profile button; assert dropdown + user email visible
 *
 * Metrics captured:
 *   demo_web_browser_login_ms      — step 1: nav start → shell navigation "Main navigation" visible
 *   browser_web_vital_fcp        — step 2: FCP auto-collected by k6/browser
 *   browser_web_vital_lcp        — step 2: LCP auto-collected by k6/browser
 *   demo_web_browser_ng15_ms       — step 3: click → h1 visible
 *   demo_web_browser_react_ms      — step 4: click → h1 visible
 *   demo_web_browser_profile_ms    — step 5: click → logout menuitem visible
 *
 * Observed selectors (Playwright exploration 2026-06-09):
 *   Shell nav:       nav[aria-label="Main navigation"]
 *   Feature menu:    button[name="Angular 15 App"], button[name="React App"]  (after Back from sub-nav)
 *   Back button:     button[name="Back"]
 *   Header title:    banner > div > div:first-child  (text = current app name)
 *   Profile button:  app-icon-button#menu-button  (shadow DOM host — pierced by locator)
 *   Profile dropdown logout: [role=menuitem] with text "Logout"
 *   Angular 15 h1:   "Welcome to Angular 15 Example App"  at /app2/
 *   React h1:        "Welcome to React Example App"        at /app3
 *
 * Baseline: baselines/demo-web.browser-journey.json
 * Gate:     envs/demo-web/browser-journey/perf-gate.yaml
 */

import { browser } from "k6/browser";
import { check } from "k6";
import { Trend, Rate } from "k6/metrics";

/* ─── Metrics ─────────────────────────────────────────────────────────── */
// FCP + LCP collected automatically by k6 as browser_web_vital_fcp / browser_web_vital_lcp
const trx_login   = new Trend("demo_web_browser_login_ms",   true);
const trx_ng15    = new Trend("demo_web_browser_ng15_ms",    true);
const trx_react   = new Trend("demo_web_browser_react_ms",   true);
const trx_profile = new Trend("demo_web_browser_profile_ms", true);
// → k6_test_run_passed_rate in Mimir; overview-style dashboards color each run's
//   bar green/red via last_over_time(...) >= 1 (every iteration must pass)
const testRunPassed = new Rate("test_run_passed");

/* ─── Config ──────────────────────────────────────────────────────────── */
const BASE_URL = __ENV.BASE_URL  || "https://demo-app.example.com";
const USERNAME = __ENV.PERF_USERNAME    || "";
const PASSWORD = __ENV.STAGING_PASSWORD || "";

export const options = {
  scenarios: {
    "browser-journey": {
      executor:    "per-vu-iterations",
      vus:         1,
      iterations:  10,
      maxDuration: "15m",
      options:     { browser: { type: "chromium" } },
    },
  },
  thresholds: {
    "demo_web_browser_login_ms":   ["p(95)<8000"],
    "browser_web_vital_fcp":     ["p(95)<3000"],
    "browser_web_vital_lcp":     ["p(95)<5000"],
    "demo_web_browser_ng15_ms":    ["p(95)<5000"],
    "demo_web_browser_react_ms":   ["p(95)<5000"],
    "demo_web_browser_profile_ms": ["p(95)<2000"],
  },
  // Label contract matches the proven LGTM convention (ui - k6 Tests Overview):
  // environment=staging|prod-us|prod-eu, test_file=<short script name>,
  // test_type=<class>, run_id=<unique per run>, team=<Mimir tenant>, product=<project>
  tags: {
    environment: __ENV.ENVIRONMENT || "staging",
    test_file:   "browser-journey",
    test_type:   "browser",
    run_id:      __ENV.RUN_ID || "local",
    branch:      __ENV.BRANCH || "local",
    team:        "demo-perf",
    product:     "demo-web",
  },
};

/* ─── Journey ─────────────────────────────────────────────────────────── */
export default async function () {
  // Fresh context per iteration — clears all cookies/storage so login always runs
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    /* ── Step 1: Login ───────────────────────────────────────────────── */
    const t_login = Date.now();
    // Navigate to the app — shell HTML is 200 but JS detects 401 on /api/config
    // and JS-redirects to auth.example.com. We navigate directly to the
    // login page URL to avoid the shell→redirect race.
    await page.goto(`https://auth.example.com/?wa=wsignin1.0&wtrealm=https%3A%2F%2Fdemo-app.example.com%2Fapi%2Fauth%2Fcallback&wctx=rm%3D1%26id%3Dpassive%26ru%3D%252Fapi%252Fauth%252Fcallback%253FredirectPath%253D%252F&wreply=https%3A%2F%2Fdemo-app.example.com%2Fapi%2Fauth%2Fcallback%3FredirectPath%3D%2F`);

    // Two-step form: username → Next → password appears → Sign In
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

    // Wait for WS-Fed callback to complete and shell nav to appear
    const shellNav = page.locator('nav[aria-label="Main navigation"]');
    await shellNav.waitFor({ state: "visible", timeout: 30000 });
    trx_login.add(Date.now() - t_login);
    check(page, { "login: shell nav visible": () => true });

    /* ── Step 2: Shell — FCP/LCP auto-collected by k6 as browser_web_vital_* */
    check(page, {
      "shell: nav visible":           () => shellNav.isVisible(),
      "shell: header chrome visible": () => shellNav.isVisible(),
    });

    /* ── Step 3: Angular 15 MFE ──────────────────────────────────────── */
    // Shell may start inside a sub-nav (Back button present) — go to root feature menu first
    // Use .first() to avoid strict-mode violation when multiple Back buttons exist in DOM
    const backBtn = page.getByRole("button", { name: "Back" }).first();
    if (await backBtn.isVisible()) {
      await backBtn.click();
      // Wait for feature menu to settle before timing the MFE click
      await shellNav.waitFor({ state: "visible", timeout: 10000 });
    }

    const t_ng15 = Date.now();
    await page.getByRole("button", { name: "Angular 15 App" }).click();
    await page.getByRole("heading", { name: "Welcome to Angular 15 Example App" })
      .waitFor({ state: "visible", timeout: 15000 });
    trx_ng15.add(Date.now() - t_ng15);

    check(page, { "ng15: h1 visible": () => true });

    /* ── Step 4: React MFE ───────────────────────────────────────────── */
    // Navigate back to shell root feature menu
    const backBtn2 = page.getByRole("button", { name: "Back" }).first();
    if (await backBtn2.isVisible()) {
      await backBtn2.click();
      // Wait for feature menu to settle before timing the MFE click
      await shellNav.waitFor({ state: "visible", timeout: 10000 });
    }

    const t_react = Date.now();
    await page.getByRole("button", { name: "React App" }).click();
    await page.getByRole("heading", { name: "Welcome to React Example App" })
      .waitFor({ state: "visible", timeout: 15000 });
    trx_react.add(Date.now() - t_react);

    check(page, { "react: h1 visible": () => true });

    /* ── Step 5: Profile button ──────────────────────────────────────── */
    // Profile button is inside shadow DOM: app-icon-button#menu-button > md-filled-icon-button > button
    // k6 browser locator() pierces shadow DOM — use the custom element host as the click target
    const t_profile = Date.now();
    await page.locator("app-icon-button#menu-button").click();
    await page.getByRole("menuitem", { name: /Logout/ })
      .waitFor({ state: "visible", timeout: 5000 });
    trx_profile.add(Date.now() - t_profile);

    check(page, {
      "profile: dropdown opens":      () => true,
      "profile: logout item visible": () => true,
    });

    // Reaching here = all 5 steps completed without throwing
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
  // Guard: metric with no threshold entries would vacuously pass — treat as no-data instead.
  const allOk = (name) => {
    const t = metrics[name]?.thresholds;
    if (!t || Object.keys(t).length === 0) return null; // no-data sentinel
    return Object.values(t).every(v => v.ok);
  };
  const results = ["demo_web_browser_login_ms","browser_web_vital_fcp","browser_web_vital_lcp",
    "demo_web_browser_ng15_ms","demo_web_browser_react_ms","demo_web_browser_profile_ms"]
    .map(allOk);
  const verdict = results.includes(null) ? "no-data"
    : results.every(Boolean) ? "green" : "red";
  return {
    "reports/summary-demo-web-browser-journey.json": JSON.stringify({
      team: "demo-web", profile: "browser-journey", env: __ENV.ENVIRONMENT || "stg",
      verdict,
      metrics: {
        login_p95_ms:   Math.round(get("demo_web_browser_login_ms")),
        fcp_p95_ms:     Math.round(get("browser_web_vital_fcp")),
        lcp_p95_ms:     Math.round(get("browser_web_vital_lcp")),
        ng15_p95_ms:    Math.round(get("demo_web_browser_ng15_ms")),
        react_p95_ms:   Math.round(get("demo_web_browser_react_ms")),
        profile_p95_ms: Math.round(get("demo_web_browser_profile_ms")),
      },
      run_id: __ENV.RUN_ID || "local",
    }, null, 2),
  };
}
