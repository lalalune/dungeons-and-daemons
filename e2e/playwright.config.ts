import { defineConfig, devices } from '@playwright/test';

const SERVER_PORT = 3344;
const CLIENT_PORT = 3345;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 90_000,
  expect: { timeout: 20_000 },

  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: [
    {
      command: 'cd .. && npm run dev:server',
      port: SERVER_PORT,
      reuseExistingServer: true,
      timeout: 30_000,
      env: { PORT: String(SERVER_PORT), NODE_ENV: 'test' },
    },
    {
      command: 'cd .. && npm run dev:client',
      port: CLIENT_PORT,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
