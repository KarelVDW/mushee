import { expect, MOCK_SCORE_ID, MOCK_TITLE, test } from './fixtures'

/**
 * Mobile editor e2e (mocked API), run by the `mobile-chromium` project at a
 * phone viewport with touch enabled. Guards the phone-specific chrome: the
 * transport lives in the bottom dock (record biggest of the set), the note
 * navigator/pitch nudges replace the keyboard, tap-to-select works on the
 * reflowed score, and nothing overflows the viewport horizontally.
 */

test.beforeEach(async ({ page, apiMock }) => {
    void apiMock
    await page.goto(`/scores/${MOCK_SCORE_ID}`)
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
})

test('mobile chrome: transport in the dock, record button dominant, no overflow', async ({ page }) => {
    await expect(page.locator('header input')).toHaveValue(MOCK_TITLE)

    // Transport sits inside the dock's action row, not the header.
    const actionRow = page.getByRole('group', { name: 'Note navigation and transport' })
    await expect(actionRow).toBeVisible()
    const record = actionRow.getByRole('button', { name: 'Record' })
    await expect(record).toBeVisible()

    // The record button is the largest control in the action row.
    const recordBox = await record.boundingBox()
    const playBox = await actionRow.getByRole('button', { name: 'Play' }).boundingBox()
    expect(recordBox?.width ?? 0).toBeGreaterThan(playBox?.width ?? Infinity)

    // The keyboard-shortcuts entry point is desktop-only.
    await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveCount(0)

    // Nothing overflows the layout viewport horizontally.
    const overflow = await page.evaluate(
        () => (document.scrollingElement?.scrollWidth ?? 0) - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
})

test('the score reflows to the phone instead of scaling down', async ({ page }) => {
    const svg = page.locator('.max-w-240 svg').first()
    await expect(svg).toBeVisible()
    // The layout width tracks the container (well under the desktop 1000 units),
    // so glyphs render at full size on a narrow screen.
    const viewBox = (await svg.getAttribute('viewBox')) ?? ''
    const layoutWidth = Number(viewBox.split(' ')[2])
    expect(layoutWidth).toBeLessThan(600)
    expect(layoutWidth).toBeGreaterThanOrEqual(340)
})

test('note navigator and pitch nudges edit the score and autosave', async ({ page }) => {
    // Move the selection right, then nudge the pitch up — both via the dock.
    await page.getByRole('button', { name: 'Select next note' }).tap()

    const patch = page.waitForRequest((r) => r.method() === 'PATCH' && new RegExp(`/scores/${MOCK_SCORE_ID}$`).test(r.url()), {
        timeout: 8000,
    })
    await page.getByRole('button', { name: 'Raise pitch' }).tap()
    const body = (await patch).postDataJSON() as Record<string, unknown>
    expect(body.measures ?? body.allMeasures).toBeTruthy()
})

test('tapping a note on the staff moves the selection', async ({ page }) => {
    const svg = page.locator('.max-w-240 svg').first()
    await expect(svg).toBeVisible()
    // The first note is auto-selected on load; its highlight band is already painted.
    const band = svg.locator('rect[fill="rgba(30, 144, 255, 0.14)"]').first()
    await expect(band).toBeVisible()
    const before = await band.boundingBox()
    expect(before).not.toBeNull()

    // Tap a later note inside the first staff row (headroom is 40 layout units ≈ scale 1).
    const box = await svg.boundingBox()
    expect(box).not.toBeNull()
    await page.touchscreen.tap((box?.x ?? 0) + (box?.width ?? 0) * 0.7, (box?.y ?? 0) + 65)

    await expect(async () => {
        const after = await svg.locator('rect[fill="rgba(30, 144, 255, 0.14)"]').first().boundingBox()
        expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeGreaterThan(10)
    }).toPass({ timeout: 5000 })
})

test('dock popovers open as sheets that stay on screen', async ({ page }) => {
    const clef = page.getByRole('button', { name: /^Clef:/ })
    await clef.tap()
    const dialog = page.getByRole('dialog', { name: 'Select clef' })
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    const viewport = page.viewportSize()
    expect(box).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual((viewport?.width ?? 0) + 1)
})
