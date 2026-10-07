import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 90000, expect: { timeout: 20000 }, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://localhost:3117', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }, { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } }, { name: 'webkit', use: { ...devices['Desktop Safari'] } }, { name: 'firefox', use: { ...devices['Desktop Firefox'] } }],
  webServer: { command: 'npm run test:serve', url: 'http://localhost:3117/api/v1/health', timeout: 120000, reuseExistingServer: true }
});
