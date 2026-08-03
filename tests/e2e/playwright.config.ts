import { defineConfig } from '@playwright/test';

/**
 * E2E runs against the Vite dev server in browser demo mode: the IPC layer
 * serves a deterministic synthetic repository, so every screen is testable
 * without a native Tauri build.
 */
export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:1420',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'pnpm --filter @angkorgit/desktop dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
