import { expect, MOCK_SHARE_TOKEN, MOCK_TITLE, mockBilling, test } from './fixtures'

/**
 * The public read-only score page behind a share link. Uses the apiMock routes
 * (the public endpoint needs no session, but the mock installs them all).
 */

test('a valid share link renders the score read-only with its title, export and a sign-up path', async ({ page, apiMock }) => {
    void apiMock
    await page.goto(`/s/${MOCK_SHARE_TOKEN}`)

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(MOCK_TITLE)
    // The tab is named after the score once the token resolves (the server-rendered title is generic
    // in this hermetic run: the mock API only exists inside the browser).
    await expect(page).toHaveTitle(`${MOCK_TITLE} — Solkey`)
    const score = page.getByTestId('shared-score')
    await expect(score.locator('svg').first()).toBeVisible()
    expect(await score.locator('svg line').count()).toBeGreaterThanOrEqual(5)

    // No editing chrome on a shared view.
    await expect(page.getByRole('button', { name: 'Record' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Note duration' })).toHaveCount(0)

    // The player bar: a labelled Download chip (its name carries its visible text) with the formats inside.
    const download = page.getByRole('button', { name: 'Download score' })
    await expect(download).toBeVisible()
    await expect(download).toContainText('Download')
    await download.click()
    const formats = page.getByRole('group', { name: 'Export format' })
    for (const name of ['PDF', 'MIDI', 'MusicXML']) await expect(formats.getByRole('button', { name })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(formats).toHaveCount(0)

    // Playback: the play button arms once samples resolve (or fail, in this hermetic run) and toggles to Pause.
    // Stop only appears once something plays — never as a disabled ghost.
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0)
    const play = page.getByRole('button', { name: 'Play' })
    await expect(play).toBeEnabled({ timeout: 15000 })
    await play.click()
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
    // Stop leaves the bar once pressed; a keyboard user keeps their place on Play rather than dropping to <body>.
    const stop = page.getByRole('button', { name: 'Stop', exact: true })
    await stop.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Play' })).toBeFocused()
    await expect(stop).toHaveCount(0)
    // The header's one CTA: signed in, a link back to the library.
    await expect(page.getByRole('banner').getByRole('link', { name: /Open library|Start free/ })).toBeVisible()
    await expect(page.getByText('Want to change it? Save a copy to your library.')).toBeVisible()

    // Signed in (the mock session): the score can be saved as an editable copy of one's own.
    await page.getByRole('button', { name: 'Save a copy' }).click()
    await expect(page).toHaveURL(/\/scores\/e2e-created-1$/)
    expect(apiMock.creates.map((body) => body.title)).toEqual([MOCK_TITLE])
})

test('a copy refused by the score cap offers the upgrade, which opens Change plan on the next tier', async ({ page, apiMock }) => {
    void apiMock
    await mockBilling(page, { billingConfigured: true })
    await page.goto(`/s/${MOCK_SHARE_TOKEN}`)
    await expect(page.getByTestId('shared-score').locator('svg').first()).toBeVisible()

    // Registered after the fixture mock, so it wins: the server refuses the copy with the structured score-limit error.
    await page.route(
        (url) => url.pathname.endsWith('/scores'),
        (route) => {
            if (route.request().method() !== 'POST') return route.fallback()
            const origin = route.request().headers()['origin'] ?? '*'
            return route.fulfill({
                status: 403,
                contentType: 'application/json',
                headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
                body: JSON.stringify({ code: 'score-limit', message: 'Your Sketch plan holds up to 5 scores. Upgrade to add more.' }),
            })
        },
    )
    await page.getByRole('button', { name: 'Save a copy' }).click()
    const dialog = page.getByRole('dialog', { name: 'Your Sketch plan holds 5 scores.' })
    await expect(dialog).toBeVisible()

    // Like every upgrade moment, it lands on the plan tab with the next tier already picked.
    await dialog.getByRole('button', { name: 'See Songwriter' }).click()
    const changePlan = page.getByRole('dialog', { name: 'Change plan' })
    await expect(changePlan).toBeVisible()
    await expect(changePlan.getByRole('button', { pressed: true })).toContainText('For daily writers')
    await expect(page).toHaveURL(/\/settings\?tab=plan$/)
})

test('an unknown or revoked token explains itself instead of erroring', async ({ page, apiMock }) => {
    void apiMock
    await page.goto('/s/nosuchtoken00000000')
    // The explanation is the page's one heading, with a way to find out what Solkey is.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/doesn’t open anything/)
    await expect(page.getByTestId('shared-score')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'See what Solkey does' })).toHaveAttribute('href', '/')
    // No score name to show: the generic title stays. (A no-regression check — the server already
    // rendered this title, so it only proves the client effect does not overwrite it on a 404.)
    await expect(page).toHaveTitle('Shared score — Solkey')
})

test.describe('a stored document that is not MusicXML-JSON', () => {
    test.use({ rawDocument: true })

    test('a share link to it shows the load error instead of a score', async ({ page, apiMock }) => {
        void apiMock
        await page.goto(`/s/${MOCK_SHARE_TOKEN}`)
        await expect(page.getByRole('heading', { name: 'The score couldn’t be loaded.' })).toBeVisible()
        await expect(page.getByTestId('shared-score')).toHaveCount(0)
        // Nothing to take home: the raw text never becomes a score to copy or export.
        await expect(page.getByRole('button', { name: 'Save a copy' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Download score' })).toHaveCount(0)
    })
})

/** A one-bar score (a whole-note C) — enough for the signed-out page to engrave something. */
const ONE_BAR = {
    partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
    parts: [
        {
            id: 'P1',
            measures: [
                {
                    number: '1',
                    entries: [
                        { _type: 'attributes', divisions: 12, clef: [{ sign: 'G', line: 2 }], time: [{ beats: '4', beatType: '4' }] },
                        { _type: 'note', pitch: { step: 'C', octave: 4 }, duration: 48, voice: '1', type: 'whole' },
                    ],
                },
            ],
        },
    ],
}

test('a visitor without an account is sent to signup with the score as the way back', async ({ page }) => {
    await page.route(/^https?:\/\//, (route) => {
        const url = new URL(route.request().url())
        if (url.hostname !== 'localhost') return route.abort()
        if (url.pathname === `/shared/${MOCK_SHARE_TOKEN}`) {
            // The app fetches with credentials, so the answer names the origin rather than '*'.
            const headers = {
                'access-control-allow-origin': route.request().headers()['origin'] ?? '*',
                'access-control-allow-credentials': 'true',
                'access-control-allow-headers': 'content-type',
            }
            if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' })
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers,
                body: JSON.stringify({
                    id: 'x',
                    title: MOCK_TITLE,
                    updatedAt: '2026-01-01T00:00:00.000Z',
                    document: ONE_BAR,
                }),
            })
        }
        return route.continue()
    })
    await page.goto(`/s/${MOCK_SHARE_TOKEN}`)
    // Under the score, one plain line about what made it, with the same way in.
    await expect(page.getByText('Made with Solkey — hum, sing or play a melody and get sheet music like this.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Try it free' })).toHaveAttribute(
        'href',
        `/signup?next=${encodeURIComponent(`/s/${MOCK_SHARE_TOKEN}`)}`,
    )
    await page.getByRole('banner').getByRole('link', { name: 'Start free' }).click()
    await expect(page).toHaveURL(new RegExp(`/signup\\?next=${encodeURIComponent(`/s/${MOCK_SHARE_TOKEN}`).replace(/%/g, '%')}$`))
})
