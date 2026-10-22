import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
import { mockRecording } from './recording'

/**
 * Mocked-API editor e2e. Drives the real editor in a real browser; the scores
 * API and auth session are intercepted (see fixtures.ts). Exercises rendering,
 * recording (a blocked mic, and a mocked take), keyboard pitch editing + debounced
 * autosave, range selection and the clipboard, shortcut rebinding, the tool
 * dock's popovers, the header's recordings / share menus, and exporting.
 */

test.beforeEach(async ({ page, apiMock }) => {
    void apiMock // installs the route mocks + auth cookie
    await page.goto(`/scores/${MOCK_SCORE_ID}`)
    // Editor chrome is present only after the score finishes loading.
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
})

test('renders the editor chrome and the engraved score', async ({ page }) => {
    await expect(page.locator('header input')).toHaveValue(MOCK_TITLE)
    await expect(page.getByTestId('editor-loading')).toHaveCount(0)

    // Transport + note-input controls are wired up.
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible()
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

// The desktop half of mobile.spec's blocked-mic check: the header's Record button.
test('a blocked microphone explains the fix, Record stays live, and the score is as it was', async ({ page }) => {
    // Refuse the microphone: the take clears the selection and inserts its bar as it starts,
    // then fails to open the mic — and takes both back.
    await denyMicrophone(page)
    const band = await page.locator(SELECTION_BANDS).first().boundingBox()
    if (!band) throw new Error('expected the auto-selected note')

    const record = page.getByRole('button', { name: 'Record', exact: true })
    await expect(record).toBeEnabled()
    await record.click()
    const dialog = page.getByRole('dialog', { name: "Solkey can't hear you yet" })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Your browser is blocking the microphone for this site.')

    // Try again presses Record again — still refused, so the dialog comes back.
    await dialog.getByRole('button', { name: 'Try again' }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Not now' }).click()
    await expect(dialog).toHaveCount(0)

    // Never a dead Record; the same note is selected in the same place (the failed take's bar is gone).
    await expect(record).toBeEnabled()
    await expect(page.locator(SELECTION_BANDS)).toHaveCount(1)
    expect(await page.locator(SELECTION_BANDS).first().boundingBox()).toEqual(band)
})

test('a take: the strip replaces the tools, Record becomes Stop, and the bar after the take is selected with a summary', async ({
    page,
    browserName,
}) => {
    test.skip(browserName === 'webkit', 'the synthetic microphone needs Chromium’s MediaRecorder')
    await mockRecording(page)
    const record = page.getByRole('button', { name: 'Record', exact: true })
    await record.click()

    // Count-in: the strip stands in for the dock's tools, and the record button is the stop.
    const strip = page.getByRole('group', { name: 'Recording status' })
    await expect(strip).toContainText('Get ready')
    await expect(page.getByRole('group', { name: 'Note tools' })).toHaveCount(0)
    const stop = page.getByRole('button', { name: 'Stop recording', exact: true })
    await expect(stop).toBeVisible()
    await expect(strip).toContainText('Recording', { timeout: 6000 })
    await expect(strip).toContainText('Press Space or')

    await stop.click()
    // The summary names the bar the take added and the next step, with a way to hear it and to take it back.
    const summary = page.getByRole('status').filter({ hasText: /Added bars? 1(–2)?\. Click any note to fix it\./ })
    await expect(summary).toBeVisible()
    await expect(summary.getByRole('button', { name: 'Hear it back' })).toBeVisible()
    await expect(summary.getByRole('button', { name: 'Undo this recording', exact: true })).toBeVisible()
    // The dock is back, Record is Record again, and the bar after the take is selected.
    await expect(page.getByRole('group', { name: 'Note tools' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled()
    await expect(page.locator(SELECTION_BANDS)).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Rest', exact: true })).toBeEnabled()
    // Screen readers hear it too, through the editor's live region.
    await expect(page.locator('[aria-live="polite"]:not([role])')).toHaveText(/^Recording stopped\. Added bars? 1( to 2)?\./)
})

test('the summary’s Undo takes the whole recording back in one step', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'the synthetic microphone needs Chromium’s MediaRecorder')
    await mockRecording(page)
    const headerUndo = page.getByRole('group', { name: 'History' }).getByRole('button', { name: 'Undo', exact: true })
    const headerRedo = page.getByRole('group', { name: 'History' }).getByRole('button', { name: 'Redo', exact: true })
    await expect(headerUndo).toBeDisabled()
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    await expect(page.getByRole('group', { name: 'Recording status' })).toContainText('Recording', { timeout: 6000 })
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()

    const summary = page.getByRole('status').filter({ hasText: /Added bars? 1/ })
    await expect(summary).toBeVisible()
    await expect(headerUndo).toBeEnabled()
    await summary.getByRole('button', { name: 'Undo this recording', exact: true }).click()
    await expect(summary).toHaveCount(0)
    // The take was the only step: nothing is left to undo, and the take can be redone.
    await expect(headerUndo).toBeDisabled()
    await expect(headerRedo).toBeEnabled()
})

test('a take that heard no notes says so and offers to undo it', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'the synthetic microphone needs Chromium’s MediaRecorder')
    await mockRecording(page, { notes: false })
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    const stop = page.getByRole('button', { name: 'Stop recording', exact: true })
    await expect(page.getByRole('group', { name: 'Recording status' })).toContainText('Recording', { timeout: 6000 })
    await stop.click()

    const summary = page.getByRole('status').filter({ hasText: 'No notes this time' })
    await expect(summary).toBeVisible()
    // Named for what it undoes (the glossary's 'recording'), so it never clashes with the header's Undo.
    const undo = summary.getByRole('button', { name: 'Undo this recording', exact: true })
    await expect(undo).toBeVisible()
    await expect(summary.getByRole('button', { name: 'Hear it back' })).toHaveCount(0)
    await undo.click()
    await expect(summary).toHaveCount(0)
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

    // Set J as the new shortcut for "Rest on/off" (default: R).
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
    // The key is named as the machine's own keyboard layout prints physical KeyQ — Q on US
    // QWERTY, A on AZERTY — the same map the shortcuts dialog reads.
    const keycap = await page.evaluate(async () => {
        const { keyboard } = navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<ReadonlyMap<string, string>> } }
        return ((await keyboard?.getLayoutMap?.())?.get('KeyQ') ?? 'q').toUpperCase()
    })
    await expect(page.locator('kbd').filter({ hasText: new RegExp(`^${keycap}$`) })).toBeVisible()
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

    // A toolbar like any other: the arrows move between its actions (one tab stop), and they
    // never reach the editor — the selection stays put under the bar.
    const band = await page.locator(SELECTION_BANDS).first().boundingBox()
    await page.keyboard.press('ArrowRight')
    await expect(toolbar.getByRole('button', { name: 'Delete' })).toBeFocused()
    await expect(toolbar.getByRole('button', { name: 'Delete' })).toHaveAttribute('tabindex', '0')
    await expect(toolbar.getByRole('button', { name: 'Copy' })).toHaveAttribute('tabindex', '-1')
    await page.keyboard.press('End')
    await expect(toolbar.getByRole('button', { name: 'Select all' })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(toolbar.getByRole('button', { name: 'Copy' })).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(toolbar.getByRole('button', { name: 'Select all' })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(toolbar.getByRole('button', { name: 'Copy' })).toBeFocused()
    expect(await page.locator(SELECTION_BANDS).first().boundingBox()).toEqual(band)

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
    // The tab no longer carries the score's name.
    await expect(page).toHaveTitle('Your scores — Solkey')
})

test('recordings menu lists the score’s recordings and deletes one after confirmation', async ({ page, apiMock }) => {
    await page.getByRole('button', { name: 'Recordings', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Recordings' })
    await expect(panel).toBeVisible()
    const rows = panel.getByRole('list', { name: 'Recordings' }).getByRole('listitem')
    await expect(rows).toHaveCount(3)
    // Numbered by age, newest first, so two from the same minute still differ.
    await expect(rows.nth(0)).toContainText('Recording 3')
    await expect(rows.nth(0)).toContainText('0:42')
    await expect(rows.nth(1)).toContainText('Recording 2')
    await expect(rows.nth(1)).toContainText('2:05')
    // A recording from before audio archiving cannot be played.
    await expect(rows.nth(2).getByRole('button', { name: 'Play recording' })).toBeDisabled()

    // Delete asks first, says the notes stay, and lands on "Keep", which backs out without a request.
    await rows.nth(0).getByRole('button', { name: 'Delete recording' }).click()
    await expect(rows.nth(0)).toContainText('Delete this recording? Your notes stay.')
    await expect(rows.nth(0).getByRole('button', { name: 'Keep' })).toBeFocused()
    await rows.nth(0).getByRole('button', { name: 'Keep' }).click()
    expect(apiMock.recordingDeletes).toEqual([])

    await rows.nth(0).getByRole('button', { name: 'Delete recording' }).click()
    await rows.nth(0).getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(rows).toHaveCount(2)
    expect(apiMock.recordingDeletes).toEqual(['take-2'])
    await expect(page.getByRole('status').first()).toContainText('Recording deleted')

    // Escape closes the panel.
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
})

test('share menu creates and copies the read-only link in one press, and turns it off after a confirm', async ({
    page,
    context,
    apiMock,
    browserName,
}) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('button', { name: 'Share score' }).click()
    const panel = page.getByRole('dialog', { name: 'Share score' })
    await expect(panel).toBeVisible()
    await expect(panel).toContainText("Anyone with the link can see, play and download this score. They can't change it.")
    await panel.getByRole('button', { name: 'Create link and copy' }).click()

    const link = panel.getByRole('textbox', { name: 'Share link' })
    await expect(link).toHaveValue(new RegExp(`/s/${MOCK_SHARE_TOKEN}$`))
    expect(apiMock.shareToken).toBe(MOCK_SHARE_TOKEN)
    if (browserName === 'chromium') {
        // Copied in the same press: Copy says so for a moment — and no toast lands over the dock.
        await expect(panel.getByRole('button', { name: 'Copied' })).toBeFocused()
        expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/s/${MOCK_SHARE_TOKEN}$`))
        await expect(page.getByRole('status').filter({ hasText: /copied/i })).toHaveCount(0)
        await expect(panel.getByRole('button', { name: 'Copy', exact: true })).toBeVisible({ timeout: 4000 })
    } else {
        // Wherever the clipboard says no, the link is still ready, with Copy right beside it.
        await expect(panel.getByRole('button', { name: /^Cop(y|ied)$/ })).toBeVisible()
    }

    // Turning off asks first; Keep it on backs out without a request.
    await panel.getByRole('button', { name: 'Turn off link' }).click()
    await expect(panel).toContainText('Turn off? The link stops working for everyone who has it.')
    await expect(panel.getByRole('button', { name: 'Keep it on' })).toBeFocused()
    await panel.getByRole('button', { name: 'Keep it on' }).click()
    expect(apiMock.shareToken).toBe(MOCK_SHARE_TOKEN)
    await expect(panel.getByRole('button', { name: 'Turn off link' })).toBeFocused()

    await panel.getByRole('button', { name: 'Turn off link' }).click()
    await panel.getByRole('button', { name: 'Turn off', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'Create link and copy' })).toBeVisible()
    expect(apiMock.shareToken).toBeNull()
})

test('the header says when the score is saved, and a failed save stays until it gets through', async ({ page }) => {
    const saved = page.locator('header').getByText('Saved', { exact: true })
    await expect(saved).toHaveClass(/sr-only/)
    // A failing server: the edit waits, says so — and keeps saying so, well past the old 6 s toast.
    const scoreUrl = new RegExp(`/scores/${MOCK_SCORE_ID}$`)
    await page.route(scoreUrl, (route) => (route.request().method() === 'PATCH' ? route.abort('connectionrefused') : route.fallback()))
    await page.getByRole('button', { name: 'Higher', exact: true }).click()
    await expect(page.locator('header').getByText('Saving…')).toBeVisible()
    const retrying = page.getByRole('button', { name: 'Not saved yet — retrying' })
    await expect(retrying).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('alert').filter({ hasText: /saved/ })).toHaveCount(0)
    await expect(page.locator('[aria-live="polite"]:not([role])')).toHaveText('Not saved yet — retrying.')

    // Back online: pressing it retries now, and the save lands.
    await page.unroute(scoreUrl)
    const patch = waitForAutosave(page)
    await retrying.click()
    await patch
    await expect(saved).toBeVisible()
    await expect(saved).not.toHaveClass(/sr-only/)
    await expect(retrying).toHaveCount(0)
    await expect(page.locator('[aria-live="polite"]:not([role])')).toHaveText('Changes saved again.')
    // After a moment the word goes; the check stays, still named for a screen reader.
    await expect(saved).toHaveClass(/sr-only/, { timeout: 6000 })
})

test('renaming: Enter hands the keys back to the score, Escape puts the old title back, and the tab follows', async ({ page }) => {
    await expect(page).toHaveTitle(`${MOCK_TITLE} — Solkey`)
    const title = page.getByRole('textbox', { name: 'Score title' })
    await expect(title).toHaveAttribute('placeholder', 'Untitled score')
    await title.fill('Morning song')
    await expect(page).toHaveTitle('Morning song — Solkey')
    await page.keyboard.press('Enter')
    // The keys go back to the named canvas itself, so a screen reader hears the score and its how-to.
    const canvas = page.getByRole('application', { name: 'Morning song — score' })
    await expect(canvas).toBeFocused()

    await title.click()
    await title.fill('Not this')
    await page.keyboard.press('Escape')
    await expect(title).toHaveValue('Morning song')
    await expect(canvas).toBeFocused()

    await title.fill('')
    await expect(page).toHaveTitle('Untitled score — Solkey')
})

test('the canvas is a named score editor that says the selected note and what an edit changed', async ({ page }) => {
    const canvas = page.getByRole('application', { name: `${MOCK_TITLE} — score` })
    await expect(canvas).toHaveAttribute('aria-roledescription', 'score editor')
    await expect(canvas).toHaveAccessibleDescription(
        'Left and right arrows move between notes. Up and down change the pitch. Press ? for all shortcuts.',
    )
    const live = page.locator('[aria-live="polite"]:not([role])')
    await focusEditor(page)
    await page.keyboard.press('ArrowRight')
    await expect(live).toHaveText('D, quarter note. Bar 1, beat 2.')
    await page.keyboard.press('ArrowUp')
    await expect(live).toHaveText('E.')
    await page.keyboard.press('Shift+ArrowRight')
    await expect(live).toHaveText('2 notes selected, bar 1.')
})

test('a delete from the selection actions offers its Undo, which puts the note back', async ({ page }) => {
    const band = await page.locator(SELECTION_BANDS).first().boundingBox()
    if (!band) throw new Error('expected the auto-selected note')
    await page.mouse.click(band.x + band.width / 2, band.y + band.height / 2, { button: 'right' })
    await page.getByRole('toolbar', { name: 'Selection actions' }).getByRole('button', { name: 'Delete' }).click()
    const toast = page.getByRole('status').filter({ hasText: 'Deleted the note.' })
    await expect(toast).toBeVisible()
    const rest = page.getByRole('button', { name: 'Rest', exact: true })
    await expect(rest).toHaveAttribute('aria-pressed', 'true')
    // Named for what it undoes, so it never clashes with the header's Undo.
    await toast.getByRole('button', { name: 'Undo delete' }).click()
    await expect(toast).toHaveCount(0)
    await expect(rest).toHaveAttribute('aria-pressed', 'false')
})

test('a big edit’s Undo toast goes as soon as another edit comes along', async ({ page }) => {
    await page.getByRole('button', { name: 'Transpose', exact: true }).click()
    const popover = page.getByRole('dialog', { name: 'Transpose' })
    await popover.getByRole('button', { name: 'Half step higher' }).click()
    await popover.getByRole('button', { name: 'Apply' }).click()
    const toast = page.getByRole('status').filter({ hasText: 'Moved 1 half step higher.' })
    await expect(toast.getByRole('button', { name: 'Undo this change' })).toBeVisible()
    await page.getByRole('button', { name: 'Higher', exact: true }).click()
    await expect(toast).toHaveCount(0)
})

test.describe('an empty score', () => {
    test.beforeEach(async ({ page }) => {
        // The fixture's first bar as rests too: a score without a single pitched note.
        const stored = JSON.parse(readFileSync(resolve(process.cwd(), 'e2e/fixtures/score.partwise.json'), 'utf8')) as {
            parts: { measures: { entries: Record<string, unknown>[] }[] }[]
        }
        for (const measure of stored.parts[0].measures) {
            measure.entries = measure.entries.map((entry) => {
                if (entry._type !== 'note' || !entry.pitch) return entry
                const { pitch: _pitch, ...rest } = entry
                return { ...rest, rest: {} }
            })
        }
        await page.route(/\/scores\/[^/]+\/load$/, (route) =>
            route.fulfill({
                json: stored,
                headers: {
                    'access-control-allow-origin': route.request().headers()['origin'] ?? '*',
                    'access-control-allow-credentials': 'true',
                },
            }),
        )
        await page.reload()
        await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
    })

    test('says what to do and that Solkey writes melodies, with the button to start right there', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'Sing, hum or play your tune' })).toBeVisible()
        await expect(
            page.getByText('Press record, wait for the count-in, then go. Solkey writes melodies, one note at a time.'),
        ).toBeVisible()
        await expect(page.getByText('Or click a beat on the staff to place notes by hand.')).toBeVisible()
        // Start recording has a name of its own: the transport's Record stays the one exact 'Record'.
        await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Record', exact: true })).toHaveCount(1)
        // It describes the canvas too, and never reaches the score's own svg.
        await expect(page.getByRole('application')).toHaveAccessibleDescription(/^Press record, wait for the count-in/)
        expect(await page.locator('.max-w-240 svg[data-score-canvas]').innerHTML()).not.toContain('Sing, hum')
    })

    test('Start recording starts a take; once notes land the empty state is gone', async ({ page, browserName }) => {
        test.skip(browserName === 'webkit', 'the synthetic microphone needs Chromium’s MediaRecorder')
        await mockRecording(page)
        const heading = page.getByRole('heading', { name: 'Sing, hum or play your tune' })
        await expect(heading).toBeVisible()
        await page.getByRole('button', { name: 'Start recording' }).click()
        const strip = page.getByRole('group', { name: 'Recording status' })
        await expect(strip).toContainText('Get ready')
        await expect(heading).toHaveCount(0)
        await expect(strip).toContainText('Recording', { timeout: 6000 })
        await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
        await expect(page.getByRole('status').filter({ hasText: /Added bars? 1/ })).toBeVisible()
        await expect(heading).toHaveCount(0)
    })

    test('a note written by hand sends it away; emptied again, it comes back', async ({ page }) => {
        const heading = page.getByRole('heading', { name: 'Sing, hum or play your tune' })
        await expect(heading).toBeVisible()
        await page.getByRole('button', { name: 'Rest', exact: true }).click() // the selected rest becomes a note
        await expect(heading).toHaveCount(0)
        await page.getByRole('button', { name: 'Rest', exact: true }).click()
        await expect(heading).toBeVisible()
    })

    test('from onboarding, focus starts on Start recording', async ({ page }) => {
        await page.goto(`/scores/${MOCK_SCORE_ID}?first=1`)
        await expect(page.getByRole('button', { name: 'Start recording' })).toBeFocused()
    })

    test('Start recording from the keyboard hands the keys to the canvas, so Escape stops the recording', async ({ page, browserName }) => {
        test.skip(browserName === 'webkit', 'the synthetic microphone needs Chromium’s MediaRecorder')
        await mockRecording(page)
        await page.goto(`/scores/${MOCK_SCORE_ID}?first=1`)
        const start = page.getByRole('button', { name: 'Start recording' })
        await expect(start).toBeFocused()
        await page.keyboard.press('Enter')
        const strip = page.getByRole('group', { name: 'Recording status' })
        await expect(strip).toBeVisible()
        await expect(start).toHaveCount(0)
        // Never dropped to <body> as the empty state goes: the canvas holds the keys.
        await expect(page.getByRole('application', { name: `${MOCK_TITLE} — score` })).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(strip).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible()
    })
})
