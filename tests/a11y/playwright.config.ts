import { defineConfig } from '@playwright/test';
import path from 'node:path';

// Accessibility scan of the RedLine dashboard's own UI. Starts the dashboard
// from the repo root (it reads ./dashboard, ./state, ./envs relative to cwd)
// and runs axe-core against every top-level route.
const repoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  testDir: '.',
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4242',
  },
  webServer: {
    command: 'node dashboard/server.mjs --no-open',
    cwd: repoRoot,
    url: 'http://127.0.0.1:4242/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
