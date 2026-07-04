import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config for the mocked-API editor suite.
 *
 * The web app is started on an ALTERNATE port (3300) so it doesn't collide with the
 * mushee dev server running on 3200. All backend traffic (scores API +
 * better-auth) is pointed at a dead origin (localhost:4999) and intercepted with
 * `page.route` in the tests — no real API, Postgres, or Mongo is required.
 *
 * The full-stack smoke suite lives in `playwright.fullstack.config.ts`.
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3300)
const MOCK_API_URL = 'http://localhost:4999'

export default defineConfig({
    testDir: './e2e',
    testMatch: '**/*.spec.ts',
    // The full-stack smoke runs under its own config; keep it out of the default run.
    testIgnore: '**/*.fullstack.spec.ts',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    timeout: 30_000,
    expect: { timeout: 10_000 },
    use: {
        baseURL: `http://localhost:${WEB_PORT}`,
        trace: 'on-first-retry',
        actionTimeout: 10_000,
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        // WebKit is the most behavior-divergent supported engine (Safari); running
        // the mocked-API suite against it catches Safari-only breakage without
        // needing a Mac-hosted real Safari.
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
    webServer: {
        command: `next dev --turbopack -p ${WEB_PORT}`,
        url: `http://localhost:${WEB_PORT}`,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        env: {
            // Point the client at a dead origin; the tests intercept every call to it.
            NEXT_PUBLIC_API_URL: MOCK_API_URL,
        },
    },
})
