import { expect, MOCK_SCORE_ID, test } from './fixtures'

/**
 * Mocked-API keyboard e2e: every default editor keybinding from
 * `src/app/scores/[id]/commands.ts` that isn't already covered by
 * editor.spec.ts (pitch arrows, shift+arrows, Escape collapse, copy/paste).
 * The dock's ChipToggles mirror the selected note's state, so they double as
 * the oracle for the toggle commands.
 */

const SELECTION_BANDS = 'svg rect[fill="rgba(30, 144, 255, 0.14)"]'

test.beforeEach(async ({ page, apiMock }) => {
    void apiMock
    await page.goto(`/scores/${MOCK_SCORE_ID}`)
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
    await page.locator('div[tabindex="0"]').first().focus()
})

function waitForAutosave(page: import('@playwright/test').Page) {
    return page.waitForRequest((r) => r.method() === 'PATCH' && new RegExp(`/scores/${MOCK_SCORE_ID}$`).test(r.url()), {
        timeout: 8000,
    })
}

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

test('T toggles a tie on the selected note', async ({ page }) => {
    const tieToggle = page.getByRole('button', { name: 'Tie', exact: true })
    await expect(tieToggle).toHaveAttribute('aria-pressed', 'false')

    const patch = waitForAutosave(page)
    await page.keyboard.press('t')
    await patch
    await expect(tieToggle).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('t')
    await expect(tieToggle).toHaveAttribute('aria-pressed', 'false')
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
    const tripletToggle = page.getByRole('button', { name: 'Triplet' })
    await expect(tripletToggle).toBeEnabled()
    await expect(tripletToggle).toHaveAttribute('aria-pressed', 'false')

    const patch = waitForAutosave(page)
    await page.keyboard.press('3')
    await patch
    await expect(tripletToggle).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('3')
    await expect(tripletToggle).toHaveAttribute('aria-pressed', 'false')
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
