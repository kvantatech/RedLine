/**
 * saucedemo-team · browser-journey profile
 * Type: Browser (k6/browser — Chromium)
 *
 * Target:  https://www.saucedemo.com — Sauce Labs' public automation practice
 *          shop. Credentials are printed on the login page itself (public demo
 *          material, not secrets).
 *
 * Journey (3 pages):
 *   1. Login     — goto /, fill standard_user/secret_sauce, submit → inventory visible
 *   2. Add item  — click "Add to cart" on Sauce Labs Backpack → cart badge = 1
 *   3. Cart      — click cart link → cart page shows the added item
 *
 * Metrics captured:
 *   saucedemo_browser_login_ms    — step 1: nav start → inventory list visible
 *   saucedemo_browser_addcart_ms  — step 2: click → badge visible
 *   saucedemo_browser_cart_ms     — step 3: click → cart item visible
 *   browser_web_vital_fcp / _lcp  — auto-collected by k6/browser
 *
 * Observed selectors (probe 2026-07-19; SauceDemo ships stable data-test attrs):
 *   #user-name · #password · #login-button · .inventory_list
 *   button[data-test="add-to-cart-sauce-labs-backpack"]
 *   .shopping_cart_badge · .shopping_cart_link · .cart_item
 *
 * Baseline: baselines/saucedemo-team.browser-journey.json
 * Gate:     live/saucedemo-team/browser-journey/perf-gate.yaml
 */

import { browser } from "k6/browser";
import { check } from "k6";
import { Trend, Rate } from "k6/metrics";

/* ─── Metrics ─────────────────────────────────────────────────────────── */
const trxLogin   = new Trend("saucedemo_browser_login_ms",   true);
const trxAddCart = new Trend("saucedemo_browser_addcart_ms", true);
const trxCart    = new Trend("saucedemo_browser_cart_ms",    true);
const testRunPassed = new Rate("test_run_passed");

/* ─── Config ──────────────────────────────────────────────────────────── */
const BASE_URL = __ENV.BASE_URL || "https://www.saucedemo.com";
// Public demo credentials, printed on the login page — not secrets.
const USERNAME = __ENV.SAUCE_USERNAME || "standard_user";
const PASSWORD = __ENV.SAUCE_PASSWORD || "secret_sauce";

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
    // Red thresholds — source of truth: baselines/saucedemo-team.browser-journey.json
    "saucedemo_browser_login_ms":   ["p(95)<8000"],
    "saucedemo_browser_addcart_ms": ["p(95)<2000"],
    "saucedemo_browser_cart_ms":    ["p(95)<5000"],
    "browser_web_vital_fcp":        ["p(95)<3000"],
    "browser_web_vital_lcp":        ["p(95)<5000"],
  },
  tags: {
    environment: __ENV.ENVIRONMENT || "staging",
    test_file:   "browser-journey",
    test_type:   "browser",
    run_id:      __ENV.RUN_ID || "local",
    branch:      __ENV.BRANCH || "local",
    team:        "demo-perf",
    product:     "saucedemo-team",
  },
};

/* ─── Journey ─────────────────────────────────────────────────────────── */
export default async function () {
  // Fresh context per iteration — clears cookies/storage so login always runs
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    /* ── Step 1: Login → inventory ───────────────────────────────────── */
    const tLogin = Date.now();
    await page.goto(`${BASE_URL}/`);
    await page.locator("#user-name").fill(USERNAME);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#login-button").click();
    const inventory = page.locator(".inventory_list");
    await inventory.waitFor({ state: "visible", timeout: 15000 });
    trxLogin.add(Date.now() - tLogin);
    check(page, { "login: inventory visible": () => true });

    /* ── Step 2: Add backpack to cart ────────────────────────────────── */
    const tAdd = Date.now();
    await page.locator('button[data-test="add-to-cart-sauce-labs-backpack"]').click();
    const badge = page.locator(".shopping_cart_badge");
    await badge.waitFor({ state: "visible", timeout: 5000 });
    trxAddCart.add(Date.now() - tAdd);
    const badgeText = await badge.textContent();
    check(page, { "cart badge shows 1": () => badgeText.trim() === "1" });

    /* ── Step 3: Cart page shows the item ────────────────────────────── */
    const tCart = Date.now();
    await page.locator(".shopping_cart_link").click();
    const cartItem = page.locator(".cart_item");
    await cartItem.waitFor({ state: "visible", timeout: 10000 });
    trxCart.add(Date.now() - tCart);
    check(page, { "cart: item visible": () => true });

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
  // Guard: metric with no threshold entries would vacuously pass — no-data instead.
  const allOk = (name) => {
    const t = metrics[name]?.thresholds;
    if (!t || Object.keys(t).length === 0) return null;
    return Object.values(t).every(v => v.ok);
  };
  const results = ["saucedemo_browser_login_ms","saucedemo_browser_addcart_ms",
    "saucedemo_browser_cart_ms","browser_web_vital_fcp","browser_web_vital_lcp"].map(allOk);
  const verdict = results.includes(null) ? "no-data"
    : results.every(Boolean) ? "green" : "red";
  return {
    "reports/summary-saucedemo-team-browser-journey.json": JSON.stringify({
      team: "saucedemo-team", profile: "browser-journey", env: __ENV.ENVIRONMENT || "stg",
      verdict,
      metrics: {
        login_p95_ms:   get("saucedemo_browser_login_ms")   != null ? Math.round(get("saucedemo_browser_login_ms"))   : null,
        addcart_p95_ms: get("saucedemo_browser_addcart_ms") != null ? Math.round(get("saucedemo_browser_addcart_ms")) : null,
        cart_p95_ms:    get("saucedemo_browser_cart_ms")    != null ? Math.round(get("saucedemo_browser_cart_ms"))    : null,
        fcp_p95_ms:     get("browser_web_vital_fcp")        != null ? Math.round(get("browser_web_vital_fcp"))        : null,
        lcp_p95_ms:     get("browser_web_vital_lcp")        != null ? Math.round(get("browser_web_vital_lcp"))        : null,
      },
      run_id: __ENV.RUN_ID || "local",
    }, null, 2),
  };
}
