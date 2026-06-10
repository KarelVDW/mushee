import { readFileSync } from 'node:fs'

import { expect, MOCK_SCORE_ID, MOCK_TITLE, test } from './fixtures'

/**
 * Mocked-API editor e2e. Drives the real editor in a real browser; the scores
 * API and auth session are intercepted (see fixtures.ts). Exercises rendering,
 * keyboard pitch editing + debounced autosave, the control bar, and exporting.
 */

test.beforeEach(async ({ page, apiMock }) => {
    void apiMock // installs the route mocks + auth cookie
    await page.goto(`/scores/${MOCK_SCORE_ID}`)
    // Editor chrome is present only after the score finishes loading.
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
})

test('renders the editor chrome and the engraved score', async ({ page }) => {
    await expect(page.locator('header input')).toHaveValue(MOCK_TITLE)
    await expect(page.getByText('Loading score…')).toHaveCount(0)

    // Transport + note-input controls are wired up.
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Record' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Note duration' })).toBeVisible()

    // The score SVG rendered staff lines and noteheads (fixture has 4 pitched notes).
    const scoreSvg = page.locator('.max-w-240 svg').first()
    await expect(scoreSvg).toBeVisible()
    expect(await scoreSvg.locator('line').count()).toBeGreaterThanOrEqual(5)
    expect(await scoreSvg.locator('path').count()).toBeGreaterThan(3)
})

test('editing a note pitch with the keyboard triggers a debounced autosave', async ({ page }) => {
    const patch = page.waitForRequest(
        (r) => r.method() === 'PATCH' && new RegExp(`/scores/${MOCK_SCORE_ID}$`).test(r.url()),
        { timeout: 8000 },
    )

    // The first note (C5) is auto-selected on load; the editor container is focused.
    await page.locator('div[tabindex="0"]').first().focus()
    await page.keyboard.press('ArrowUp')

    const body = (await patch).postDataJSON() as Record<string, unknown>
    // A pitch edit dirties the measure; autosave sends the changed measures.
    expect(body.measures ?? body.allMeasures).toBeTruthy()
})

test('changing duration and toggling rest autosave the change', async ({ page }) => {
    // Switch the selected note to a 16th (last of w,h,q,8,16).
    const durations = page.getByRole('group', { name: 'Note duration' }).getByRole('button')
    const patchDuration = page.waitForRequest((r) => r.method() === 'PATCH', { timeout: 8000 })
    await durations.nth(4).click()
    await patchDuration

    // Toggle the active note to a rest.
    const restToggle = page.getByRole('button', { name: 'Rest' })
    const patchRest = page.waitForRequest((r) => r.method() === 'PATCH', { timeout: 8000 })
    await restToggle.click()
    await patchRest
    await expect(restToggle).toHaveAttribute('aria-pressed', 'true')
})

test('clef and tempo popovers open from the control bar', async ({ page }) => {
    const clef = page.getByRole('button', { name: /^Clef:/ })
    await expect(clef).toHaveAttribute('aria-pressed', 'false')
    await clef.click()
    await expect(clef).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')

    const tempo = page.getByRole('button', { name: /bpm$/ })
    await tempo.click()
    await expect(tempo).toHaveAttribute('aria-pressed', 'true')
})

test('exports MusicXML and MIDI as downloads', async ({ page }) => {
    // MusicXML
    await page.getByRole('button', { name: 'Export score' }).click()
    const xmlDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'MusicXML' }).click()
    const xml = await xmlDownload
    expect(xml.suggestedFilename()).toMatch(/\.musicxml$/)
    const xmlText = readFileSync((await xml.path()), 'utf8')
    expect(xmlText).toMatch(/<score-partwise|<note/)

    // MIDI
    await page.getByRole('button', { name: 'Export score' }).click()
    const midiDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'MIDI' }).click()
    const midi = await midiDownload
    expect(midi.suggestedFilename()).toMatch(/\.mid$/)
    const midiBytes = readFileSync((await midi.path()))
    expect(midiBytes.subarray(0, 4).toString('ascii')).toBe('MThd') // MIDI header chunk
})

test('exports a PDF', async ({ page }) => {
    test.slow() // rasterizing the SVG to canvas is heavier than the other formats
    await page.getByRole('button', { name: 'Export score' }).click()
    const pdfDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'PDF' }).click()
    const pdf = await pdfDownload
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/)
    const bytes = readFileSync((await pdf.path()))
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
})

test('navigates back to the library', async ({ page }) => {
    await page.getByRole('button', { name: 'Back to library' }).click()
    await expect(page).toHaveURL(/\/scores$/)
    await expect(page.getByRole('heading', { name: 'Your scores' })).toBeVisible()
})
