import { expect, MOCK_SCORE_ID, MOCK_TITLE, test } from './fixtures'

/**
 * Mocked-API library (scores list) e2e: listing, opening a score, the create
 * flow (which serializes a fresh Score through the model in the browser), and
 * deletion via the styled confirmation dialog.
 */

test.beforeEach(({ apiMock }) => {
    void apiMock
})

test('lists scores and opens one in the editor', async ({ page }) => {
    await page.goto('/scores')
    await expect(page.getByRole('heading', { name: 'Your scores' })).toBeVisible()

    const openRow = page.getByRole('button', { name: MOCK_TITLE, exact: true })
    await expect(openRow).toBeVisible()
    await openRow.click()

    await expect(page).toHaveURL(new RegExp('/scores/'))
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
})

test('creates a new score and navigates into it', async ({ page, apiMock }) => {
    await page.goto('/scores')
    await page.getByRole('button', { name: 'New score' }).click()

    await page.getByLabel('Title', { exact: true }).fill('My E2E Sonata')
    await page.getByRole('button', { name: 'Create score' }).click()

    // The POST body carries a model-serialized starting score (one completed measure).
    await expect.poll(() => apiMock.creates.length).toBeGreaterThan(0)
    const body = apiMock.creates[0]
    expect(body.title).toBe('My E2E Sonata')
    expect(body.score).toBeTruthy()

    await expect(page).toHaveURL(/\/scores\/e2e-created-1$/)
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
})

test('deletes a score after confirmation, then shows the first-score empty state', async ({ page, apiMock }) => {
    await page.goto('/scores')
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()

    await page.getByRole('button', { name: `Delete ${MOCK_TITLE}` }).click()
    await expect(page.getByRole('dialog', { name: 'Delete this score?' })).toBeVisible()
    await page.getByRole('button', { name: 'Delete score' }).click()

    await expect.poll(() => apiMock.deletes.length).toBeGreaterThan(0)
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toHaveCount(0)

    // The library is now empty; the first-score empty state takes over and its
    // CTA opens the create dialog.
    await expect(page.getByText('No scores yet.')).toBeVisible()
    await page.getByRole('button', { name: 'New score' }).last().click()
    await expect(page.getByRole('dialog', { name: 'New score' })).toBeVisible()
})

test('the delete dialog can be declined, dismissed with Escape, and closed — nothing is deleted', async ({ page, apiMock }) => {
    await page.goto('/scores')

    // "Keep it" declines.
    await page.getByRole('button', { name: `Delete ${MOCK_TITLE}` }).click()
    await page.getByRole('button', { name: 'Keep it' }).click()
    await expect(page.getByRole('dialog', { name: 'Delete this score?' })).toHaveCount(0)

    // Escape dismisses.
    await page.getByRole('button', { name: `Delete ${MOCK_TITLE}` }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Delete this score?' })).toHaveCount(0)

    // The × closes.
    await page.getByRole('button', { name: `Delete ${MOCK_TITLE}` }).click()
    await page.getByRole('dialog', { name: 'Delete this score?' }).getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog', { name: 'Delete this score?' })).toHaveCount(0)

    // No DELETE ever reached the API and the row is still there.
    expect(apiMock.deletes).toHaveLength(0)
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()
})

test('a failed delete surfaces an error toast and keeps the row', async ({ page, apiMock }) => {
    void apiMock
    await page.goto('/scores')
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()

    // Registered after the fixture mock, so it wins: the server refuses the delete.
    await page.route(
        (url) => url.pathname.includes('/scores/'),
        (route) =>
            route.request().method() === 'DELETE'
                ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
                : route.fallback(),
    )

    await page.getByRole('button', { name: `Delete ${MOCK_TITLE}` }).click()
    await page.getByRole('button', { name: 'Delete score' }).click()

    await expect(page.getByText('Could not delete the score. Please try again.')).toBeVisible()
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()
})

test('hitting the score cap opens the upgrade dialog instead of an error toast', async ({ page, apiMock }) => {
    void apiMock
    await page.goto('/scores')

    // Registered after the fixture mock, so it wins: the server refuses the
    // create with the structured score-limit error. CORS headers are needed
    // because the app must be able to read the body to see the code.
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

    await page.getByRole('button', { name: 'New score' }).click()
    await page.getByLabel('Title', { exact: true }).fill('One Too Many')
    await page.getByRole('button', { name: 'Create score' }).click()

    // The tier-aware upgrade dialog appears, with no failure toast doubling it up.
    const dialog = page.getByRole('dialog', { name: 'Your Sketch plan holds up to 5 scores.' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Upgrade to Songwriter' })).toBeVisible()
    await expect(page.getByText('Could not create the score. Please try again.')).toHaveCount(0)

    // "Not now" dismisses; the library stays as it was.
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()
})

test('the create dialog validates, submits on Enter, and can be cancelled', async ({ page, apiMock }) => {
    await page.goto('/scores')
    await page.getByRole('button', { name: 'New score' }).click()
    const dialog = page.getByRole('dialog', { name: 'New score' })
    await expect(dialog).toBeVisible()

    // Create is disabled until the title is non-blank (whitespace doesn't count).
    const create = page.getByRole('button', { name: 'Create score' })
    await expect(create).toBeDisabled()
    await page.getByLabel('Title', { exact: true }).fill('   ')
    await expect(create).toBeDisabled()

    // Cancel closes without creating.
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    expect(apiMock.creates).toHaveLength(0)

    // Escape also closes.
    await page.getByRole('button', { name: 'New score' }).click()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // Enter in the title field submits.
    await page.getByRole('button', { name: 'New score' }).click()
    await page.getByLabel('Title', { exact: true }).fill('Enter Submit Étude')
    await page.keyboard.press('Enter')
    await expect.poll(() => apiMock.creates.length).toBe(1)
    expect(apiMock.creates[0].title).toBe('Enter Submit Étude')
    await expect(page).toHaveURL(/\/scores\/e2e-created-1$/)
})

test('picking an instrument in the create dialog is carried into the new score', async ({ page, apiMock }) => {
    await page.goto('/scores')
    await page.getByRole('button', { name: 'New score' }).click()

    // Filter the picker down and choose a different instrument.
    await page.getByPlaceholder('Filter instruments…').fill('cello')
    const cello = page.getByRole('button', { name: 'Pick Cello' })
    await cello.click()
    await expect(cello).toHaveAttribute('aria-pressed', 'true')

    await page.getByLabel('Title', { exact: true }).fill('Cello Suite')
    await page.getByRole('button', { name: 'Create score' }).click()

    await expect.poll(() => apiMock.creates.length).toBe(1)
    // The serialized starting score names the chosen instrument.
    expect(JSON.stringify(apiMock.creates[0].score)).toContain('Cello')
})

test('the search field filters the list (debounced) and shows a no-match empty state', async ({ page }) => {
    await page.goto('/scores')
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()

    // The mock returns the same single score for any query; a non-matching
    // search is answered with an empty list by filtering on the server side —
    // emulate that by intercepting the search request.
    await page.route(
        (url) => url.pathname.endsWith('/scores') && url.searchParams.has('search'),
        (route) =>
            route.request().method() === 'GET'
                ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
                : route.fallback(),
    )

    await page.getByPlaceholder('Find a score…').fill('does-not-exist')
    await expect(page.getByText('No scores match “does-not-exist”.')).toBeVisible()

    // Clearing the search restores the unfiltered list.
    await page.getByPlaceholder('Find a score…').fill('')
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()
})

test('the pencil button opens the score, and top-nav controls work', async ({ page }) => {
    await page.goto('/scores')

    // Edit (pencil) opens the editor just like the title does.
    await page.getByRole('button', { name: `Edit ${MOCK_TITLE}` }).click()
    await expect(page).toHaveURL(new RegExp(`/scores/${MOCK_SCORE_ID}$`))
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()

    // Back in the library, the top-nav "New score" opens the create dialog.
    await page.getByRole('button', { name: 'Back to library' }).click()
    await page.getByRole('button', { name: 'New score' }).first().click()
    await expect(page.getByRole('dialog', { name: 'New score' })).toBeVisible()
    await page.keyboard.press('Escape')

    // Settings nav link and the account button both lead to /settings.
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await page.getByRole('link', { name: 'Library' }).click()
    await expect(page).toHaveURL(/\/scores$/)
    await page.getByRole('button', { name: 'Account settings' }).click()
    await expect(page).toHaveURL(/\/settings$/)
})
