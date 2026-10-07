import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/vercel',timeout:90000,expect:{timeout:20000},workers:1,
  use:{baseURL:'http://localhost:3118',...devices['Desktop Chrome'],channel:'chrome',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'npm run test:serve:vercel',url:'http://localhost:3118/api/v1/health',timeout:120000,reuseExistingServer:false},
});
