import type { Locator, Page } from '@playwright/test'

import { expect, focusEditor, MOCK_SCORE_ID, SELECTION_BANDS, test, waitForAutosave } from './fixtures'
import { mockRecording } from './recording'

/**
 * Mocked-API keyboard e2e: every default editor keybinding from
 * `src/app/scores/[id]/commands.ts` that isn't already covered by
 * editor.spec.ts (pitch arrows, shift+arrows, Escape collapse, copy/paste).
 * The dock's ChipToggles mirror the selected note's state, so they double as
 * the oracle for the toggle commands.
 */

test.beforeEach(async ({ page, apiMock }) => {
    void apiMock
    await page.goto(`/scores/${MOCK_SCORE_ID}`)
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
    await focusEditor(page)
})

test('ArrowRight and ArrowLeft move the selection between notes', async ({ page }) => {
    const band = page.locator(SELECTION_BANDS).first()
    await expect(band).toBeVisible()
    const start = await band.boundingBox()

    await page.keyboard.press('ArrowRight')
    await expect(async () => {
        const after = await page.locator(SELECTION_BANDS).first().boundingBox()
        expect((after?.x ?? 0) - (start?.x ?? 0)).toBeGreaterThan(5)
    }).toPass({ timeout: 5000 })

    await page.keyboard.press('ArrowLeft')
    await expect(async () => {
        const back = await page.locator(SELECTION_BANDS).first().boundingBox()
        expect(Math.abs((back?.x ?? 0) - (start?.x ?? 0))).toBeLessThan(2)
    }).toPass({ timeout: 5000 })
})

test('R toggles the selected note to a rest and back', async ({ page }) => {
    const restToggle = page.getByRole('button', { name: 'Rest', exact: true })
    await expect(restToggle).toHaveAttribute('aria-pressed', 'false')

    const patch = waitForAutosave(page)
    await page.keyboard.press('r')
    await patch
    await expect(restToggle).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('r')
    await expect(restToggle).toHaveAttribute('aria-pressed', 'false')
})

/**
 * Peek at a tool in the dock's More popover: open it, run the checks against the named row,
 * close it again — an open popover keeps keys from the editor, so the keyboard acts between peeks.
 */
async function inMore(page: Page, name: string, check: (tool: Locator) => Promise<void>): Promise<void> {
    await page.getByRole('button', { name: 'More note tools' }).click()
    const panel = page.getByRole('dialog', { name: 'More note tools' })
    await check(panel.getByRole('button', { name, exact: true }))
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
}

test('T toggles a tie on the selected note', async ({ page }) => {
    // A tie binds only into the same pitch: C5 → D5 can't tie, so lower D5 onto C5 and step back.
    await inMore(page, 'Tie', (tie) => expect(tie).toBeDisabled())
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowLeft')
    await inMore(page, 'Tie', async (tie) => {
        await expect(tie).toBeEnabled()
        await expect(tie).toHaveAttribute('aria-pressed', 'false')
    })

    const patch = waitForAutosave(page)
    await page.keyboard.press('t')
    await patch
    await inMore(page, 'Tie', (tie) => expect(tie).toHaveAttribute('aria-pressed', 'true'))

    await page.keyboard.press('t')
    await inMore(page, 'Tie', (tie) => expect(tie).toHaveAttribute('aria-pressed', 'false'))
})

test('Period toggles the dot on the selected note', async ({ page }) => {
    const dotToggle = page.getByRole('button', { name: 'Dotted' })
    await expect(dotToggle).toHaveAttribute('aria-pressed', 'false')

    const patch = waitForAutosave(page)
    await page.keyboard.press('.')
    await patch
    await expect(dotToggle).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('.')
    await expect(dotToggle).toHaveAttribute('aria-pressed', 'false')
})

test('3 toggles a triplet on the selected note', async ({ page }) => {
    await inMore(page, 'Triplet', async (triplet) => {
        await expect(triplet).toBeEnabled()
        await expect(triplet).toHaveAttribute('aria-pressed', 'false')
    })

    const patch = waitForAutosave(page)
    await page.keyboard.press('3')
    await patch
    await inMore(page, 'Triplet', (triplet) => expect(triplet).toHaveAttribute('aria-pressed', 'true'))

    await page.keyboard.press('3')
    await inMore(page, 'Triplet', (triplet) => expect(triplet).toHaveAttribute('aria-pressed', 'false'))
})

test('length keys decline on a run of notes instead of changing one of them', async ({ page, apiMock }) => {
    await page.keyboard.press('Shift+ArrowRight')
    const before = apiMock.patches.length
    await page.keyboard.press('h')
    await page.keyboard.press('.')
    await expect(page.getByRole('button', { name: 'Half note' })).toHaveAttribute('aria-pressed', 'false')
    // Both notes are still quarters: the run shows its shared length.
    await expect(page.getByRole('button', { name: 'Quarter note' })).toHaveAttribute('aria-pressed', 'true')
    expect(apiMock.patches.length).toBe(before)
})

test('Backspace clears the selected pitch and autosaves', async ({ page }) => {
    const patch = waitForAutosave(page)
    await page.keyboard.press('Backspace')
    const body = (await patch).postDataJSON() as Record<string, unknown>
    expect(body.measures ?? body.allMeasures).toBeTruthy()

    // Clearing the pitch leaves a rest at the note's position.
    await expect(page.getByRole('button', { name: 'Rest', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('editor shortcuts stay dead while a dialog is open', async ({ page }) => {
    const restToggle = page.getByRole('button', { name: 'Rest', exact: true })
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()

    // R must not reach the score while the dialog is up.
    await page.keyboard.press('r')
    await expect(restToggle).toHaveAttribute('aria-pressed', 'false')

    // Close the dialog; the editor regains focus and the key works again.
    await page.getByRole('button', { name: 'Done' }).click()
    await page.keyboard.press('r')
    await expect(restToggle).toHaveAttribute('aria-pressed', 'true')
})

test('M minimizes accidentals (respell + re-key across the whole score)', async ({ page }) => {
    // Sharpen every note first: C♯5 D♯5 E♯5 F♯5 — a set that reads cleanest as D♭ major
    // (5♭, spelled D♭ E♭ F G♭), one flat lighter than the F♯-major spelling.
    await page.keyboard.press('ControlOrMeta+a')
    const sharpen = waitForAutosave(page)
    await page.getByRole('group', { name: 'Sharp or flat' }).getByRole('button', { name: 'Sharp' }).click()
    await sharpen

    // Collapse back to a single note: the shortcut then acts on the whole score.
    await page.keyboard.press('Escape')
    const patch = waitForAutosave(page)
    await page.keyboard.press('m')
    await patch
    await expect(page.getByRole('button', { name: 'Key: D♭ major' })).toBeVisible()
})

test('Space plays and pauses the score; on a focused button it presses that button instead', async ({ page }) => {
    await page.keyboard.press('Space')
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
    await page.keyboard.press('Space')
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()

    // A focused control keeps the key: Space on the metronome toggles it, and nothing plays.
    const metronome = page.getByRole('button', { name: 'Metronome' })
    await metronome.focus()
    await page.keyboard.press('Space')
    await expect(metronome).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
})

test('Shift+R starts a take and Space stops it; Escape stops one too', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'the synthetic microphone needs Chromium’s MediaRecorder')
    await mockRecording(page)
    const strip = page.getByRole('group', { name: 'Recording status' })

    await page.keyboard.press('Shift+R')
    await expect(strip).toBeVisible()
    await page.keyboard.press('Space')
    await expect(strip).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible()

    await focusEditor(page)
    await page.keyboard.press('Shift+R')
    await expect(strip).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(strip).toHaveCount(0)
})

test('Shift+R from a focused dock tool keeps the keys on the editor: Space still stops the take', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'the synthetic microphone needs Chromium’s MediaRecorder')
    await mockRecording(page)
    const strip = page.getByRole('group', { name: 'Recording status' })

    // The focused tool goes with the dock's tool rows; focus lands on the editor, not <body>.
    await page.getByRole('button', { name: 'Rest', exact: true }).focus()
    await page.keyboard.press('Shift+R')
    await expect(strip).toBeVisible()
    await expect(page.getByRole('group', { name: 'Note tools' })).toHaveCount(0)
    await expect(page.locator('div[tabindex="0"]').first()).toBeFocused()
    await page.keyboard.press('Space')
    await expect(strip).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible()
})

test('the shortcuts dialog opens with the Playback group', async ({ page }) => {
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(dialog.getByText('Playback', { exact: true })).toBeVisible()
    for (const label of ['Play or pause (also stops a recording)', 'Stop recording']) {
        await expect(dialog.getByText(label, { exact: true })).toBeVisible()
        // Fixed: listed as a plain fact, never rebindable.
        await expect(dialog.getByRole('button', { name: `Change shortcut for ${label}` })).toHaveCount(0)
    }
    await expect(dialog.getByRole('button', { name: 'Change shortcut for Record or stop recording' })).toContainText('R')
    await expect(dialog.getByRole('button', { name: 'Change shortcut for Play from the start' })).toContainText('Space')
})

test('? opens the shortcuts list, which lists ? itself; closing it hands the keys back to the score', async ({ page }) => {
    await page.keyboard.press('?')
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Help', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Show keyboard shortcuts', { exact: true })).toBeVisible()
    // Fixed: a plain '?' keycap, never rebindable.
    await expect(dialog.getByRole('button', { name: 'Change shortcut for Show keyboard shortcuts' })).toHaveCount(0)
    await expect(dialog.locator('kbd', { hasText: /^\?$/ })).toHaveCount(1)

    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toHaveCount(0)
    const restToggle = page.getByRole('button', { name: 'Rest', exact: true })
    await page.keyboard.press('r')
    await expect(restToggle).toHaveAttribute('aria-pressed', 'true')
})

test('Shift+T opens the transpose popover; Escape closes it without touching the score', async ({ page, apiMock }) => {
    const before = apiMock.patches.length
    await page.keyboard.press('Shift+T')
    await expect(page.getByRole('dialog', { name: 'Transpose' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Transpose' })).toHaveCount(0)
    expect(apiMock.patches.length).toBe(before)
})
