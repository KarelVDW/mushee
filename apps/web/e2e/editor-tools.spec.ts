import { expect, MOCK_SCORE_ID, test } from './fixtures'

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

    await expect
        .poll(() => apiMock.patches.some((b) => b.title === 'Renamed by e2e'), { timeout: 8000 })
        .toBe(true)
})

test('dotted, triplet, and tie dock toggles edit the selected note', async ({ page }) => {
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

    const tie = page.getByRole('button', { name: 'Tie', exact: true })
    await tie.click()
    await expect(tie).toHaveAttribute('aria-pressed', 'true')
    await tie.click()
    await expect(tie).toHaveAttribute('aria-pressed', 'false')
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

    expect(apiMock.patches.length).toBe(before)
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
