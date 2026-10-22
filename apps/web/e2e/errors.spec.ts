import { type Route } from '@playwright/test'

import { expect, MOCK_SCORE_ID, MOCK_TITLE, test } from './fixtures'

/**
 * Mocked-API error-handling e2e: when the API server is unreachable the app
 * must explain itself on a full error page instead of rendering a dead UI,
 * and recover once the server is back. A stored document the editor can't read
 * (raw MusicXML text) takes the same error page, never an editor that would
 * autosave a reconstruction over it.
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
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()
})

test('editor shows a full-page error while the server is down', async ({ page, apiMock }) => {
    void apiMock
    const refuse = (route: Route) => route.abort('connectionrefused')
    await page.route(API_PATTERN, refuse)

    await page.goto('/scores/e2e-score-1')
    await expect(page.getByRole('heading', { name: "Can't reach the server" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Back to library' })).toBeVisible()
})

test.describe('a stored document that is not MusicXML-JSON', () => {
    test.use({ rawDocument: true })

    test('editor shows the load error instead of opening (and autosaving over) the raw document', async ({ page, apiMock }) => {
        await page.goto(`/scores/${MOCK_SCORE_ID}`)
        await expect(page.getByRole('heading', { name: "This score couldn't be loaded" })).toBeVisible()
        // No editor behind it: neither the engraved score nor the editor's keyboard container.
        await expect(page.locator('.max-w-240 svg')).toHaveCount(0)
        await expect(page.locator('div[tabindex="0"]')).toHaveCount(0)

        // An attempted edit reaches no score, so nothing is written back over the stored file —
        // waited out past the autosave's 2s debounce.
        await page.keyboard.press('c')
        await page.keyboard.press('ArrowUp')
        await page.waitForTimeout(2500)
        expect(apiMock.patches).toEqual([])
    })
})
