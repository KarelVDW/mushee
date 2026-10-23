import { expect, focusEditor, MOCK_SCORE_ID, MOCK_SHARE_TOKEN, test, waitForAutosave } from './fixtures'

/**
 * Mocked-API editor-chrome e2e: the dock controls and popovers that
 * editor.spec.ts doesn't already cover (duration/rest/clef-open/tempo-open are
 * there), the header title + instrument + export controls, the shortcuts
 * dialog's remove/restore buttons, and the in-score add/remove measure targets.
 */

test.beforeEach(async ({ page, apiMock }) => {
    void apiMock
    await page.goto(`/scores/${MOCK_SCORE_ID}`)
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
})

test('renaming the score in the header autosaves the new title', async ({ page, apiMock }) => {
    const title = page.getByRole('textbox', { name: 'Score title' })
    await title.fill('Renamed by e2e')

    await expect.poll(() => apiMock.patches.some((b) => b.title === 'Renamed by e2e'), { timeout: 8000 }).toBe(true)
})

test('a score edit inside the autosave window does not drop a pending rename', async ({ page, apiMock }) => {
    await page.getByRole('textbox', { name: 'Score title' }).fill('Renamed then edited')
    // Well inside the 2 s debounce: the edit's save must carry the title along, not replace it.
    await focusEditor(page)
    await page.keyboard.press('ArrowUp')

    await expect
        .poll(() => apiMock.patches.some((b) => b.title === 'Renamed then edited' && Boolean(b.measures ?? b.allMeasures)), {
            timeout: 8000,
        })
        .toBe(true)
})

test('turning the share link on after an edit keeps the edit and the incremental autosave', async ({ page }) => {
    const scoreSvg = page.locator('.max-w-240 svg').first()

    // A freshly loaded score is fully structure-dirty, so the first save sends every measure.
    await focusEditor(page)
    const firstPatch = waitForAutosave(page)
    await page.keyboard.press('ArrowUp')
    expect(((await firstPatch).postDataJSON() as Record<string, unknown>).allMeasures).toBeTruthy()
    const edited = await scoreSvg.innerHTML()

    // The share toggle rewrites the cached score meta; it must not re-attach the load-time document.
    await page.getByRole('button', { name: 'Share score' }).click()
    const panel = page.getByRole('dialog', { name: 'Share score' })
    await panel.getByRole('button', { name: 'Create link and copy' }).click()
    await expect(panel.getByRole('textbox', { name: 'Share link' })).toHaveValue(new RegExp(`/s/${MOCK_SHARE_TOKEN}$`))
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    expect(await scoreSvg.innerHTML()).toBe(edited)

    // A re-attached score would be structure-dirty again; the live one saves just the changed measure.
    await focusEditor(page)
    const secondPatch = waitForAutosave(page)
    await page.keyboard.press('ArrowUp')
    const body = (await secondPatch).postDataJSON() as Record<string, unknown>
    expect(body.measures).toBeTruthy()
    expect(body.allMeasures).toBeUndefined()
})

test('dotted sits with the note lengths; triplet and tie live behind More', async ({ page }) => {
    const more = page.getByRole('button', { name: 'More note tools' })
    const panel = page.getByRole('dialog', { name: 'More note tools' })
    // Tying is offered only where a tie can bind: the first note (C5) can't tie into D5 — and says so.
    await more.click()
    const tie = panel.getByRole('button', { name: 'Tie', exact: true })
    await expect(tie).toBeDisabled()
    await expect(tie).toContainText('Tie needs the next note to be the same pitch.')
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)

    // Lower the second note onto C5 and step back: now the first note has a note to tie into.
    await focusEditor(page)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowLeft')
    await more.click()
    await expect(tie).toBeEnabled()
    // The toggles keep the panel open, so the state they set stays in view.
    await tie.click()
    await expect(tie).toHaveAttribute('aria-pressed', 'true')
    await tie.click()
    await expect(tie).toHaveAttribute('aria-pressed', 'false')

    const triplet = panel.getByRole('button', { name: 'Triplet', exact: true })
    await triplet.click()
    await expect(triplet).toHaveAttribute('aria-pressed', 'true')
    await triplet.click()
    await expect(triplet).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('Escape')

    const dotted = page.getByRole('group', { name: 'Note length' }).getByRole('button', { name: 'Dotted' })
    const patchDot = waitForAutosave(page)
    await dotted.click()
    await patchDot
    await expect(dotted).toHaveAttribute('aria-pressed', 'true')
    await dotted.click()
    await expect(dotted).toHaveAttribute('aria-pressed', 'false')
})

test('simplify sharps and flats runs from the More popover', async ({ page }) => {
    await page.getByRole('button', { name: 'More note tools' }).click()
    const panel = page.getByRole('dialog', { name: 'More note tools' })
    // Nothing to respell in C major: the score stays as it is, and the panel closes.
    await panel.getByRole('button', { name: 'Simplify sharps and flats' }).click()
    await expect(panel).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Key: C major' })).toBeVisible()
})

test('higher and lower nudge the selected note and autosave', async ({ page }) => {
    const patch = waitForAutosave(page)
    await page.getByRole('button', { name: 'Lower', exact: true }).click()
    const body = (await patch).postDataJSON() as Record<string, unknown>
    expect(body.measures ?? body.allMeasures).toBeTruthy()
})

test('on a run of notes the length tools show a mixed state and stay off', async ({ page }) => {
    // C5 D5 E5 F5 are quarters, the rests too: make the first note a half, then select across it.
    await page.getByRole('button', { name: 'Half note' }).click()
    await focusEditor(page)
    await page.keyboard.press('Shift+ArrowRight')
    const durations = page.getByRole('group', { name: 'Note duration' }).getByRole('button')
    // No length is shared by every selected note, so none is pressed — and none can be clicked.
    for (const button of await durations.all()) await expect(button).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('button', { name: 'Quarter note' })).toHaveAttribute('aria-disabled', 'true')
    // The length keys decline too, rather than changing one note of the run.
    await page.keyboard.press('e')
    for (const button of await durations.all()) await expect(button).toHaveAttribute('aria-pressed', 'false')
})

test('the sharp-or-flat control sets flat, sharp, and natural', async ({ page }) => {
    const group = page.getByRole('group', { name: 'Sharp or flat' })
    await expect(group.getByRole('button')).toHaveCount(3)
    const flat = group.getByRole('button', { name: 'Flat' })
    const natural = group.getByRole('button', { name: 'Natural' })
    const sharp = group.getByRole('button', { name: 'Sharp' })

    // Flat.
    const patchFlat = waitForAutosave(page)
    await flat.click()
    await patchFlat
    await expect(flat).toHaveAttribute('aria-pressed', 'true')

    // Sharp replaces it.
    await sharp.click()
    await expect(sharp).toHaveAttribute('aria-pressed', 'true')
    await expect(flat).toHaveAttribute('aria-pressed', 'false')

    // Natural clears back.
    await natural.click()
    await expect(natural).toHaveAttribute('aria-pressed', 'true')
})

test('selecting a clef from the popover applies it and closes the popover', async ({ page }) => {
    await page.getByRole('button', { name: /^Clef:/ }).click()
    const popover = page.getByRole('dialog', { name: 'Select clef' })
    await expect(popover).toBeVisible()
    // Treble and Bass lead, with what they are for; the rest wait behind "More clefs".
    await expect(popover.getByRole('button', { name: 'Set Alto clef' })).toHaveCount(0)

    const patch = waitForAutosave(page)
    await popover.getByRole('button', { name: 'Set Bass clef' }).click()
    await patch
    await expect(popover).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Clef: Bass' })).toBeVisible()
})

test('a rarer clef is one "More clefs" away, and stays in view once in use', async ({ page }) => {
    const clef = page.getByRole('button', { name: /^Clef:/ })
    await clef.click()
    const popover = page.getByRole('dialog', { name: 'Select clef' })
    await popover.getByRole('button', { name: 'More clefs' }).click()
    const patch = waitForAutosave(page)
    await popover.getByRole('button', { name: 'Set Alto clef' }).click()
    await patch
    await expect(page.getByRole('button', { name: 'Clef: Alto' })).toBeVisible()

    // Reopened, the clef in use sits with Treble and Bass — pressed, no expanding needed.
    await clef.click()
    await expect(popover.getByRole('button', { name: 'Set Alto clef' })).toHaveAttribute('aria-pressed', 'true')
    await expect(popover.getByRole('button', { name: 'More clefs' })).toBeVisible()
    await page.keyboard.press('Escape')
})

test('the time popover names meters by their beats and keeps the rest behind More', async ({ page }) => {
    await page.getByRole('button', { name: /^Time signature:/ }).click()
    const popover = page.getByRole('dialog', { name: 'Select time signature' })
    await expect(popover.getByRole('button', { name: 'Set 6/8 time' })).toContainText('2 swaying beats')
    await expect(popover.getByRole('button', { name: 'Set 3/8 time' })).toHaveCount(0)
    await popover.getByRole('button', { name: 'More time signatures' }).click()
    await expect(popover.getByRole('button', { name: 'Set 3/8 time' })).toContainText('3 quick beats')
    await page.keyboard.press('Escape')
})

test('selecting a key signature from the popover applies it', async ({ page }) => {
    await page.getByRole('button', { name: /^Key:/ }).click()
    const popover = page.getByRole('dialog', { name: 'Select key signature' })
    await expect(popover).toBeVisible()

    const patch = waitForAutosave(page)
    await popover.getByRole('button', { name: 'G major' }).click()
    await patch
    await expect(popover).toHaveCount(0)

    // The chip names the key in words; reopened, the chosen key is marked selected.
    const chip = page.getByRole('button', { name: 'Key: G major' })
    await expect(chip).toHaveText('G major')
    await chip.click()
    await expect(popover.getByRole('button', { name: 'G major', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
})

test('selecting a time signature from the popover rebars the score', async ({ page }) => {
    await page.getByRole('button', { name: /^Time signature:/ }).click()
    const popover = page.getByRole('dialog', { name: 'Select time signature' })
    await expect(popover).toBeVisible()

    const patch = waitForAutosave(page)
    await popover.getByRole('button', { name: 'Set 3/4 time' }).click()
    await patch
    await expect(popover).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Time signature: 3/4' })).toBeVisible()

    // Reopen: the chosen meter is marked selected.
    await page.getByRole('button', { name: /^Time signature:/ }).click()
    await expect(page.getByRole('button', { name: 'Set 3/4 time' })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
})

test('the tempo popover sets a bpm through the input and Enter commits it', async ({ page }) => {
    await page.getByRole('button', { name: /bpm$/ }).click()
    const popover = page.getByRole('dialog', { name: 'Set tempo' })
    await expect(popover).toBeVisible()

    const bpm = popover.getByRole('spinbutton', { name: 'Tempo (bpm)' })
    await bpm.fill('90')
    const patch = waitForAutosave(page)
    await popover.getByRole('button', { name: 'Set tempo' }).click()
    await patch
    await expect(popover).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Tempo: 90 bpm' })).toBeVisible()
})

test('the transpose popover moves the whole score up two half steps', async ({ page }) => {
    await page.getByRole('button', { name: 'Transpose', exact: true }).click()
    const popover = page.getByRole('dialog', { name: 'Transpose' })
    await expect(popover).toBeVisible()

    // While the popover is open, its target range pulses magenta on the canvas.
    await expect(page.locator('[data-score-highlight="pulse"]')).toBeVisible()

    // Apply stays disabled until an actual move is dialed in.
    const apply = popover.getByRole('button', { name: 'Apply' })
    await expect(apply).toBeDisabled()
    await expect(popover).toContainText('No change yet')

    await popover.getByRole('button', { name: 'Half step higher' }).click()
    await popover.getByRole('button', { name: 'Half step higher' }).click()
    await expect(apply).toBeEnabled()
    // The readout says what will happen, in plain words — and where the whole score lands.
    await expect(popover).toContainText('2 half steps higher — now in D major')

    const patch = waitForAutosave(page)
    await apply.click()
    // The pulse hands over to a brief flash over the transposed range.
    await expect(page.locator('[data-score-highlight="flash"]')).toBeVisible()
    await patch
    await expect(popover).toHaveCount(0)
    // C major up a major second lands in D major: the dock's key control follows.
    await expect(page.getByRole('button', { name: 'Key: D major' })).toBeVisible()
    // The flash is transient: it clears on its own.
    await expect(page.locator('[data-score-highlight]')).toHaveCount(0)
})

test('the transpose popover expands to more options and transposes to a target key', async ({ page }) => {
    await page.getByRole('button', { name: 'Transpose', exact: true }).click()
    const popover = page.getByRole('dialog', { name: 'Transpose' })
    await popover.getByRole('button', { name: 'More options' }).click()

    const tabs = popover.getByRole('group', { name: 'Transpose by' })
    await expect(tabs).toBeVisible()
    // The semitone stepper is still there for those who count that way.
    await tabs.getByRole('button', { name: 'Semitones' }).click()
    await popover.getByRole('button', { name: 'Increase semitones' }).click()
    await expect(popover).toContainText('1 half step higher')
    await tabs.getByRole('button', { name: 'Key' }).click()
    await popover.getByRole('button', { name: 'E♭ major' }).click()

    const patch = waitForAutosave(page)
    await popover.getByRole('button', { name: 'Apply' }).click()
    await patch
    await expect(popover).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Key: E♭ major' })).toBeVisible()
})

test('popovers and the export menu dismiss with Escape without touching the score', async ({ page, apiMock }) => {
    const before = apiMock.patches.length

    await page.getByRole('button', { name: /^Clef:/ }).click()
    await expect(page.getByRole('dialog', { name: 'Select clef' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Select clef' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Export score' }).click()
    await expect(page.getByRole('dialog', { name: 'Export score' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Export score' })).toHaveCount(0)
    // Focus goes back to the chip that opened the menu.
    await expect(page.getByRole('button', { name: 'Export score' })).toBeFocused()

    expect(apiMock.patches.length).toBe(before)
})

test('keys pressed inside the export menu stay out of the score', async ({ page, apiMock }) => {
    const before = apiMock.patches.length
    const restToggle = page.getByRole('button', { name: 'Rest', exact: true })

    await page.getByRole('button', { name: 'Export score' }).click()
    const menu = page.getByRole('dialog', { name: 'Export score' })
    // Focus lands on the first format, PDF (the menu leads with what most people want).
    await expect(menu.getByRole('button', { name: 'PDF' })).toBeFocused()

    // Backspace would clear the selected note's pitch if it reached the editor.
    await page.keyboard.press('Backspace')
    await expect(menu).toBeVisible()
    await expect(restToggle).toHaveAttribute('aria-pressed', 'false')
    expect(apiMock.patches.length).toBe(before)
})

test('an open popover keeps editor shortcuts from firing behind it', async ({ page, apiMock }) => {
    const before = apiMock.patches.length
    const restToggle = page.getByRole('button', { name: 'Rest', exact: true })

    await page.getByRole('button', { name: /^Clef:/ }).click()
    await expect(page.getByRole('dialog', { name: 'Select clef' })).toBeVisible()
    await page.keyboard.press('r')
    await expect(restToggle).toHaveAttribute('aria-pressed', 'false')
    expect(apiMock.patches.length).toBe(before)

    // Once the popover is gone the same key reaches the score again.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Select clef' })).toHaveCount(0)
    await page.keyboard.press('r')
    await expect(restToggle).toHaveAttribute('aria-pressed', 'true')
})

test('changing the instrument through the dialog updates the header chip', async ({ page }) => {
    await page.getByRole('button', { name: /^Change instrument/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Change instrument' })
    await expect(dialog).toBeVisible()

    // The confirm names the pick; until a different instrument is picked it waits, and says why.
    await expect(dialog).toContainText('Changes the playback sound and how the notes are written for it. Your melody stays the same.')
    const confirm = dialog.getByRole('button', { name: /^Use / })
    await expect(confirm).toHaveText('Use Piano')
    await expect(confirm).toBeDisabled()
    await expect(confirm).toHaveAccessibleDescription('Pick a different instrument')
    // No 'Instrument · Piano' readout: the picked tile and the confirm already say it.
    await expect(dialog.getByText(/^Instrument · /)).toHaveCount(0)
    // One explanation before the choice: the new-score intro ('… change it later') stays out,
    // while the piano's melody line — a sanctioned moment — stays.
    await expect(dialog.getByText('What will you sing or play?')).toHaveCount(0)
    await expect(dialog.getByText(/You can change it later/)).toHaveCount(0)
    await expect(dialog.getByText('On piano, play the tune one note at a time — Solkey writes melodies.')).toBeVisible()

    // Violin is a popular tile; picking it names the confirm after it.
    await dialog.getByRole('button', { name: 'Pick Violin', exact: true }).click()
    await expect(confirm).toHaveText('Use Violin')
    await expect(confirm).toBeEnabled()

    const patch = waitForAutosave(page)
    await confirm.click()
    await patch
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Change instrument (current: Violin)' })).toBeVisible()
})

test('the change-instrument dialog cancels without applying', async ({ page }) => {
    const chip = page.getByRole('button', { name: /^Change instrument/ })
    const originalName = await chip.getAttribute('aria-label')

    await chip.click()
    const dialog = page.getByRole('dialog', { name: 'Change instrument' })
    await dialog.getByPlaceholder('Filter instruments…').fill('violin')
    await dialog.getByRole('button', { name: 'Pick Violin', exact: true }).click()
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    await expect(dialog).toHaveCount(0)
    await expect(chip).toHaveAttribute('aria-label', originalName ?? '')
})

test('shortcuts dialog: a binding can be removed and defaults restored', async ({ page }) => {
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(dialog).toBeVisible()

    // Remove the "Rest on/off" binding entirely.
    await dialog.getByRole('button', { name: 'Remove shortcut for Rest on/off' }).click()
    await expect(dialog.getByRole('button', { name: 'Restore defaults' })).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()

    // R is now unbound: pressing it must not toggle the rest.
    const restToggle = page.getByRole('button', { name: 'Rest', exact: true })
    await focusEditor(page)
    await page.keyboard.press('r')
    await expect(restToggle).toHaveAttribute('aria-pressed', 'false')

    // Restore defaults brings R back.
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()
    await dialog.getByRole('button', { name: 'Restore defaults' }).click()
    await expect(dialog.getByRole('button', { name: 'Restore defaults' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Done' }).click()

    await page.keyboard.press('r')
    await expect(restToggle).toHaveAttribute('aria-pressed', 'true')
})

test('Add bar and Remove last bar are named buttons under the final barline', async ({ page, browserName }) => {
    const svg = page.locator('.max-w-240 svg').first()
    await expect(svg).toBeVisible()
    // Real buttons now, outside the score's svg: nothing of them is drawn into it.
    await expect(svg.locator('g[data-export-exclude]').filter({ hasText: /^[+-]$/ })).toHaveCount(0)
    const add = page.getByRole('button', { name: 'Add bar' })
    const remove = page.getByRole('button', { name: 'Remove last bar' })
    await expect(add).toHaveAccessibleDescription('Add an empty bar at the end')
    // Right-aligned under the last row's final barline — hugging the row, at least 24px under its
    // bottom staff line rather than after the svg's empty room below it — the remove 16px clear of the add.
    const [addBox, removeBox, svgBox] = await Promise.all([add.boundingBox(), remove.boundingBox(), svg.boundingBox()])
    // The staff lines: the lines of each row's pointer-transparent staff group.
    const staffBottom = await svg.evaluate((el) =>
        Math.max(...Array.from(el.querySelectorAll('g.pointer-events-none > g > line'), (line) => line.getBoundingClientRect().bottom)),
    )
    expect(addBox?.y ?? 0).toBeGreaterThanOrEqual(staffBottom + 24 - 1)
    expect(addBox?.y ?? Infinity).toBeLessThan((svgBox?.y ?? 0) + (svgBox?.height ?? 0))
    expect((removeBox?.x ?? 0) - ((addBox?.x ?? 0) + (addBox?.width ?? 0))).toBeGreaterThanOrEqual(16)

    const noteheadsBefore = await svg.locator('path').count()
    const patchAdd = waitForAutosave(page)
    await add.click()
    await patchAdd
    // A new measure appends rests: the engraving gains glyphs.
    await expect(async () => {
        expect(await svg.locator('path').count()).toBeGreaterThan(noteheadsBefore)
    }).toPass({ timeout: 5000 })

    // An empty bar goes without a fuss — no Undo toast for rests.
    const patchRemove = waitForAutosave(page)
    await remove.click()
    await patchRemove
    await expect(async () => {
        expect(await svg.locator('path').count()).toBe(noteheadsBefore)
    }).toPass({ timeout: 5000 })
    await expect(page.getByRole('status').filter({ hasText: /^Removed bar/ })).toHaveCount(0)

    // Tab reaches them — straight after the canvas, in reading order — and the second-to-last
    // bar goes too; the score's only bar never does. (Safari's Tab skips buttons unless asked.)
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
    await focusEditor(page)
    await page.keyboard.press(tab)
    await expect(add).toBeFocused()
    await page.keyboard.press(tab)
    await expect(remove).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(remove).toBeDisabled()
    await expect(remove).toHaveAccessibleDescription('A score keeps at least one bar.')
})

test('removing a bar that held notes offers its Undo', async ({ page }) => {
    const svg = page.locator('.max-w-240 svg').first()
    // A fresh bar 3 with a note in it: select all, collapse onto the last rest, make it a note.
    await page.getByRole('button', { name: 'Add bar' }).click()
    await focusEditor(page)
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Escape')
    const rest = page.getByRole('button', { name: 'Rest', exact: true })
    await rest.click()
    await expect(rest).toHaveAttribute('aria-pressed', 'false')
    const glyphs = await svg.locator('path').count()

    await page.getByRole('button', { name: 'Remove last bar' }).click()
    const toast = page.getByRole('status').filter({ hasText: 'Removed bar 3.' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: 'Undo this change' }).click()
    await expect(toast).toHaveCount(0)
    await expect.poll(() => svg.locator('path').count()).toBe(glyphs)
})

test('transport: Stop is hidden at rest and shows while something plays; Record is the largest', async ({ page }) => {
    // Idle: nothing is playing or recording, so there is no Stop to press (its slot stays, so nothing shifts).
    const stop = page.getByRole('button', { name: 'Stop', exact: true })
    await expect(stop).toBeHidden()
    const play = page.getByRole('button', { name: 'Play' })
    await expect(play).toBeEnabled()
    const record = page.getByRole('button', { name: 'Record', exact: true })
    await expect(record).toBeEnabled()
    expect((await record.boundingBox())?.width ?? 0).toBeGreaterThan((await play.boundingBox())?.width ?? Infinity)

    await play.click()
    await expect(stop).toBeVisible()
    await stop.click()
    await expect(stop).toBeHidden()
})

test('transport: the metronome has its own glyph and a pressed state, and says what it does', async ({ page }) => {
    const metronome = page.getByRole('button', { name: 'Metronome' })
    await expect(metronome).toHaveAttribute('aria-pressed', 'false')
    // A screen reader hears the whole story, tooltip or not.
    await expect(metronome).toHaveAccessibleDescription(/^Clicks during playback\. Recording always counts you in\./)
    // Hovering names it and says it only governs playback (a take always counts in and clicks).
    await metronome.hover()
    await expect(page.getByText('clicks during playback').filter({ visible: true })).toBeVisible()
    await metronome.click()
    await expect(metronome).toHaveAttribute('aria-pressed', 'true')
})
