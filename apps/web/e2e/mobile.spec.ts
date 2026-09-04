import type { Page } from '@playwright/test'

import { expect, MOCK_SCORE_ID, MOCK_TITLE, test } from './fixtures'

/**
 * Mobile editor e2e (mocked API), run by the `mobile-chromium` project at a
 * phone viewport with touch enabled. Guards the phone-specific chrome: the
 * transport lives in the bottom dock (record biggest of the set), the note
 * navigator/pitch nudges replace the keyboard, tap-to-select works on the
 * reflowed score, the selection popover opens on the menu gestures
 * (long-press / double-tap / drag-release), and nothing overflows the
 * viewport horizontally.
 */

// --- Touch gestures Playwright's touchscreen API doesn't cover, driven through CDP ---

/** Press and hold past the 500ms long-press threshold, then lift. */
async function longPress(page: Page, x: number, y: number): Promise<void> {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await page.waitForTimeout(650)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
}

/** Two immediate taps on the same point — well inside the 300ms double-tap window. */
async function doubleTap(page: Page, x: number, y: number): Promise<void> {
    const cdp = await page.context().newCDPSession(page)
    for (let i = 0; i < 2; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    await cdp.detach()
}

/**
 * A horizontal finger drag (touch-action pan-y leaves it to the app: it range-selects).
 * The finger comes to rest on the target before lifting, as a real one does. Lifting
 * mid-motion makes Chromium read the gesture as a fling, and it then swallows the click of
 * a tap that follows within a few dozen ms — which is exactly when the test taps the
 * selection bar. That dropped "Select all" on CI's fast Linux runner while passing locally.
 */
async function touchDrag(page: Page, fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y: fromY }] })
    const steps = 10
    for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: fromX + ((toX - fromX) * i) / steps, y: fromY + ((toY - fromY) * i) / steps }],
        })
    }
    await page.waitForTimeout(150)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
}

const SELECTION_BANDS = 'rect[fill="rgba(30, 144, 255, 0.14)"]'

/** Center of the active selection band — the selected note, a reliable touch target. */
async function selectedNoteCenter(page: Page): Promise<{ x: number; y: number }> {
    const band = page.locator(`.max-w-240 svg ${SELECTION_BANDS}`).first()
    await expect(band).toBeVisible()
    const box = await band.boundingBox()
    if (!box) throw new Error('expected a selection band')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

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
    const overflow = await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
})

test('pitch actions live in the dock and the transpose sheet spans it', async ({ page }) => {
    // Minimize-accidentals and transpose join the dock's settings well on phones.
    const settings = page.getByRole('group', { name: 'Score settings' })
    await expect(settings.getByRole('button', { name: 'Minimize accidentals' })).toBeVisible()

    const trigger = settings.getByRole('button', { name: 'Transpose' })
    await trigger.tap()
    const sheet = page.getByRole('dialog', { name: 'Transpose' })
    await expect(sheet).toBeVisible()

    // The sheet spans the dock's width instead of anchoring to the chip.
    const sheetBox = await sheet.boundingBox()
    const viewport = page.viewportSize()
    expect(sheetBox?.width ?? 0).toBeGreaterThan((viewport?.width ?? 0) * 0.9)

    await trigger.tap() // the chip toggles its own sheet closed
    await expect(sheet).toHaveCount(0)
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

test('long-press opens the selection popover; Delete clears the note and autosaves', async ({ page }) => {
    // The dedicated dock delete button is gone: selection-scoped actions live in the popover.
    await expect(page.getByRole('button', { name: 'Remove note' })).toHaveCount(0)

    const { x, y } = await selectedNoteCenter(page)
    await longPress(page, x, y)
    const toolbar = page.getByRole('toolbar', { name: 'Selection actions' })
    await expect(toolbar).toBeVisible()
    // Nothing on the clipboard yet — Paste is hidden, like the OS text-selection menu.
    await expect(toolbar.getByRole('button', { name: 'Paste' })).toHaveCount(0)

    const patch = page.waitForRequest((r) => r.method() === 'PATCH' && new RegExp(`/scores/${MOCK_SCORE_ID}$`).test(r.url()), {
        timeout: 8000,
    })
    await toolbar.getByRole('button', { name: 'Delete' }).tap()
    const body = (await patch).postDataJSON() as Record<string, unknown>
    expect(body.measures ?? body.allMeasures).toBeTruthy()
    await expect(toolbar).toHaveCount(0)
})

test('double-tapping a note opens the selection popover on it', async ({ page }) => {
    const svg = page.locator('.max-w-240 svg').first()
    await expect(svg).toBeVisible()
    const box = await svg.boundingBox()
    expect(box).not.toBeNull()
    // A later note inside the first staff row (same target as the tap-to-select test).
    await doubleTap(page, (box?.x ?? 0) + (box?.width ?? 0) * 0.7, (box?.y ?? 0) + 65)
    await expect(page.getByRole('toolbar', { name: 'Selection actions' })).toBeVisible()
})

test('copy on one note, paste on another — via the selection popover', async ({ page }) => {
    const toolbar = page.getByRole('toolbar', { name: 'Selection actions' })

    // Copy the auto-selected first note.
    const first = await selectedNoteCenter(page)
    await longPress(page, first.x, first.y)
    await expect(toolbar).toBeVisible()
    await toolbar.getByRole('button', { name: 'Copy' }).tap()
    await expect(toolbar).toHaveCount(0)

    // Long-press a later note: it becomes the selection and the popover now offers Paste.
    const svg = page.locator('.max-w-240 svg').first()
    const box = await svg.boundingBox()
    expect(box).not.toBeNull()
    await longPress(page, (box?.x ?? 0) + (box?.width ?? 0) * 0.7, (box?.y ?? 0) + 65)
    await expect(toolbar).toBeVisible()

    const patch = page.waitForRequest((r) => r.method() === 'PATCH' && new RegExp(`/scores/${MOCK_SCORE_ID}$`).test(r.url()), {
        timeout: 8000,
    })
    await toolbar.getByRole('button', { name: 'Paste' }).tap()
    const body = (await patch).postDataJSON() as Record<string, unknown>
    expect(body.measures ?? body.allMeasures).toBeTruthy()
    await expect(toolbar).toHaveCount(0)
})

test('a range drag surfaces the popover; Select all grows the selection to the whole score', async ({ page }) => {
    const bands = page.locator(`.max-w-240 svg ${SELECTION_BANDS}`)
    await expect(bands).toHaveCount(1)

    // Drag rightward from the selected first note across its neighbours.
    const { x, y } = await selectedNoteCenter(page)
    await touchDrag(page, x, y, x + 160, y)

    const toolbar = page.getByRole('toolbar', { name: 'Selection actions' })
    await expect(toolbar).toBeVisible()
    expect(await bands.count()).toBeGreaterThanOrEqual(2)

    // Select all spans every note (the fixture holds 8) and keeps the popover open.
    await toolbar.getByRole('button', { name: 'Select all' }).tap()
    await expect(bands).toHaveCount(8)
    await expect(toolbar).toBeVisible()

    // The bar tracks the selection: it hovers above the topmost selected row, centered
    // on that row's selected span (the bands sharing the topmost row's y).
    const toolbarBox = await toolbar.boundingBox()
    expect(toolbarBox).not.toBeNull()
    const boxes = await bands.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))
    const rowY = Math.min(...boxes.map((b) => b.y))
    const rowBands = boxes.filter((b) => Math.abs(b.y - rowY) < 2)
    expect((toolbarBox?.y ?? 0) + (toolbarBox?.height ?? 0)).toBeLessThanOrEqual(rowY + 1)
    const spanCenter = (Math.min(...rowBands.map((b) => b.x)) + Math.max(...rowBands.map((b) => b.x + b.width))) / 2
    const toolbarCenter = (toolbarBox?.x ?? 0) + (toolbarBox?.width ?? 0) / 2
    expect(Math.abs(toolbarCenter - spanCenter)).toBeLessThanOrEqual(30)
})

test('tapping elsewhere dismisses the selection popover', async ({ page }) => {
    const { x, y } = await selectedNoteCenter(page)
    await longPress(page, x, y)
    const toolbar = page.getByRole('toolbar', { name: 'Selection actions' })
    await expect(toolbar).toBeVisible()

    const svg = page.locator('.max-w-240 svg').first()
    const box = await svg.boundingBox()
    expect(box).not.toBeNull()
    await page.touchscreen.tap((box?.x ?? 0) + (box?.width ?? 0) * 0.7, (box?.y ?? 0) + 65)
    await expect(toolbar).toHaveCount(0)
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
