import { defineConfig, devices } from '@playwright/test'

/**
 * Full-stack smoke config. Unlike the mocked editor suite, this runs against a
 * REAL, already-running stack:
 *   - the @mushee/api server (NestJS + Postgres + Mongo)
 *   - the web app
 *
 * Because the default ports are assumed occupied by another project, point this
 * at alternate ports via env vars. Nothing is auto-started here — bring the stack
 * up yourself (see e2e/README.md), then run `pnpm test:e2e:smoke`. The spec
 * auto-skips every test if the web app at E2E_WEB_URL isn't reachable.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3300'

export default defineConfig({
    testDir: './e2e',
    testMatch: '**/*.fullstack.spec.ts',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 1,
    reporter: 'list',
    timeout: 60_000,
    expect: { timeout: 15_000 },
    use: {
        baseURL: WEB_URL,
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
