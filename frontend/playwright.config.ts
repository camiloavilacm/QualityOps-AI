import { defineConfig, devices } from '@playwright/test'

const external = process.env.PW_BASE_URL
if (external && !/^http:\/\/127\.0\.0\.1:\d+(?:\/)?$/.test(external)) throw new Error('PW_BASE_URL must be IPv4 loopback')
const baseURL = external ?? 'http://127.0.0.1:4183'
const chromium = { ...devices['Desktop Chrome'], channel: 'chromium', launchOptions: { chromiumSandbox: true, args: ['--enable-features=WebMCP'] } }
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 20_000,
  globalTimeout: 240_000,
  reporter: [['list']],
  outputDir: process.env.PW_OUTPUT_DIR ?? 'artifacts/test-results',
  use: { baseURL, actionTimeout: 5_000, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testMatch: /(?:seed|mixed-campaign|dashboard-flows)\.spec\.ts$/, testIgnore: [/meta\//, /webmcp\.spec\.ts$/], use: chromium },
    { name: 'chromium-guard-meta', testMatch: /meta\/guard-verification\.spec\.ts$/, testIgnore: [/webmcp/], use: chromium },
    { name: 'chromium-webmcp', testMatch: /tests\/webmcp\.spec\.ts$/, testIgnore: [/meta\//], use: chromium },
    { name: 'chromium-webmcp-lifecycle', testMatch: /meta\/webmcp-lifecycle\.spec\.ts$/, testIgnore: [/guard-verification/], use: chromium },
  ],
  webServer: external ? undefined : { command: 'npm run preview -- --port 4183', url: baseURL, reuseExistingServer: false, timeout: 30_000 },
})
