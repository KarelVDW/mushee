import { expect, MOCK_SHARE_TOKEN, MOCK_TITLE, test } from './fixtures'

/**
 * The public read-only score page behind a share link. Uses the apiMock routes
 * (the public endpoint needs no session, but the mock installs them all).
 */

test('a valid share link renders the score read-only with its title, export and a sign-up path', async ({ page, apiMock }) => {
    void apiMock
    await page.goto(`/s/${MOCK_SHARE_TOKEN}`)

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(MOCK_TITLE)
    const score = page.getByTestId('shared-score')
    await expect(score.locator('svg').first()).toBeVisible()
    expect(await score.locator('svg line').count()).toBeGreaterThanOrEqual(5)

    // No editing chrome on a shared view.
    await expect(page.getByRole('button', { name: 'Record' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Note duration' })).toHaveCount(0)

    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
    // Playback: the play button arms once samples resolve (or fail, in this hermetic run) and toggles to Pause.
    const play = page.getByRole('button', { name: 'Play' })
    await expect(play).toBeEnabled({ timeout: 15000 })
    await play.click()
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
    await page.getByRole('button', { name: 'Stop' }).click()
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Library|Start free/ })).toBeVisible()

    // Signed in (the mock session): the score can be saved as an editable copy of one's own.
    await page.getByRole('button', { name: 'Save a copy' }).click()
    await expect(page).toHaveURL(/\/scores\/e2e-created-1$/)
    expect(apiMock.creates.map((body) => body.title)).toEqual([MOCK_TITLE])
})

test('an unknown or revoked token explains itself instead of erroring', async ({ page, apiMock }) => {
    void apiMock
    await page.goto('/s/nosuchtoken00000000')
    await expect(page.getByRole('heading', { name: /doesn’t open anything/ })).toBeVisible()
    await expect(page.getByTestId('shared-score')).toHaveCount(0)
})

test('a visitor without an account is sent to signup with the score as the way back', async ({ page }) => {
    await page.route(/^https?:\/\//, (route) => {
        const url = new URL(route.request().url())
        if (url.hostname !== 'localhost') return route.abort()
        if (url.pathname === `/shared/${MOCK_SHARE_TOKEN}`) {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers: { 'access-control-allow-origin': '*' },
                body: JSON.stringify({
                    id: 'x',
                    title: MOCK_TITLE,
                    updatedAt: '2026-01-01T00:00:00.000Z',
                    document: { partList: { scoreParts: [] }, parts: [] },
                }),
            })
        }
        return route.continue()
    })
    await page.goto(`/s/${MOCK_SHARE_TOKEN}`)
    await page.getByRole('button', { name: 'Start free' }).click()
    await expect(page).toHaveURL(new RegExp(`/signup\\?next=${encodeURIComponent(`/s/${MOCK_SHARE_TOKEN}`).replace(/%/g, '%')}$`))
})
