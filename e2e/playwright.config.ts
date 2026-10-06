import { defineConfig } from '@playwright/test';

// Use the system Chrome/Edge channel by default (no browser download needed).
// Set PW_CHANNEL=chromium to use a Playwright-managed Chromium instead.
const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    headless: true,
    baseURL: 'http://127.0.0.1:7391',
    ...(channel === 'chromium' ? {} : { channel: channel as 'chrome' | 'msedge' }),
  },
  webServer: {
    command: 'npx tsx server.ts',
    url: 'http://127.0.0.1:7391/health',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'web', testMatch: /web\.spec\.ts/ },
    { name: 'electron', testMatch: /electron\.spec\.ts/ },
  ],
});
