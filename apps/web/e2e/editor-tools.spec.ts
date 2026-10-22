import { expect, MOCK_SCORE_ID, MOCK_SHARE_TOKEN, test } from './fixtures'

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

function waitForAutosave(page: import('@playwright/test').Page) {
    return page.waitForRequest((r) => r.method() === 'PATCH' && new RegExp(`/scores/${MOCK_SCORE_ID}$`).test(r.url()), {
        timeout: 8000,
    })
}

test('renaming the score in the header autosaves the new title', async ({ page, apiMock }) => {
    const title = page.getByRole('textbox', { name: 'Score title' })
    await title.fill('Renamed by e2e')

    await expect.poll(() => apiMock.patches.some((b) => b.title === 'Renamed by e2e'), { timeout: 8000 }).toBe(true)
})

test('a score edit inside the autosave window does not drop a pending rename', async ({ page, apiMock }) => {
    await page.getByRole('textbox', { name: 'Score title' }).fill('Renamed then edited')
    // Well inside the 2 s debounce: the edit's save must carry the title along, not replace it.
    await page.locator('div[tabindex="0"]').first().focus()
    await page.keyboard.press('ArrowUp')

    await expect
        .poll(() => apiMock.patches.some((b) => b.title === 'Renamed then edited' && Boolean(b.measures ?? b.allMeasures)), {
            timeout: 8000,
        })
        .toBe(true)
})

test('turning the share link on after an edit keeps the edit and the incremental autosave', async ({ page }) => {
    const editor = page.locator('div[tabindex="0"]').first()
    const scoreSvg = page.locator('.max-w-240 svg').first()

    // A freshly loaded score is fully structure-dirty, so the first save sends every measure.
    await editor.focus()
    const firstPatch = waitForAutosave(page)
    await page.keyboard.press('ArrowUp')
    expect(((await firstPatch).postDataJSON() as Record<string, unknown>).allMeasures).toBeTruthy()
    const edited = await scoreSvg.innerHTML()

    // The share toggle rewrites the cached score meta; it must not re-attach the load-time document.
    await page.getByRole('button', { name: 'Share score' }).click()
    const panel = page.getByRole('dialog', { name: 'Share score' })
    await panel.getByRole('button', { name: 'Turn on link' }).click()
    await expect(panel.getByRole('textbox', { name: 'Share link' })).toHaveValue(new RegExp(`/s/${MOCK_SHARE_TOKEN}$`))
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    expect(await scoreSvg.innerHTML()).toBe(edited)

    // A re-attached score would be structure-dirty again; the live one saves just the changed measure.
    await editor.focus()
    const secondPatch = waitForAutosave(page)
    await page.keyboard.press('ArrowUp')
    const body = (await secondPatch).postDataJSON() as Record<string, unknown>
    expect(body.measures).toBeTruthy()
    expect(body.allMeasures).toBeUndefined()
})

test('dotted, triplet, and tie dock toggles edit the selected note', async ({ page }) => {
    // Tying is offered only where a tie can bind: the first note (C5) can't tie into D5.
    const tie = page.getByRole('button', { name: 'Tie', exact: true })
    await expect(tie).toBeDisabled()
    // Lower the second note onto C5 and step back: now the first note has a note to tie into.
    await page.locator('div[tabindex="0"]').first().focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowLeft')
    await expect(tie).toBeEnabled()
    await tie.click()
    await expect(tie).toHaveAttribute('aria-pressed', 'true')
    await tie.click()
    await expect(tie).toHaveAttribute('aria-pressed', 'false')

    const dotted = page.getByRole('button', { name: 'Dotted' })
    const patchDot = waitForAutosave(page)
    await dotted.click()
    await patchDot
    await expect(dotted).toHaveAttribute('aria-pressed', 'true')
    await dotted.click()
    await expect(dotted).toHaveAttribute('aria-pressed', 'false')

    const triplet = page.getByRole('button', { name: 'Triplet' })
    await triplet.click()
    await expect(triplet).toHaveAttribute('aria-pressed', 'true')
    await triplet.click()
    await expect(triplet).toHaveAttribute('aria-pressed', 'false')
})

test('the accidental segmented control sets flat, sharp, and natural', async ({ page }) => {
    const accidentals = page.getByRole('group', { name: 'Accidental' }).getByRole('button')
    await expect(accidentals).toHaveCount(3)

    // Flat.
    const patchFlat = waitForAutosave(page)
    await accidentals.nth(1).click()
    await patchFlat
    await expect(accidentals.nth(1)).toHaveAttribute('aria-pressed', 'true')

    // Sharp replaces it.
    await accidentals.nth(2).click()
    await expect(accidentals.nth(2)).toHaveAttribute('aria-pressed', 'true')
    await expect(accidentals.nth(1)).toHaveAttribute('aria-pressed', 'false')

    // Natural clears back.
    await accidentals.nth(0).click()
    await expect(accidentals.nth(0)).toHaveAttribute('aria-pressed', 'true')
})

test('selecting a clef from the popover applies it and closes the popover', async ({ page }) => {
    await page.getByRole('button', { name: /^Clef:/ }).click()
    const popover = page.getByRole('dialog', { name: 'Select clef' })
    await expect(popover).toBeVisible()

    const patch = waitForAutosave(page)
    await popover.getByRole('button', { name: 'Set Bass clef' }).click()
    await patch
    await expect(popover).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Clef: Bass' })).toBeVisible()
})

test('selecting a key signature from the popover applies it', async ({ page }) => {
    await page.getByRole('button', { name: /^Key signature:/ }).click()
    const popover = page.getByRole('dialog', { name: 'Select key signature' })
    await expect(popover).toBeVisible()

    const patch = waitForAutosave(page)
    await popover.getByRole('button', { name: 'G major' }).click()
    await patch
    await expect(popover).toHaveCount(0)

    // Reopen: the chosen key is marked selected.
    await page.getByRole('button', { name: /^Key signature:/ }).click()
    await expect(page.getByRole('button', { name: 'G major' })).toHaveAttribute('aria-pressed', 'true')
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

    const bpm = popover.getByRole('spinbutton', { name: 'BPM' })
    await bpm.fill('90')
    const patch = waitForAutosave(page)
    await popover.getByRole('button', { name: 'Set' }).click()
    await patch
    await expect(popover).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Tempo: 90 bpm' })).toBeVisible()
})

test('the transpose popover moves the whole score up two semitones', async ({ page }) => {
    await page.getByRole('button', { name: 'Transpose' }).click()
    const popover = page.getByRole('dialog', { name: 'Transpose' })
    await expect(popover).toBeVisible()

    // While the popover is open, its target range pulses magenta on the canvas.
    await expect(page.locator('[data-score-highlight="pulse"]')).toBeVisible()

    // Apply stays disabled until an actual interval is dialed in.
    const apply = popover.getByRole('button', { name: 'Apply' })
    await expect(apply).toBeDisabled()

    await popover.getByRole('button', { name: 'Increase semitones' }).click()
    await popover.getByRole('button', { name: 'Increase semitones' }).click()
    await expect(apply).toBeEnabled()

    const patch = waitForAutosave(page)
    await apply.click()
    // The pulse hands over to a brief flash over the transposed range.
    await expect(page.locator('[data-score-highlight="flash"]')).toBeVisible()
    await patch
    await expect(popover).toHaveCount(0)
    // C major up a major second lands in D major: the dock's key control follows.
    await expect(page.getByRole('button', { name: 'Key signature: 2♯' })).toBeVisible()
    // The flash is transient: it clears on its own.
    await expect(page.locator('[data-score-highlight]')).toHaveCount(0)
})

test('the transpose popover expands to advanced options and transposes to a target key', async ({ page }) => {
    await page.getByRole('button', { name: 'Transpose' }).click()
    const popover = page.getByRole('dialog', { name: 'Transpose' })
    await popover.getByRole('button', { name: 'Advanced options' }).click()

    const tabs = popover.getByRole('group', { name: 'Transpose by' })
    await expect(tabs).toBeVisible()
    await tabs.getByRole('button', { name: 'Key' }).click()
    await popover.getByRole('button', { name: 'E♭ major' }).click()

    const patch = waitForAutosave(page)
    await popover.getByRole('button', { name: 'Apply' }).click()
    await patch
    await expect(popover).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Key signature: 3♭' })).toBeVisible()
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
    await expect(menu.getByRole('button', { name: 'MusicXML' })).toBeFocused()

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

    // Update is disabled until a different instrument is picked.
    const update = dialog.getByRole('button', { name: 'Update' })
    await expect(update).toBeDisabled()

    await dialog.getByPlaceholder('Filter instruments…').fill('violin')
    await dialog.getByRole('button', { name: 'Pick Violin', exact: true }).click()
    await expect(update).toBeEnabled()

    const patch = waitForAutosave(page)
    await update.click()
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

    // Remove the "Toggle rest" binding entirely.
    await dialog.getByRole('button', { name: 'Remove shortcut for Toggle rest' }).click()
    await expect(dialog.getByRole('button', { name: 'Restore defaults' })).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()

    // R is now unbound: pressing it must not toggle the rest.
    const restToggle = page.getByRole('button', { name: 'Rest', exact: true })
    await page.locator('div[tabindex="0"]').first().focus()
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

test('the in-score plus and minus targets add and remove a measure', async ({ page }) => {
    const svg = page.locator('.max-w-240 svg').first()
    await expect(svg).toBeVisible()

    // The fixture score has one measure, so "-" starts disabled (opacity 0.3).
    const plus = svg.locator('g[data-export-exclude]').filter({ hasText: '+' })
    const minus = svg.locator('g[data-export-exclude]').filter({ hasText: '-' })
    await expect(plus).toHaveCount(1)

    const noteheadsBefore = await svg.locator('path').count()
    const patchAdd = waitForAutosave(page)
    await plus.click()
    await patchAdd
    // A new measure appends rests: the engraving gains glyphs.
    await expect(async () => {
        expect(await svg.locator('path').count()).toBeGreaterThan(noteheadsBefore)
    }).toPass({ timeout: 5000 })

    const patchRemove = waitForAutosave(page)
    await minus.click()
    await patchRemove
    await expect(async () => {
        expect(await svg.locator('path').count()).toBe(noteheadsBefore)
    }).toPass({ timeout: 5000 })
})

test('transport: stop is disabled at rest and play is disabled while nothing can sound', async ({ page }) => {
    // Idle: nothing is playing or recording, so Stop has nothing to stop.
    await expect(page.getByRole('button', { name: 'Stop' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled()
})
