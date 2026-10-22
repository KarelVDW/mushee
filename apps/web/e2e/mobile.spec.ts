import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Locator, Page } from '@playwright/test'

import { denyMicrophone, expect, MOCK_SCORE_ID, MOCK_SHARE_TOKEN, MOCK_TITLE, SELECTION_BANDS, test, waitForAutosave } from './fixtures'
import { mockRecording } from './recording'

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
    const record = actionRow.getByRole('button', { name: 'Record', exact: true })
    await expect(record).toBeVisible()

    // The record button is the largest control in the action row; every other one meets the 40px floor.
    const recordBox = await record.boundingBox()
    const playBox = await actionRow.getByRole('button', { name: 'Play' }).boundingBox()
    expect(recordBox?.width ?? 0).toBeGreaterThan(playBox?.width ?? Infinity)
    for (const name of ['Select previous note', 'Select next note', 'Lower', 'Higher']) {
        const box = await actionRow.getByRole('button', { name, exact: true }).boundingBox()
        expect(box?.width ?? 0, name).toBeGreaterThanOrEqual(40)
        expect(box?.width ?? Infinity, name).toBeLessThan(recordBox?.width ?? 0)
    }
    // The two pairs sit in their own wells, each captioned under it.
    await expect(actionRow.getByRole('group', { name: 'Note', exact: true }).getByRole('button')).toHaveCount(2)
    await expect(actionRow.getByRole('group', { name: 'Pitch', exact: true }).getByRole('button')).toHaveCount(2)
    await expect(actionRow).toContainText('Note')
    await expect(actionRow).toContainText('Pitch')

    // The keyboard-shortcuts entry point is desktop-only.
    await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveCount(0)

    // Nothing overflows the layout viewport horizontally.
    const overflow = await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
})

test('a blocked microphone explains the fix, Record stays live, and the selection comes back', async ({ page }) => {
    // Refuse the microphone: the take clears the selection as it starts, then fails to open
    // the mic — and puts the note it started from back.
    await denyMicrophone(page)
    const before = await selectedNoteCenter(page)
    const record = page.getByRole('group', { name: 'Note navigation and transport' }).getByRole('button', { name: 'Record', exact: true })
    await expect(record).toBeEnabled()
    await record.tap()
    const dialog = page.getByRole('dialog', { name: "Solkey can't hear you yet" })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Not now' }).tap()
    await expect(dialog).toHaveCount(0)

    // Never a dead Record, and the phone's nudges work at once on the same note.
    await expect(record).toBeEnabled()
    expect(await selectedNoteCenter(page)).toEqual(before)
    await expect(page.getByRole('button', { name: 'Higher', exact: true })).toBeEnabled()
})

test('a take folds the dock into the recording strip beside record-as-stop; toasts stay above the dock', async ({ page }) => {
    await mockRecording(page)
    await page.getByRole('group', { name: 'Note navigation and transport' }).getByRole('button', { name: 'Record', exact: true }).tap()

    const strip = page.getByRole('group', { name: 'Recording status' })
    await expect(strip).toContainText('Get ready')
    // The tool rows, the navigator and the separate Stop give way to the strip and the one stop control.
    await expect(page.getByRole('group', { name: 'Note tools' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Select previous note' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    // Focus follows the record button into the strip — it never drops to the page.
    const stop = page.getByRole('button', { name: 'Stop recording', exact: true })
    await expect(stop).toBeFocused()
    await expect(strip).toContainText('Recording', { timeout: 6000 })
    await expect(strip).toContainText('Tap')
    await stop.tap()
    // …and back onto the footer's Record once the strip folds away.
    await expect(
        page.getByRole('group', { name: 'Note navigation and transport' }).getByRole('button', { name: 'Record', exact: true }),
    ).toBeFocused()

    const summary = page.getByRole('status').filter({ hasText: /Added bars? 1(–2)?\. Tap any note to fix it\./ })
    await expect(summary).toBeVisible()
    // The dock is back, with a note selected so the nudges and Record work at once.
    const tools = page.getByRole('group', { name: 'Note tools' })
    await expect(tools).toBeVisible()
    await expect(page.getByRole('button', { name: 'Higher', exact: true })).toBeEnabled()
    // No toast covers the dock: the stack sits above its top edge.
    await expect(async () => {
        const toast = await summary.boundingBox()
        const dock = await page.getByRole('group', { name: 'Note navigation and transport' }).boundingBox()
        expect((toast?.y ?? Infinity) + (toast?.height ?? 0)).toBeLessThanOrEqual(dock?.y ?? 0)
    }).toPass({ timeout: 5000 })
})

/** Serve the fixture as rests only: a score without a single pitched note, so the empty state shows. */
async function serveRestsOnly(page: Page): Promise<void> {
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
}

test('on the empty score the selected rest gets no move hint, and the Pitch nudges make it a note', async ({ page }) => {
    await serveRestsOnly(page)
    await page.reload()
    const heading = page.getByRole('heading', { name: 'Sing, hum or play your tune' })
    await expect(heading).toBeVisible()
    // One instruction on the first screen: the dock doesn't also talk about moving a note.
    await expect(page.getByText(/^To move a note/)).toHaveCount(0)
    // By hand on a phone means the Pitch nudges (a tap only selects), and the line says so.
    await expect(page.getByText('Or tap a beat, then use Pitch below to place notes by hand.')).toBeVisible()
    // Sharp or flat has nothing to act on, and says so inline.
    const sheet = await openMore(page)
    await expect(sheet.getByRole('group', { name: 'Sharp or flat' }).getByRole('button', { name: 'Sharp' })).toBeDisabled()
    await expect(sheet.getByText('Rests have no pitch — use Higher or Lower to make it a note.').first()).toBeVisible()
    await sheet.getByRole('button', { name: 'Close' }).tap()

    const patch = waitForAutosave(page)
    await page.getByRole('button', { name: 'Higher', exact: true }).tap()
    await patch
    await expect(heading).toHaveCount(0)
})

test('from onboarding, Start recording hands focus to the dock’s stop as the empty score goes', async ({ page }) => {
    await serveRestsOnly(page)
    await mockRecording(page)
    await page.goto(`/scores/${MOCK_SCORE_ID}?first=1`)
    const start = page.getByRole('button', { name: 'Start recording' })
    await expect(start).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('group', { name: 'Recording status' })).toBeVisible()
    await expect(start).toHaveCount(0)
    // Never dropped to <body>: the strip's stop takes it, and the editor's keys still reach the recording.
    await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeFocused()
    // Focus moved during keyboard use shows the stop's tooltip, and its first Escape closes only
    // that (the tooltip contract); the next one reaches the editor and stops the recording.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('group', { name: 'Recording status' })).toHaveCount(0)
})

/** Open the phone dock's More sheet: everything beyond Undo and the note lengths lives there. */
async function openMore(page: Page) {
    await page.getByRole('button', { name: 'More tools' }).tap()
    const sheet = page.getByRole('dialog', { name: 'More tools' })
    await expect(sheet).toBeVisible()
    return sheet
}

/** A sheet must sit between the header and the dock: never under the header, never over the tools. */
async function expectBetweenHeaderAndDock(page: Page, sheet: Locator): Promise<void> {
    const box = await sheet.boundingBox()
    const header = await page.locator('header').boundingBox()
    const tools = await page.getByRole('group', { name: 'Note tools' }).boundingBox()
    expect(box).not.toBeNull()
    expect(box?.y ?? -1).toBeGreaterThanOrEqual((header?.y ?? 0) + (header?.height ?? Infinity) - 1)
    expect((box?.y ?? 0) + (box?.height ?? Infinity)).toBeLessThanOrEqual((tools?.y ?? 0) + 1)
}

test('the phone dock is one tool row: Undo, the note lengths and More', async ({ page }) => {
    const tools = page.getByRole('group', { name: 'Note tools' })
    await expect(tools.getByRole('button', { name: 'Undo' })).toBeVisible()
    await expect(tools.getByRole('group', { name: 'Note duration' }).getByRole('button')).toHaveCount(5)
    await expect(tools.getByRole('button', { name: 'More tools' })).toContainText('More')
    // The rest moved into the sheet: no settings well, no history well, no modifier well.
    for (const group of ['Score settings', 'History', 'Note modifiers']) {
        await expect(page.getByRole('group', { name: group })).toHaveCount(0)
    }
    // One row: every tool shares the row's line (nothing wrapped onto a second row).
    const boxes = await tools.locator(':scope > *').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))
    const top = Math.min(...boxes.map((b) => b.y))
    for (const box of boxes) expect(box.y).toBeLessThan(top + 12)
})

test('pitch actions live in the More sheet and the transpose sheet swaps in with Back and Close', async ({ page }) => {
    const sheet = await openMore(page)
    await expect(sheet.getByRole('button', { name: 'Simplify sharps and flats' })).toBeVisible()
    await expectBetweenHeaderAndDock(page, sheet)

    await sheet.getByRole('button', { name: 'Transpose' }).tap()
    const transpose = page.getByRole('dialog', { name: 'Transpose' })
    await expect(transpose).toBeVisible()
    // Sheets never stack: the picker took the menu's place.
    await expect(page.getByRole('dialog', { name: 'More tools' })).toHaveCount(0)

    // The sheet spans the dock's width instead of anchoring to a chip.
    const sheetBox = await transpose.boundingBox()
    const viewport = page.viewportSize()
    expect(sheetBox?.width ?? 0).toBeGreaterThan((viewport?.width ?? 0) * 0.9)
    await expectBetweenHeaderAndDock(page, transpose)

    await transpose.getByRole('button', { name: 'Back' }).tap()
    await expect(page.getByRole('dialog', { name: 'More tools' })).toBeVisible()
    await page.getByRole('dialog', { name: 'More tools' }).getByRole('button', { name: 'Close' }).tap()
    await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the More sheet toggles note tools and the metronome', async ({ page }) => {
    const sheet = await openMore(page)
    const rest = sheet.getByRole('button', { name: 'Rest', exact: true })
    const patch = waitForAutosave(page)
    await rest.tap()
    await patch
    await expect(rest).toHaveAttribute('aria-pressed', 'true')

    const metronome = sheet.getByRole('switch', { name: 'Metronome' })
    await expect(metronome).toHaveAttribute('aria-checked', 'false')
    // Its hint is on screen and is the switch's description.
    await expect(sheet.getByText('A steady click while playing and recording.')).toBeVisible()
    await expect(metronome).toHaveAccessibleDescription('A steady click while playing and recording.')
    await metronome.tap()
    await expect(metronome).toHaveAttribute('aria-checked', 'true')
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

    const patch = waitForAutosave(page)
    await page.getByRole('button', { name: 'Higher', exact: true }).tap()
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

    const patch = waitForAutosave(page)
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

    const patch = waitForAutosave(page)
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
    const band = svg.locator(SELECTION_BANDS).first()
    await expect(band).toBeVisible()
    const before = await band.boundingBox()
    expect(before).not.toBeNull()

    // Tap a later note inside the first staff row (headroom is 40 layout units ≈ scale 1).
    const box = await svg.boundingBox()
    expect(box).not.toBeNull()
    await page.touchscreen.tap((box?.x ?? 0) + (box?.width ?? 0) * 0.7, (box?.y ?? 0) + 65)

    await expect(async () => {
        const after = await svg.locator(SELECTION_BANDS).first().boundingBox()
        expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeGreaterThan(10)
    }).toPass({ timeout: 5000 })
})

test('dock popovers open as sheets that stay on screen', async ({ page }) => {
    const sheet = await openMore(page)
    await sheet.getByRole('button', { name: /^Clef:/ }).tap()
    const dialog = page.getByRole('dialog', { name: 'Select clef' })
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    const viewport = page.viewportSize()
    expect(box).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual((viewport?.width ?? 0) + 1)
    await expectBetweenHeaderAndDock(page, dialog)

    // A pick applies, and the sheet closes after showing it.
    await dialog.getByRole('button', { name: 'Set Bass clef' }).tap()
    await expect(dialog).toHaveCount(0)
})

test('the key sheet reads flats → C → sharps in three rows, none wrapping a key onto a row of its own', async ({ page }) => {
    // The narrowest phone we design for: seven fixed 48px cells would wrap here.
    await page.setViewportSize({ width: 360, height: 780 })
    const sheet = await openMore(page)
    await sheet.getByRole('button', { name: /^Key:/ }).tap()
    const grid = page.getByRole('dialog', { name: 'Select key signature' }).getByRole('group', { name: 'Key signature' })
    const rowOf = async (names: string[]) =>
        new Set(
            await Promise.all(
                names.map(async (name) => Math.round((await grid.getByRole('button', { name, exact: true }).boundingBox())?.y ?? -1)),
            ),
        )
    const flats = await rowOf(['C♭ major', 'G♭ major', 'D♭ major', 'A♭ major', 'E♭ major', 'B♭ major', 'F major'])
    const sharps = await rowOf(['G major', 'D major', 'A major', 'E major', 'B major', 'F♯ major', 'C♯ major'])
    expect(flats.size).toBe(1)
    expect(sharps.size).toBe(1)
    // C sits alone in the middle, between the two.
    const c = await grid.getByRole('button', { name: 'C major', exact: true }).boundingBox()
    expect(c?.y ?? 0).toBeGreaterThan([...flats][0])
    expect(c?.y ?? Infinity).toBeLessThan([...sharps][0])
})

test('the first tap on a note teaches where its actions are, once', async ({ page }) => {
    const svg = page.locator('.max-w-240 svg').first()
    const box = await svg.boundingBox()
    expect(box).not.toBeNull()
    const tapAt = (fraction: number) => page.touchscreen.tap((box?.x ?? 0) + (box?.width ?? 0) * fraction, (box?.y ?? 0) + 65)
    const band = svg.locator(SELECTION_BANDS).first()
    const moveHint = page.getByText(/^To move a note/)
    await expect(moveHint).toBeVisible()

    await tapAt(0.7)
    const tip = page.getByRole('status').filter({ hasText: 'Tap the note again to copy or delete it.' })
    await expect(tip).toBeVisible()
    // One tip at a time: the dock's own hint steps aside while this one is up.
    await expect(moveHint).toHaveCount(0)

    // The next tap anywhere clears it, and the dock's hint comes back.
    const before = await band.boundingBox()
    await tapAt(0.3)
    await expect(tip).toHaveCount(0)
    await expect(moveHint).toBeVisible()
    // That tap picked another note — and taught once means it stays gone.
    await expect.poll(async () => (await band.boundingBox())?.x).not.toBe(before?.x)
    await expect(tip).toHaveCount(0)
})

// --- Header chips: share / takes / export collapse to icon-only on phones ---

/** The header's chip row must fit the phone viewport: no chip may poke past the right edge. */
async function expectHeaderFitsViewport(page: Page): Promise<void> {
    const header = page.locator('header')
    const headerBox = await header.boundingBox()
    const viewport = page.viewportSize()
    expect(headerBox).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect(headerBox?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect(headerBox?.width ?? Infinity).toBeLessThanOrEqual((viewport?.width ?? 0) + 1)
    // The chips themselves stay inside the header's box (a flex row that overflowed
    // would keep the header at viewport width while its children spill out).
    for (const name of ['Share score', 'Recordings', 'Export score']) {
        const box = await page.getByRole('button', { name, exact: true }).boundingBox()
        expect(box, name).not.toBeNull()
        expect((box?.x ?? 0) + (box?.width ?? Infinity), name).toBeLessThanOrEqual((headerBox?.x ?? 0) + (headerBox?.width ?? 0) + 1)
    }
    const overflow = await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
}

test('header chips are icon-only on phones and the header fits the viewport', async ({ page }) => {
    for (const name of ['Share score', 'Recordings', 'Export score']) {
        const chip = page.getByRole('button', { name, exact: true })
        await expect(chip).toBeVisible()
        // The visible label is dropped in compact mode; the accessible name carries it.
        await expect(chip).toHaveText('')
    }
    await expectHeaderFitsViewport(page)
})

test('share chip: create and copy the read-only link, and turn it off after a confirm, from the phone header', async ({
    page,
    context,
    apiMock,
}) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('button', { name: 'Share score', exact: true }).tap()
    const panel = page.getByRole('dialog', { name: 'Share score' })
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: 'Create link and copy' }).tap()

    const link = panel.getByRole('textbox', { name: 'Share link' })
    await expect(link).toHaveValue(new RegExp(`/s/${MOCK_SHARE_TOKEN}$`))
    expect(apiMock.shareToken).toBe(MOCK_SHARE_TOKEN)
    await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible()

    await panel.getByRole('button', { name: 'Turn off link' }).tap()
    await panel.getByRole('button', { name: 'Turn off', exact: true }).tap()
    await expect(panel.getByRole('button', { name: 'Create link and copy' })).toBeVisible()
    expect(apiMock.shareToken).toBeNull()

    // The panel stays on screen, and the header did not grow to fit it.
    await expectInsideGutter(page, panel)
    await expectHeaderFitsViewport(page)
})

/**
 * A header panel stays 16px inside both viewport edges, whichever chip it hangs from. (A clamp
 * applied twice shows only under the dev server's StrictMode — a prod build mounts once.)
 */
async function expectInsideGutter(page: Page, panel: Locator): Promise<void> {
    const box = await panel.boundingBox()
    const width = page.viewportSize()?.width ?? 0
    expect(box).not.toBeNull()
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(16 - 1)
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(width - 16 + 1)
}

test('editing the title takes the header row up to a Done button; Done hands back the chips', async ({ page }) => {
    const title = page.getByRole('textbox', { name: 'Score title' })
    const instrument = page.getByRole('button', { name: /^Change instrument/ })
    // Every header target meets the 40px floor.
    for (const control of [page.getByRole('button', { name: 'Back to library' }), instrument]) {
        expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40)
    }
    const restWidth = (await title.boundingBox())?.width ?? 0

    await title.tap()
    const done = page.getByRole('button', { name: 'Done', exact: true })
    await expect(done).toBeVisible()
    expect((await done.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40)
    expect((await title.boundingBox())?.width ?? 0).toBeGreaterThan(restWidth + 100)
    // The chips step out of the way: the instrument chip's slot and the three header chips fade, out of reach.
    const faded = page.locator('header div[inert]')
    await expect(faded).toHaveCount(2)
    await expect(faded.filter({ has: instrument })).toHaveCSS('opacity', '0')
    await expect(faded.filter({ has: page.getByRole('button', { name: 'Share score', exact: true }) })).toHaveCSS('opacity', '0')

    await title.fill('A longer name for the tune')
    await done.tap()
    await expect(done).toHaveCount(0)
    await expect(title).toHaveValue('A longer name for the tune')
    await expect(faded).toHaveCount(0)
    await expect(page.locator('div[tabindex="0"]').first()).toBeFocused()
    await expectHeaderFitsViewport(page)
})

test('Add bar and Remove last bar are 40px touch targets that stay apart', async ({ page }) => {
    const add = page.getByRole('button', { name: 'Add bar' })
    const remove = page.getByRole('button', { name: 'Remove last bar' })
    const [addBox, removeBox] = await Promise.all([add.boundingBox(), remove.boundingBox()])
    expect(addBox?.height ?? 0).toBeGreaterThanOrEqual(40)
    expect(removeBox?.height ?? 0).toBeGreaterThanOrEqual(40)
    expect((removeBox?.x ?? 0) - ((addBox?.x ?? 0) + (addBox?.width ?? 0))).toBeGreaterThanOrEqual(16)
    const patch = waitForAutosave(page)
    await add.tap()
    await patch
})

test('recordings chip: lists the score’s recordings and deletes one after confirmation', async ({ page, apiMock }) => {
    await page.getByRole('button', { name: 'Recordings', exact: true }).tap()
    const panel = page.getByRole('dialog', { name: 'Recordings' })
    await expect(panel).toBeVisible()
    const rows = panel.getByRole('list', { name: 'Recordings' }).getByRole('listitem')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('0:42')
    await expect(rows.nth(1)).toContainText('2:05')

    await rows.nth(0).getByRole('button', { name: 'Delete recording' }).tap()
    await expect(rows.nth(0)).toContainText('Your notes stay.')
    await rows.nth(0).getByRole('button', { name: 'Keep' }).tap()
    expect(apiMock.recordingDeletes).toEqual([])

    await rows.nth(0).getByRole('button', { name: 'Delete recording' }).tap()
    await rows.nth(0).getByRole('button', { name: 'Delete', exact: true }).tap()
    await expect(rows).toHaveCount(2)
    expect(apiMock.recordingDeletes).toEqual(['take-2'])

    await expectInsideGutter(page, panel)
    await expectHeaderFitsViewport(page)
})

test('export chip: the format menu opens from the icon-only chip', async ({ page }) => {
    await page.getByRole('button', { name: 'Export score', exact: true }).tap()
    const formats = page.getByRole('group', { name: 'Export format' })
    await expect(formats).toBeVisible()
    for (const name of ['MusicXML', 'MIDI', 'PDF']) {
        await expect(formats.getByRole('button', { name })).toBeVisible()
    }

    const box = await formats.boundingBox()
    const viewport = page.viewportSize()
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual((viewport?.width ?? 0) + 1)
    await expectHeaderFitsViewport(page)
})
