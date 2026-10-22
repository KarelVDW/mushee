import type { FileChooser, Page, Route } from '@playwright/test'

import { expect, MOCK_SCORE_ID, MOCK_TITLE, mockBilling, SCORE_META, test } from './fixtures'

/**
 * Mocked-API library (scores list) e2e: listing, opening a score, the create
 * flow (which serializes a fresh Score through the model in the browser), the
 * row's More menu (rename, duplicate, delete via the styled confirmation dialog),
 * the plan's score cap, and import.
 */

test.beforeEach(({ apiMock }) => {
    void apiMock
})

function corsJson(route: Route, body: unknown, status = 200) {
    const origin = route.request().headers()['origin'] ?? '*'
    return route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
        body: JSON.stringify(body),
    })
}

/** Serve an unfiltered library of `count` scores (the mock score first). Registered after the fixture mock, so it wins. */
async function seedLibrary(page: Page, count: number): Promise<void> {
    const scores = Array.from({ length: count }, (_, i) =>
        i === 0 ? SCORE_META : { ...SCORE_META, id: `e2e-seeded-${i}`, title: `Seeded score ${i}` },
    )
    await page.route(
        (url) => url.port === '4999' && url.pathname.endsWith('/scores') && !url.searchParams.has('search'),
        (route) => (route.request().method() === 'GET' ? corsJson(route, scores) : route.fallback()),
    )
}

/** Open a row's More menu and return it. */
async function openRowMenu(page: Page, title: string) {
    await page.getByRole('button', { name: `More actions for ${title}` }).click()
    return page.getByRole('dialog', { name: `More actions for ${title}` })
}

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

    await (await openRowMenu(page, MOCK_TITLE)).getByRole('button', { name: 'Delete…' }).click()
    await expect(page.getByRole('dialog', { name: 'Delete this score?' })).toBeVisible()
    await page.getByRole('button', { name: 'Delete score' }).click()

    await expect.poll(() => apiMock.deletes.length).toBeGreaterThan(0)
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toHaveCount(0)

    // The library is now empty; the first-score card is the page — the header's Import and
    // search are gone, the card's import link remains — and its CTA opens the create dialog.
    await expect(page.getByText('No scores yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import file' })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Search your scores' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Or import a MusicXML or MIDI file' })).toBeVisible()
    await page.getByRole('button', { name: 'New score' }).last().click()
    const dialog = page.getByRole('dialog', { name: 'New score' })
    await expect(dialog).toBeVisible()
    // The very first score gets a warmer default title.
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveAttribute('placeholder', 'My first melody')
})

test('the empty library’s import link opens the file picker', async ({ page }) => {
    await seedLibrary(page, 0)
    await page.goto('/scores')
    await expect(page.getByText('No scores yet.')).toBeVisible()

    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Or import a MusicXML or MIDI file' }).click()
    await (await chooser).setFiles('e2e/fixtures/import.musicxml')
    await expect(page.getByRole('dialog', { name: 'Import score' })).toBeVisible()
})

test('duplicates a score from its row and lists the copy', async ({ page, apiMock }) => {
    await page.goto('/scores')
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()

    await (await openRowMenu(page, MOCK_TITLE)).getByRole('button', { name: 'Duplicate' }).click()
    await expect.poll(() => apiMock.duplicates).toEqual([MOCK_SCORE_ID])

    // The copy appears as its own row; the original stays and the user stays in the library.
    await expect(page.getByRole('button', { name: `${MOCK_TITLE} (copy)`, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/scores$/)
    expect(apiMock.creates).toHaveLength(0)
})

test('a failed duplicate surfaces an error toast', async ({ page, apiMock }) => {
    void apiMock
    await page.goto('/scores')
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()

    // Registered after the fixture mock, so it wins: the server refuses the copy.
    await page.route(
        (url) => url.pathname.endsWith('/duplicate'),
        (route) =>
            route.request().method() === 'POST'
                ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
                : route.fallback(),
    )

    await (await openRowMenu(page, MOCK_TITLE)).getByRole('button', { name: 'Duplicate' }).click()
    await expect(page.getByText('Could not duplicate the score. Please try again.')).toBeVisible()
})

test('the delete dialog can be declined, dismissed with Escape, and closed — nothing is deleted', async ({ page, apiMock }) => {
    await page.goto('/scores')
    const deleteFromMenu = async () => (await openRowMenu(page, MOCK_TITLE)).getByRole('button', { name: 'Delete…' }).click()

    // "Keep it" declines.
    await deleteFromMenu()
    await page.getByRole('button', { name: 'Keep it' }).click()
    await expect(page.getByRole('dialog', { name: 'Delete this score?' })).toHaveCount(0)

    // Escape dismisses.
    await deleteFromMenu()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Delete this score?' })).toHaveCount(0)

    // The × closes.
    await deleteFromMenu()
    await page.getByRole('dialog', { name: 'Delete this score?' }).getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog', { name: 'Delete this score?' })).toHaveCount(0)

    // No DELETE ever reached the API and the row is still there.
    expect(apiMock.deletes).toHaveLength(0)
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()
})

test('the row menu closes on Escape and hands focus back to its button', async ({ page }) => {
    await page.goto('/scores')
    const trigger = page.getByRole('button', { name: `More actions for ${MOCK_TITLE}` })
    const menu = await openRowMenu(page, MOCK_TITLE)
    // The menu takes focus, and offers plain actions.
    await expect(menu.getByRole('button', { name: 'Rename…' })).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(page).toHaveURL(/\/scores$/)
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

    await (await openRowMenu(page, MOCK_TITLE)).getByRole('button', { name: 'Delete…' }).click()
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
            return corsJson(route, { code: 'score-limit', message: 'Your Sketch plan holds up to 5 scores. Upgrade to add more.' }, 403)
        },
    )

    await page.getByRole('button', { name: 'New score' }).click()
    await page.getByLabel('Title', { exact: true }).fill('One Too Many')
    await page.getByRole('button', { name: 'Create score' }).click()

    // The tier-aware upgrade dialog appears, calm and priced, with no failure toast doubling it up.
    const dialog = page.getByRole('dialog', { name: 'Your Sketch plan holds 5 scores.' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(
        "To start a new one, delete a score you don't need — or switch to Songwriter for as many scores as you like",
    )
    await expect(dialog.getByRole('button', { name: 'See Songwriter' })).toBeVisible()
    await expect(page.getByText('Could not create the score. Please try again.')).toHaveCount(0)

    // "Not now" dismisses; the library stays as it was.
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()

    // The upgrade lands on Settings' plan tab.
    await page.getByRole('button', { name: 'New score' }).click()
    await page.getByRole('button', { name: 'Create score' }).click()
    await dialog.getByRole('button', { name: 'See Songwriter' }).click()
    await expect(page).toHaveURL(/\/settings\?tab=plan/)
})

test('a library near the cap counts its free scores; a small one says nothing', async ({ page }) => {
    await page.goto('/scores')
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()
    await expect(page.getByText(/free scores/)).toHaveCount(0)

    await seedLibrary(page, 3)
    await page.reload()
    await expect(page.getByText('3 of 5 free scores')).toBeVisible()
})

test('at the cap, New score, Import and Duplicate open the limit dialog before any form', async ({ page, apiMock }) => {
    await seedLibrary(page, 5)
    await page.goto('/scores')
    await expect(page.getByText("You've used all 5 free scores.")).toBeVisible()
    await expect(page.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/settings?tab=plan&plan=pro')

    const limit = page.getByRole('dialog', { name: 'Your Sketch plan holds 5 scores.' })

    // New score: no form to fill in first.
    await page.getByRole('button', { name: 'New score' }).click()
    await expect(limit).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'New score' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Not now' }).click()

    // Import: the limit dialog instead of the file picker.
    let chooserOpened = false
    page.on('filechooser', () => (chooserOpened = true))
    await page.getByRole('button', { name: 'Import file' }).click()
    await expect(limit).toBeVisible()
    expect(chooserOpened).toBe(false)
    await page.getByRole('button', { name: 'Not now' }).click()

    // Duplicate: no request at all.
    await (await openRowMenu(page, MOCK_TITLE)).getByRole('button', { name: 'Duplicate' }).click()
    await expect(limit).toBeVisible()
    expect(apiMock.duplicates).toHaveLength(0)
    expect(apiMock.creates).toHaveLength(0)
})

test('Upgrade from a full library opens Change plan on the next tier, from the dialog and from See plans', async ({ page }) => {
    // Plans can be bought here, so the plan tab opens the asked-for tier straight away.
    await mockBilling(page, { billingConfigured: true })
    await seedLibrary(page, 5)
    await page.goto('/scores')
    await page.getByRole('button', { name: 'New score' }).click()
    await page.getByRole('dialog', { name: 'Your Sketch plan holds 5 scores.' }).getByRole('button', { name: 'See Songwriter' }).click()
    const changePlan = page.getByRole('dialog', { name: 'Change plan' })
    await expect(changePlan).toBeVisible()
    await expect(changePlan.getByRole('button', { pressed: true })).toContainText('For daily writers')
    await expect(page.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true')

    await page.goto('/scores')
    await page.getByRole('link', { name: 'See plans' }).click()
    await expect(changePlan).toBeVisible()
    await expect(changePlan.getByRole('button', { pressed: true })).toContainText('For daily writers')
})

test('the create dialog takes an optional title, submits on Enter, and can be cancelled', async ({ page, apiMock }) => {
    await page.goto('/scores')
    await page.getByRole('button', { name: 'New score' }).click()
    const dialog = page.getByRole('dialog', { name: 'New score' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('You can change both later.')

    // The title is optional: Create is enabled from the start, and the field says so.
    const create = page.getByRole('button', { name: 'Create score' })
    await expect(create).toBeEnabled()
    await expect(page.getByLabel('Title', { exact: true })).toHaveAttribute('placeholder', 'Untitled score')
    await expect(dialog.getByText('Optional', { exact: true })).toBeVisible()

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

test('a blank title creates an “Untitled score”', async ({ page, apiMock }) => {
    await page.goto('/scores')
    await page.getByRole('button', { name: 'New score' }).click()
    await page.getByLabel('Title', { exact: true }).fill('   ')
    await page.getByRole('button', { name: 'Create score' }).click()

    await expect.poll(() => apiMock.creates.length).toBe(1)
    expect(apiMock.creates[0].title).toBe('Untitled score')
})

test('the picker leads with popular tiles, the voice picked, and keeps the rest behind All instruments', async ({ page }) => {
    await page.goto('/scores')
    await page.getByRole('button', { name: 'New score' }).click()
    const dialog = page.getByRole('dialog', { name: 'New score' })

    await expect(dialog.getByText('What will you sing or play?')).toBeVisible()
    await expect(dialog.getByText('Sets the playback sound and helps Solkey listen.', { exact: true })).toBeVisible()
    // The picked tile is the readout: no 'Instrument · Voice' eyebrow repeats it.
    await expect(dialog.getByText(/^Instrument · /)).toHaveCount(0)
    // No onboarding answer: a new score starts on the voice.
    await expect(dialog.getByRole('button', { name: 'Pick Voice', exact: true })).toHaveAttribute('aria-pressed', 'true')
    for (const name of ['Piano', 'Guitar', 'Violin', 'Flute', 'Recorder', 'Alto Saxophone', 'Trumpet']) {
        await expect(dialog.getByRole('button', { name: `Pick ${name}`, exact: true })).toBeVisible()
    }

    // Everything else waits behind 'All instruments', without repeating a popular one.
    await expect(dialog.getByRole('button', { name: 'Pick Cello', exact: true })).toHaveCount(0)
    const all = dialog.getByRole('button', { name: 'All instruments' })
    await expect(all).toHaveAttribute('aria-expanded', 'false')
    await all.click()
    await expect(all).toHaveAttribute('aria-expanded', 'true')
    await expect(dialog.getByRole('button', { name: 'Pick Cello', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Pick Violin', exact: true })).toHaveCount(1)
    // Duplicates and section patches stay out of the picker.
    await expect(dialog.getByRole('button', { name: 'Pick Violoncello', exact: true })).toHaveCount(0)
})

test('a chordal pick says, once, that Solkey writes melodies one note at a time', async ({ page }) => {
    await page.goto('/scores')
    await page.getByRole('button', { name: 'New score' }).click()
    const dialog = page.getByRole('dialog', { name: 'New score' })
    const line = dialog.getByText('On piano, play the tune one note at a time — Solkey writes melodies.')

    await expect(line).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Pick Piano', exact: true }).click()
    await expect(line).toBeVisible()
    await dialog.getByRole('button', { name: 'Pick Violin', exact: true }).click()
    await expect(line).toHaveCount(0)
})

test('a new score starts on the first instrument picked in onboarding', async ({ page }) => {
    await page.route(
        (url) => url.port === '4999' && url.pathname === '/onboarding',
        (route) => (route.request().method() === 'GET' ? corsJson(route, { instruments: ['Other', 'Guitar', 'Flute'] }) : route.fallback()),
    )
    await page.goto('/scores')
    await page.getByRole('button', { name: 'New score' }).click()
    const dialog = page.getByRole('dialog', { name: 'New score' })

    await expect(dialog.getByRole('button', { name: 'Pick Guitar', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByText('On guitar, play the tune one note at a time — Solkey writes melodies.')).toBeVisible()
})

test('picking an instrument in the create dialog is carried into the new score', async ({ page, apiMock }) => {
    await page.goto('/scores')
    await page.getByRole('button', { name: 'New score' }).click()

    // Search the picker, which opens the full list, and choose a different instrument.
    await page.getByRole('textbox', { name: 'Search instruments' }).fill('cello')
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
        (route) => (route.request().method() === 'GET' ? corsJson(route, []) : route.fallback()),
    )

    const search = page.getByRole('textbox', { name: 'Search your scores' })
    await search.fill('does-not-exist')
    await expect(page.getByText('No scores match “does-not-exist”.')).toBeVisible()

    // Clearing the search restores the unfiltered list.
    await search.fill('')
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()

    // A miss hands over the way out: the card's 'Clear search' empties the field and focuses it.
    await search.fill('does-not-exist')
    await expect(page.getByText('No scores match “does-not-exist”.')).toBeVisible()
    await page.getByRole('button', { name: 'Clear search' }).last().click()
    await expect(search).toHaveValue('')
    await expect(search).toBeFocused()
    await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()
})

test('a click anywhere on a row opens the score, and top-nav controls work', async ({ page }) => {
    await page.goto('/scores')

    // Not only the title: the row's empty middle (the dates) opens the editor too.
    const title = page.getByRole('button', { name: MOCK_TITLE, exact: true })
    const row = page.getByRole('row').filter({ has: title })
    const box = await row.boundingBox()
    if (!box) throw new Error('The score row has no layout box')
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2)
    await expect(page).toHaveURL(new RegExp(`/scores/${MOCK_SCORE_ID}$`))
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()

    // Back in the library, the top-nav "New score" opens the create dialog.
    await page.getByRole('button', { name: 'Back to library' }).click()
    await page.getByRole('button', { name: 'New score' }).first().click()
    await expect(page.getByRole('dialog', { name: 'New score' })).toBeVisible()
    await page.keyboard.press('Escape')

    // The Settings nav link and the avatar's account menu both lead to /settings.
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await page.getByRole('link', { name: 'Library' }).click()
    await expect(page).toHaveURL(/\/scores$/)
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('dialog', { name: 'Account menu' }).getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/settings$/)
})

test('a score is renamed from its row menu', async ({ page, apiMock }) => {
    await page.goto('/scores')
    await (await openRowMenu(page, MOCK_TITLE)).getByRole('button', { name: 'Rename…' }).click()

    const dialog = page.getByRole('dialog', { name: 'Rename score' })
    const title = dialog.getByLabel('Title', { exact: true })
    await expect(title).toHaveValue(MOCK_TITLE)
    await title.fill('Evening Air')
    await page.keyboard.press('Enter')

    await expect.poll(() => apiMock.patches.map((patch) => patch.title)).toContain('Evening Air')
    await expect(dialog).toHaveCount(0)
})

// "New score" on other pages (settings' top nav) lands here as /scores?new=1. Driven by URL
// so this spec covers the library's half alone; the settings click lives with that page.
test('/scores?new=1 opens the library with the create dialog open', async ({ page }) => {
    await page.goto('/scores?new=1')

    await expect(page.getByRole('dialog', { name: 'New score' })).toBeVisible()
    // The ?new=1 flag is dropped once read, so a reload doesn't reopen the dialog.
    await expect(page).toHaveURL(/\/scores$/)
})

/**
 * Import through the visible button and the browser's file chooser, as a user would.
 * Setting files straight on the hidden input never fired `change` on Linux WebKit in CI.
 */
async function pickImportFile(page: Page, file: Parameters<FileChooser['setFiles']>[0]): Promise<void> {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Import file' }).click()
    await (await chooser).setFiles(file)
}

test('imports a MusicXML file: confirms title and instrument, reports simplifications, then creates the score', async ({
    page,
    apiMock,
}) => {
    await page.goto('/scores')
    await pickImportFile(page, 'e2e/fixtures/import.musicxml')

    const dialog = page.getByRole('dialog', { name: 'Import score' })
    await expect(dialog).toBeVisible()
    // The title comes from the file, the instrument from its part, and the reductions are listed.
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Imported Air')
    await expect(dialog.getByText('We read 2 bars in 3/4 — 3 beats in a bar — from your file.')).toBeVisible()
    await expect(dialog.getByText('Instrument: Violin')).toBeVisible()
    const simplified = dialog.getByRole('status', { name: 'A few things were simplified' })
    await expect(simplified).toContainText('Only the first part (“Violin”) was imported; 1 other part was left out.')
    await expect(simplified).toContainText('Some note values were rewritten with the nearest supported ones.')

    // The picker waits behind 'Change', on the file's instrument, and an import carries no chord line.
    await dialog.getByRole('button', { name: 'Change' }).click()
    await expect(dialog.getByRole('textbox', { name: 'Search instruments' })).toBeFocused()
    await expect(dialog.getByRole('button', { name: 'Pick Violin', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await dialog.getByRole('button', { name: 'Pick Piano', exact: true }).click()
    await expect(dialog.getByText(/play the tune one note at a time/)).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Pick Violin', exact: true }).click()

    await page.getByLabel('Title', { exact: true }).fill('Imported Air (edit)')
    await page.getByRole('button', { name: 'Create score' }).click()

    await expect.poll(() => apiMock.creates.length).toBeGreaterThan(0)
    const body = apiMock.creates[0] as {
        title: string
        score: { parts: Array<{ measures: unknown[] }>; partList: { scoreParts: Array<{ partName: string }> } }
    }
    expect(body.title).toBe('Imported Air (edit)')
    expect(body.score.parts[0].measures).toHaveLength(2)
    expect(body.score.partList.scoreParts[0].partName).toBe('Violin')

    await expect(page).toHaveURL(/\/scores\/e2e-created-1$/)
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
})

test('a file that is not a score is refused with a toast and no dialog', async ({ page, apiMock }) => {
    await page.goto('/scores')
    await pickImportFile(page, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('just some text') })

    await expect(page.getByText('This is not a score file.', { exact: false })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Import score' })).toHaveCount(0)
    expect(apiMock.creates).toHaveLength(0)
})

test.describe('on a phone-sized screen', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('a small library shows no search, a quiet import link and no visible column header', async ({ page }) => {
        await page.goto('/scores')
        await expect(page.getByRole('button', { name: MOCK_TITLE, exact: true })).toBeVisible()

        await expect(page.getByRole('button', { name: 'Import a file' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Import file' })).toHaveCount(0)
        await expect(page.getByRole('textbox', { name: 'Search your scores' })).toHaveCount(0)
        // The column headers stay for screen readers only (a clipped 1px box) once the rows are cards.
        const headerRow = page.getByRole('row').filter({ has: page.getByRole('columnheader', { name: 'Title' }) })
        await expect(headerRow).toHaveCount(1)
        expect((await headerRow.boundingBox())?.width).toBeLessThanOrEqual(1)
    })

    test('the search field appears once the library holds more than five scores', async ({ page }) => {
        await seedLibrary(page, 6)
        await page.goto('/scores')
        await expect(page.getByRole('textbox', { name: 'Search your scores' })).toBeVisible()
    })
})
