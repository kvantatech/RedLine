import { defineConfig } from '@playwright/test';
import path from 'node:path';

// This suite tests the RedLine dashboard itself (the functional pilot team).
// The suite lives at envs|drafts/redline-dashboard/functional/; the repo root
// is three levels up. The dashboard server reads ./dashboard, ./state, ./envs
// relative to its cwd, so the auto-started webServer must run from the repo root.
const repoRoot = path.resolve(__dirname, '../../..');

export default defineConfig({
  testDir: './tests',
  // retries: 0 — flake detection is func-run-one's corroborate-2-sources gate,
  // never Playwright retries (see verify-playwright-suite hard rule 4).
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4242',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node dashboard/server.mjs --no-open',
    cwd: repoRoot,
    url: 'http://127.0.0.1:4242/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
