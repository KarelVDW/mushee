import { type Route } from '@playwright/test'

import { expect, MOCK_TITLE, test } from './fixtures'

/**
 * Mocked-API error-handling e2e: when the API server is unreachable the app
 * must explain itself on a full error page instead of rendering a dead UI,
 * and recover once the server is back.
 */

const API_PATTERN = 'http://localhost:4999/**'

test('library shows a full-page error while the server is down and recovers on retry', async ({ page, apiMock }) => {
    void apiMock
    const refuse = (route: Route) => route.abort('connectionrefused')
    await page.route(API_PATTERN, refuse)

    await page.goto('/scores')
    // React Query retries transient failures twice before surfacing the error.
    await expect(page.getByRole('heading', { name: "Can't reach the server" })).toBeVisible({ timeout: 15_000 })

    // Server comes back: the override is removed, the fixture mock answers again.
    await page.unroute(API_PATTERN, refuse)
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('button', { name: MOCK_TITLE })).toBeVisible()
})

test('editor shows a full-page error while the server is down', async ({ page, apiMock }) => {
    void apiMock
    const refuse = (route: Route) => route.abort('connectionrefused')
    await page.route(API_PATTERN, refuse)

    await page.goto('/scores/e2e-score-1')
    await expect(page.getByRole('heading', { name: "Can't reach the server" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Back to library' })).toBeVisible()
})
