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

test('no mic-source chip: the server classifies voice vs instrument itself', async ({ page }) => {
    // The mic-source choice moved server-side (SourceClassifier on the audio
    // prefix), so the header must NOT ask the user what they are recording.
    await expect(page.getByRole('button', { name: /^Mic input:/ })).toHaveCount(0)
})

test('editing a note pitch with the keyboard triggers a debounced autosave', async ({ page }) => {
    const patch = page.waitForRequest((r) => r.method() === 'PATCH' && new RegExp(`/scores/${MOCK_SCORE_ID}$`).test(r.url()), {
        timeout: 8000,
    })

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

// Selection-highlight bands are the only translucent-blue rects on the score.
const SELECTION_BANDS = 'svg rect[fill="rgba(30, 144, 255, 0.14)"]'

test('shift+arrows range-select notes and a bulk edit applies to all of them', async ({ page }) => {
    const bands = page.locator(SELECTION_BANDS)
    // The first note is selected on load, so exactly one note is highlighted.
    await expect(bands).toHaveCount(1)

    // Extend the selection across the first three pitched notes (C5 D5 E5).
    await page.locator('div[tabindex="0"]').first().focus()
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await expect(bands).toHaveCount(3)

    // A bulk action (raise pitch) edits every selected note and autosaves; the range stays selected.
    const patch = page.waitForRequest((r) => r.method() === 'PATCH', { timeout: 8000 })
    await page.keyboard.press('ArrowUp')
    await patch
    await expect(bands).toHaveCount(3)

    // Escape collapses the range back to a single note.
    await page.keyboard.press('Escape')
    await expect(bands).toHaveCount(1)
})

test('dragging across notes selects a contiguous range', async ({ page }) => {
    const bands = page.locator(SELECTION_BANDS)
    await expect(bands).toHaveCount(1)

    // Anchor the drag on the already-selected note's band, then drag rightward over its neighbours.
    const start = await bands.first().boundingBox()
    if (!start) throw new Error('expected a selection band to drag from')
    const y = start.y + start.height / 2
    await page.mouse.move(start.x + start.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(start.x + start.width / 2 + 160, y, { steps: 12 })
    await page.mouse.up()

    expect(await bands.count()).toBeGreaterThanOrEqual(2)
})

test('copies a range and pastes it with the keyboard', async ({ page }) => {
    const bands = page.locator(SELECTION_BANDS)
    await expect(bands).toHaveCount(1)

    // Select the first two notes and copy them.
    await page.locator('div[tabindex="0"]').first().focus()
    await page.keyboard.press('Shift+ArrowRight')
    await expect(bands).toHaveCount(2)
    await page.keyboard.press('ControlOrMeta+c')

    // Move to a later note and paste; the pasted run (2 notes) becomes the selection and autosaves.
    await page.keyboard.press('Escape')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    const patch = page.waitForRequest((r) => r.method() === 'PATCH', { timeout: 8000 })
    await page.keyboard.press('ControlOrMeta+v')
    await patch
    await expect(bands).toHaveCount(2)
})

test('select-all spans every note and a bulk edit hits them all', async ({ page }) => {
    const bands = page.locator(SELECTION_BANDS)
    await expect(bands).toHaveCount(1)

    // ⌘A selects the whole score — the fixture holds 8 notes (4 pitched + 4 rests).
    await page.locator('div[tabindex="0"]').first().focus()
    await page.keyboard.press('ControlOrMeta+a')
    await expect(bands).toHaveCount(8)

    // A bulk action applies across the full selection and autosaves; the range stays selected.
    const patch = page.waitForRequest((r) => r.method() === 'PATCH', { timeout: 8000 })
    await page.keyboard.press('ArrowUp')
    await patch
    await expect(bands).toHaveCount(8)
})

test('select-all matches the typed character on non-QWERTY layouts (AZERTY ⌘A = physical KeyQ)', async ({ page }) => {
    const bands = page.locator(SELECTION_BANDS)
    await expect(bands).toHaveCount(1)

    // Playwright's keyboard is US-layout only, so synthesize the AZERTY keystroke: the key
    // labeled A reports physical code KeyQ while typing the character 'a'.
    const container = page.locator('div[tabindex="0"]').first()
    await container.focus()
    const isMac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))
    await container.dispatchEvent('keydown', { code: 'KeyQ', key: 'a', metaKey: isMac, ctrlKey: !isMac, bubbles: true })
    await expect(bands).toHaveCount(8)
})

test('cuts a range with the keyboard and pastes it back elsewhere', async ({ page }) => {
    const bands = page.locator(SELECTION_BANDS)
    await expect(bands).toHaveCount(1)

    // Select the first two notes (C5 D5) and cut them: copied, then removed from the score.
    await page.locator('div[tabindex="0"]').first().focus()
    await page.keyboard.press('Shift+ArrowRight')
    await expect(bands).toHaveCount(2)
    const restToggle = page.getByRole('button', { name: 'Rest' })
    const patchCut = page.waitForRequest((r) => r.method() === 'PATCH', { timeout: 8000 })
    await page.keyboard.press('ControlOrMeta+x')
    await patchCut
    await expect(restToggle).toHaveAttribute('aria-pressed', 'true')

    // Step onto the next pitched note and paste the cut run over it.
    await page.keyboard.press('ArrowRight')
    const patchPaste = page.waitForRequest((r) => r.method() === 'PATCH', { timeout: 8000 })
    await page.keyboard.press('ControlOrMeta+v')
    await patchPaste
    await expect(bands).toHaveCount(2)
    await expect(restToggle).toHaveAttribute('aria-pressed', 'false')
})

test('clipboard shortcuts are fixed: listed, not rebindable, and reserved from other commands', async ({ page }) => {
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()

    // Fixed commands are listed as plain facts — no change / remove / reset affordances.
    for (const label of ['Copy selection', 'Cut selection', 'Paste', 'Select all']) {
        await expect(page.getByText(label, { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: `Change shortcut for ${label}` })).toHaveCount(0)
        await expect(page.getByRole('button', { name: `Remove shortcut for ${label}` })).toHaveCount(0)
    }

    // Recording a reserved keystroke for another command is refused with an explanation.
    await page.getByRole('button', { name: 'Change shortcut for Toggle rest' }).click()
    await expect(page.getByText('Press a key…')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+c')
    await expect(page.getByText(/reserved for “Copy selection”/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Change shortcut for Toggle rest' })).toContainText('R')
})

test('keyboard shortcuts dialog lists bindings and rebinding persists across a reload', async ({ page }) => {
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()

    // Defaults are listed with layout-aware key labels.
    const nextNote = page.getByRole('button', { name: 'Change shortcut for Select next note' })
    await expect(nextNote).toContainText('→')

    // Record J as the new shortcut for "Toggle rest" (default: R).
    await page.getByRole('button', { name: 'Change shortcut for Toggle rest' }).click()
    await expect(page.getByText('Press a key…')).toBeVisible()
    await page.keyboard.press('j')
    const restBinding = page.getByRole('button', { name: 'Change shortcut for Toggle rest' })
    await expect(restBinding).toContainText('J')
    await page.getByRole('button', { name: 'Done' }).click()

    // The editor regains focus; the new key toggles the selected note to a rest and autosaves.
    const restToggle = page.getByRole('button', { name: 'Rest' })
    const patch = page.waitForRequest((r) => r.method() === 'PATCH', { timeout: 8000 })
    await page.keyboard.press('j')
    await patch
    await expect(restToggle).toHaveAttribute('aria-pressed', 'true')

    // The customization is stored in localStorage, so it survives a reload; the old key is dead.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
    await page.locator('div[tabindex="0"]').first().focus()
    await page.keyboard.press('r')
    await expect(restToggle).toHaveAttribute('aria-pressed', 'false')
    const patchAfterReload = page.waitForRequest((r) => r.method() === 'PATCH', { timeout: 8000 })
    await page.keyboard.press('j')
    await patchAfterReload
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
    const xmlText = readFileSync(await xml.path(), 'utf8')
    expect(xmlText).toMatch(/<score-partwise|<note/)

    // MIDI
    await page.getByRole('button', { name: 'Export score' }).click()
    const midiDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'MIDI' }).click()
    const midi = await midiDownload
    expect(midi.suggestedFilename()).toMatch(/\.mid$/)
    const midiBytes = readFileSync(await midi.path())
    expect(midiBytes.subarray(0, 4).toString('ascii')).toBe('MThd') // MIDI header chunk
})

test('exports a PDF', async ({ page }) => {
    test.slow() // rasterizing the SVG to canvas is heavier than the other formats
    await page.getByRole('button', { name: 'Export score' }).click()
    const pdfDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'PDF' }).click()
    const pdf = await pdfDownload
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/)
    const bytes = readFileSync(await pdf.path())
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
})

test('navigates back to the library', async ({ page }) => {
    await page.getByRole('button', { name: 'Back to library' }).click()
    await expect(page).toHaveURL(/\/scores$/)
    await expect(page.getByRole('heading', { name: 'Your scores' })).toBeVisible()
})
