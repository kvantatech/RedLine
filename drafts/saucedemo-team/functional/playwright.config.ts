import { defineConfig } from '@playwright/test';

// saucedemo-team functional suite — targets Sauce Labs' public practice shop.
// External site: no webServer block; baseURL is static (required for scheduling).
export default defineConfig({
  testDir: './tests',
  // retries: 0 — flake detection is func-run-one's corroborate-2-sources gate,
  // never Playwright retries (see verify-playwright-suite hard rule 4).
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'https://www.saucedemo.com',
    // SauceDemo ships stable data-test attributes — use them as test ids.
    testIdAttribute: 'data-test',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
