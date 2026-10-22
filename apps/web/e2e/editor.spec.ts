import { readFileSync } from 'node:fs'

import {
    denyMicrophone,
    expect,
    focusEditor,
    MOCK_SCORE_ID,
    MOCK_SHARE_TOKEN,
    MOCK_TITLE,
    SELECTION_BANDS,
    test,
    waitForAutosave,
} from './fixtures'

/**
 * Mocked-API editor e2e. Drives the real editor in a real browser; the scores
 * API and auth session are intercepted (see fixtures.ts). Exercises rendering,
 * the record button's selection guard, keyboard pitch editing + debounced
 * autosave, range selection and the clipboard, shortcut rebinding, the tool
 * dock's popovers, the header's takes / share menus, and exporting.
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

// The desktop half of mobile.spec's record guard: the header's Record button.
test('Record is disabled with no note selected and enabled again after clicking one', async ({ page }) => {
    // Refuse the microphone: the take clears the selection as it starts, then fails to open
    // the mic — leaving the editor with no note selected (the only way to get there by hand).
    await denyMicrophone(page)
    // Where the auto-selected first note sits. The failed take's bar displaces it, but the
    // spot stays on the first bar of the staff, so clicking it selects a note again.
    const band = await page.locator(SELECTION_BANDS).first().boundingBox()
    if (!band) throw new Error('expected the auto-selected note')

    const record = page.getByRole('button', { name: 'Record' })
    await expect(record).toBeEnabled()
    await record.click()
    await expect(page.getByRole('alert').filter({ hasText: 'Microphone access was blocked' })).toBeVisible()
    await expect(record).toBeDisabled()

    await page.mouse.click(band.x + band.width / 2, band.y + band.height / 2)
    await expect(record).toBeEnabled()
})

test('editing a note pitch with the keyboard triggers a debounced autosave', async ({ page }) => {
    const patch = waitForAutosave(page)

    // The first note (C5) is auto-selected on load; the editor container is focused.
    await focusEditor(page)
    await page.keyboard.press('ArrowUp')

    const body = (await patch).postDataJSON() as Record<string, unknown>
    // A pitch edit dirties the measure; autosave sends the changed measures.
    expect(body.measures ?? body.allMeasures).toBeTruthy()
})

test('changing duration and toggling rest autosave the change', async ({ page }) => {
    // The length picker holds exactly the five note values, each named.
    const durations = page.getByRole('group', { name: 'Note duration' }).getByRole('button')
    await expect(durations).toHaveCount(5)
    const sixteenth = page.getByRole('button', { name: 'Sixteenth note' })
    const patchDuration = waitForAutosave(page)
    await sixteenth.click()
    await patchDuration
    await expect(sixteenth).toHaveAttribute('aria-pressed', 'true')

    // Toggle the active note to a rest.
    const restToggle = page.getByRole('button', { name: 'Rest', exact: true })
    const patchRest = waitForAutosave(page)
    await restToggle.click()
    await patchRest
    await expect(restToggle).toHaveAttribute('aria-pressed', 'true')
})

test('shift+arrows range-select notes and a bulk edit applies to all of them', async ({ page }) => {
    const bands = page.locator(SELECTION_BANDS)
    // The first note is selected on load, so exactly one note is highlighted.
    await expect(bands).toHaveCount(1)

    // Extend the selection across the first three pitched notes (C5 D5 E5).
    await focusEditor(page)
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await expect(bands).toHaveCount(3)

    // A bulk action (raise pitch) edits every selected note and autosaves; the range stays selected.
    const patch = waitForAutosave(page)
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
    await focusEditor(page)
    await page.keyboard.press('Shift+ArrowRight')
    await expect(bands).toHaveCount(2)
    await page.keyboard.press('ControlOrMeta+c')

    // Move to a later note and paste; the pasted run (2 notes) becomes the selection and autosaves.
    await page.keyboard.press('Escape')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    const patch = waitForAutosave(page)
    await page.keyboard.press('ControlOrMeta+v')
    await patch
    await expect(bands).toHaveCount(2)
})

test('select-all spans every note and a bulk edit hits them all', async ({ page }) => {
    const bands = page.locator(SELECTION_BANDS)
    await expect(bands).toHaveCount(1)

    // ⌘A selects the whole score — the fixture holds 8 notes (4 pitched + 4 rests).
    await focusEditor(page)
    await page.keyboard.press('ControlOrMeta+a')
    await expect(bands).toHaveCount(8)

    // A bulk action applies across the full selection and autosaves; the range stays selected.
    const patch = waitForAutosave(page)
    await page.keyboard.press('ArrowUp')
    await patch
    await expect(bands).toHaveCount(8)
})

test('select-all matches the typed character on non-QWERTY layouts (AZERTY ⌘A = physical KeyQ)', async ({ page }) => {
    const bands = page.locator(SELECTION_BANDS)
    await expect(bands).toHaveCount(1)

    // Playwright's keyboard is US-layout only, so synthesize the AZERTY keystroke: the key
    // labeled A reports physical code KeyQ while typing the character 'a'.
    const container = await focusEditor(page)
    const isMac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))
    await container.dispatchEvent('keydown', { code: 'KeyQ', key: 'a', metaKey: isMac, ctrlKey: !isMac, bubbles: true })
    await expect(bands).toHaveCount(8)
})

test('cuts a range with the keyboard and pastes it back elsewhere', async ({ page }) => {
    const bands = page.locator(SELECTION_BANDS)
    await expect(bands).toHaveCount(1)

    // Select the first two notes (C5 D5) and cut them: copied, then removed from the score.
    await focusEditor(page)
    await page.keyboard.press('Shift+ArrowRight')
    await expect(bands).toHaveCount(2)
    const restToggle = page.getByRole('button', { name: 'Rest' })
    const patchCut = waitForAutosave(page)
    await page.keyboard.press('ControlOrMeta+x')
    await patchCut
    await expect(restToggle).toHaveAttribute('aria-pressed', 'true')

    // Step onto the next pitched note and paste the cut run over it.
    await page.keyboard.press('ArrowRight')
    const patchPaste = waitForAutosave(page)
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
    await page.getByRole('button', { name: 'Change shortcut for Rest on/off' }).click()
    await expect(page.getByText('Press the new keys…')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+c')
    await expect(page.getByText(/reserved for “Copy selection”/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Change shortcut for Rest on/off' })).toContainText('R')
})

test('keyboard shortcuts dialog lists bindings and rebinding persists across a reload', async ({ page }) => {
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()

    // Defaults are listed with layout-aware key labels.
    const nextNote = page.getByRole('button', { name: 'Change shortcut for Select next note' })
    await expect(nextNote).toContainText('→')

    // Record J as the new shortcut for "Toggle rest" (default: R).
    await page.getByRole('button', { name: 'Change shortcut for Rest on/off' }).click()
    await expect(page.getByText('Press the new keys…')).toBeVisible()
    await page.keyboard.press('j')
    const restBinding = page.getByRole('button', { name: 'Change shortcut for Rest on/off' })
    await expect(restBinding).toContainText('J')
    await page.getByRole('button', { name: 'Done' }).click()

    // The editor regains focus; the new key toggles the selected note to a rest and autosaves.
    const restToggle = page.getByRole('button', { name: 'Rest' })
    const patch = waitForAutosave(page)
    await page.keyboard.press('j')
    await patch
    await expect(restToggle).toHaveAttribute('aria-pressed', 'true')

    // The customization is stored in localStorage, so it survives a reload; the old key is dead.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
    await focusEditor(page)
    await page.keyboard.press('r')
    await expect(restToggle).toHaveAttribute('aria-pressed', 'false')
    const patchAfterReload = waitForAutosave(page)
    await page.keyboard.press('j')
    await patchAfterReload
    await expect(restToggle).toHaveAttribute('aria-pressed', 'true')
})

test('clef and tempo popovers open from the tool dock', async ({ page }) => {
    // The score chips are menu triggers: they report their popover as expanded, not pressed.
    const clef = page.getByRole('button', { name: /^Clef:/ })
    await expect(clef).toHaveAttribute('aria-haspopup', 'dialog')
    await expect(clef).toHaveAttribute('aria-expanded', 'false')
    await clef.click()
    await expect(clef).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')

    const tempo = page.getByRole('button', { name: /bpm$/ })
    await expect(tempo).toHaveText('120 bpm')
    await tempo.click()
    await expect(tempo).toHaveAttribute('aria-expanded', 'true')
})

test('the score chips say their values in words', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Clef: Treble' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Key: C major' })).toHaveText('C major')
    await expect(page.getByRole('button', { name: 'Time signature: 4/4' })).toHaveText('4/4')
    await expect(page.getByRole('button', { name: 'Tempo: 120 bpm' })).toHaveText('120 bpm')
})

test('the dock teaches moving a note until the first pitch edit', async ({ page }) => {
    const hint = page.getByText('To move a note, click higher or lower on the staff, or press ↑ ↓.')
    await expect(hint).toBeVisible()

    // Higher / Lower are the mouse twins of ↑ ↓; the first pitch edit retires the hint for good.
    const patch = waitForAutosave(page)
    await page.getByRole('button', { name: 'Higher', exact: true }).click()
    await patch
    await expect(hint).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
    await expect(hint).toHaveCount(0)
})

test('hovering a dock control names it, with its hint and live shortcut', async ({ page }) => {
    await page.getByRole('button', { name: 'Quarter note' }).hover()
    // The tooltip card is decorative (the hidden role=tooltip text describes the control).
    await expect(page.getByText('1 beat', { exact: true })).toBeVisible()
    await expect(page.locator('kbd').filter({ hasText: /^Q$/ })).toBeVisible()
})

test('right-clicking a note opens the selection actions; Delete clears it', async ({ page }) => {
    const band = await page.locator(SELECTION_BANDS).first().boundingBox()
    if (!band) throw new Error('expected the auto-selected note')
    await page.mouse.click(band.x + band.width / 2, band.y + band.height / 2, { button: 'right' })
    const toolbar = page.getByRole('toolbar', { name: 'Selection actions' })
    await expect(toolbar).toBeVisible()

    const patch = waitForAutosave(page)
    await toolbar.getByRole('button', { name: 'Delete' }).click()
    await patch
    await expect(toolbar).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Rest', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('Shift+F10 opens the selection actions from the keyboard, and Escape hands focus back', async ({ page }) => {
    const editor = await focusEditor(page)
    await page.keyboard.press('Shift+F10')
    const toolbar = page.getByRole('toolbar', { name: 'Selection actions' })
    await expect(toolbar).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Copy' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(toolbar).toHaveCount(0)
    await expect(editor).toBeFocused()
})

test('a quick second click on the selected note still moves it', async ({ page }) => {
    const band = await page.locator(SELECTION_BANDS).first().boundingBox()
    if (!band) throw new Error('expected the auto-selected note')
    // Hover the selected note's column a few lines up: the ghost previews, the click commits it.
    await page.mouse.move(band.x + band.width / 2, band.y + 4)
    const patch = waitForAutosave(page)
    await page.mouse.click(band.x + band.width / 2, band.y + 4)
    await patch
    await expect(page.getByRole('toolbar', { name: 'Selection actions' })).toHaveCount(0)
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

test('takes menu lists the score’s recordings and deletes one after confirmation', async ({ page, apiMock }) => {
    await page.getByRole('button', { name: 'Takes' }).click()
    const panel = page.getByRole('dialog', { name: 'Takes' })
    await expect(panel).toBeVisible()
    const rows = panel.getByRole('list', { name: 'Takes' }).getByRole('listitem')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('0:42')
    await expect(rows.nth(1)).toContainText('2:05')
    // A take from before audio archiving cannot be played.
    await expect(rows.nth(2).getByRole('button', { name: 'Play take' })).toBeDisabled()

    // Delete asks first; "Keep" backs out without a request.
    await rows.nth(0).getByRole('button', { name: 'Delete take' }).click()
    await rows.nth(0).getByRole('button', { name: 'Keep' }).click()
    expect(apiMock.recordingDeletes).toEqual([])

    await rows.nth(0).getByRole('button', { name: 'Delete take' }).click()
    await rows.nth(0).getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(rows).toHaveCount(2)
    expect(apiMock.recordingDeletes).toEqual(['take-2'])
    await expect(page.getByRole('status').first()).toContainText('Take deleted')

    // Escape closes the panel.
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
})

test('share menu turns the read-only link on, shows it, and turns it off again', async ({ page, apiMock }) => {
    await page.getByRole('button', { name: 'Share score' }).click()
    const panel = page.getByRole('dialog', { name: 'Share score' })
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: 'Turn on link' }).click()

    const link = panel.getByRole('textbox', { name: 'Share link' })
    await expect(link).toHaveValue(new RegExp(`/s/${MOCK_SHARE_TOKEN}$`))
    expect(apiMock.shareToken).toBe(MOCK_SHARE_TOKEN)

    await panel.getByRole('button', { name: 'Turn off link' }).click()
    await expect(panel.getByRole('button', { name: 'Turn on link' })).toBeVisible()
    expect(apiMock.shareToken).toBeNull()
})
