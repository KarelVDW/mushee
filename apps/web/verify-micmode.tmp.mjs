import { chromium } from '@playwright/test'

const SHOTS = '/private/tmp/claude-501/-Users-karelvandewinkel-Projecten-mushee/2e2bdd3d-88e0-48a3-b71e-ce65d4f10152/scratchpad'
const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'

const results = []
function report(name, ok, detail = '') {
    results.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function login(page) {
    await page.goto('http://localhost:3200/login')
    await page.getByLabel(/email/i).fill('demo@mushee.local')
    await page.getByRole('textbox', { name: /password/i }).fill('mushee-demo')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL('**/scores')
    // The cookie banner overlays the mobile dock — clear it.
    const consent = page.getByRole('button', { name: 'Essential only', exact: true })
    if (await consent.isVisible().catch(() => false)) await consent.click()
}

async function openFirstScore(page) {
    // Create a fresh score — library rows are role="row" divs, and a new score
    // keeps the takes isolated per context.
    await page.getByRole('button', { name: /New score/i }).first().click()
    await page.getByPlaceholder('Untitled composition').fill(`Mic mode check ${Date.now()}`)
    await page.getByRole('button', { name: 'Create score', exact: true }).click()
    await page.waitForURL(/\/scores\/[0-9a-f-]{36}/)
    // Editor is ready once the transport (record button) is attached.
    await page.getByRole('button', { name: 'Record', exact: true }).waitFor({ timeout: 15000 })
}

/** Every getUserMedia stream the page acquires, so ordering + release are observable. */
function instrumentGetUserMedia(ctx) {
    return ctx.addInitScript(() => {
        window.__gumStreams = []
        const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        navigator.mediaDevices.getUserMedia = async (constraints) => {
            const stream = await orig(constraints)
            window.__gumStreams.push(stream)
            return stream
        }
    })
}

const trackStates = (page) => page.evaluate(() => window.__gumStreams.map((s) => s.getTracks()[0]?.readyState ?? 'none'))

const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})

// ---------- iPhone context ----------
{
    const ctx = await browser.newContext({
        userAgent: IPHONE_UA,
        viewport: { width: 390, height: 844 },
        permissions: ['microphone'],
    })
    await instrumentGetUserMedia(ctx)
    const page = await ctx.newPage()
    await login(page)
    await openFirstScore(page)

    // (1) First record press → warm-up mic stream opens FIRST, then the
    // invasive dialog; recording itself NOT started.
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const dialogShown = await dialog
        .getByText('iPhone user')
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false)
    report('dialog appears on first iPhone record press', dialogShown)
    let states = await trackStates(page)
    report('warm-up mic stream is live while the dialog is up', states.length === 1 && states[0] === 'live', states.join(','))

    const confirmBtn = dialog.getByRole('button', { name: /I've set Wide Spectrum/i })
    report('confirm button present (not a bare OK)', await confirmBtn.isVisible().catch(() => false))
    const captions = ['Swipe down from the top-right corner', 'Tap Mic Mode', 'Choose Wide Spectrum']
    for (const caption of captions) {
        const present = (await dialog.getByText(caption).count()) === 1
        report(`walkthrough caption in DOM: "${caption}"`, present)
    }

    // Screenshot the three animation phases (3s apart on the 9s loop).
    for (let phase = 0; phase < 3; phase++) {
        await page.screenshot({ path: `${SHOTS}/micmode-dialog-phase${phase + 1}.png` })
        if (phase < 2) await page.waitForTimeout(3000)
    }

    // (2) Back out (Escape) → dialog closes, warm-up released, no take started.
    await page.keyboard.press('Escape')
    const dialogGoneOnDismiss = await dialog
        .waitFor({ state: 'detached', timeout: 5000 })
        .then(() => true)
        .catch(() => false)
    report('dialog closes on Escape', dialogGoneOnDismiss)
    states = await trackStates(page)
    report('warm-up mic released on dismiss', states.length === 1 && states[0] === 'ended', states.join(','))

    // (3) Record again → guide returns (never confirmed) over a fresh warm-up.
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    const dialogBack = await dialog
        .getByText('iPhone user')
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false)
    report('dialog returns on the next attempt after dismissal', dialogBack)
    states = await trackStates(page)
    report('fresh warm-up stream live for the returned dialog', states.length === 2 && states[1] === 'live', states.join(','))

    // (4) Confirm → dialog closes, warm-up released, the real take acquires
    // its own stream and recording starts.
    await dialog.getByRole('button', { name: /I've set Wide Spectrum/i }).click()
    const dialogGone = await dialog
        .waitFor({ state: 'detached', timeout: 5000 })
        .then(() => true)
        .catch(() => false)
    report('dialog closes on confirm', dialogGone)
    // "Stop" is always in the DOM, disabled while idle — enabled means the take is live.
    const stopEnabled = page.locator('button[aria-label="Stop"]:enabled')
    const recordingStarted = await stopEnabled
        .waitFor({ timeout: 10000 })
        .then(() => true)
        .catch(() => false)
    report('recording starts after confirm', recordingStarted)
    // The engine acquires its own stream asynchronously — poll rather than sample.
    const takeStates = await page
        .waitForFunction(
            () => {
                const states = window.__gumStreams.map((s) => s.getTracks()[0]?.readyState ?? 'none')
                return states.length === 3 && states[2] === 'live' ? states.join(',') : false
            },
            null,
            { timeout: 10000 },
        )
        .then((h) => h.jsonValue())
        .catch(() => 'timeout')
    report('warm-up released, take owns its own live stream', takeStates === 'ended,ended,live', takeStates)
    // No reminder toast on this confirm-run.
    await page.waitForTimeout(1500)
    const toastAfterConfirm = await page.getByText(/keep Mic Mode on Wide Spectrum/i).count()
    report('no reminder toast on the confirm-run take', toastAfterConfirm === 0)
    await page.screenshot({ path: `${SHOTS}/micmode-recording-after-confirm.png` })
    await stopEnabled.click()

    // (5) Return as a confirmed user (reload restores the auto-selected note —
    // a take clears the selection, and record is a no-op without one) →
    // no dialog, recording starts, and the reminder toast shows.
    await page.reload()
    await page.getByRole('button', { name: 'Record', exact: true }).waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    const toast = page.getByText('Recording on iPhone: keep Mic Mode on Wide Spectrum (Control Center) so every note comes through.')
    const toastShown = await toast
        .waitFor({ timeout: 8000 })
        .then(() => true)
        .catch(() => false)
    report('reminder toast on second take', toastShown)
    const dialogAgain = await page.getByRole('dialog').count()
    report('no dialog on second take', dialogAgain === 0)
    await page.screenshot({ path: `${SHOTS}/micmode-toast-second-take.png` })
    await stopEnabled.click()
    await ctx.close()
}

// ---------- iPhone context, playback audio session left behind ----------
// Regression (2026-07-23): WebKit throws InvalidStateError from getUserMedia
// while navigator.audioSession sits in a playback-only category — and a note
// preview leaves 'playback' behind. The warm-up must declare play-and-record
// BEFORE opening the mic, exactly like RecordingEngine.start does.
{
    const ctx = await browser.newContext({
        userAgent: IPHONE_UA,
        viewport: { width: 390, height: 844 },
        permissions: ['microphone'],
    })
    await ctx.addInitScript(() => {
        const session = { type: 'auto' }
        Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true })
        window.__gumStreams = []
        const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        navigator.mediaDevices.getUserMedia = async (constraints) => {
            if (session.type === 'playback') {
                throw new DOMException('AudioSession category is not compatible with audio capture.', 'InvalidStateError')
            }
            const stream = await orig(constraints)
            window.__gumStreams.push(stream)
            return stream
        }
    })
    const page = await ctx.newPage()
    await login(page)
    await openFirstScore(page)
    // Leave the session the way a note preview does.
    await page.evaluate(() => {
        navigator.audioSession.type = 'playback'
    })
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const dialogShown = await dialog
        .getByText('iPhone user')
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false)
    report('playback session: guide still opens', dialogShown)
    const typeDuringGuide = await page.evaluate(() => navigator.audioSession.type)
    report('playback session: warm-up declared play-and-record first', typeDuringGuide === 'play-and-record', typeDuringGuide)
    let gateStates = await trackStates(page)
    report('playback session: warm-up stream live', gateStates.length === 1 && gateStates[0] === 'live', gateStates.join(','))
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
    const typeAfterDismiss = await page.evaluate(() => navigator.audioSession.type)
    report('playback session: back to auto on dismiss', typeAfterDismiss === 'auto', typeAfterDismiss)
    // Confirm-run under the same gate: the take itself must also start.
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    await dialog.getByRole('button', { name: /I've set Wide Spectrum/i }).click()
    const gateRecording = await page
        .locator('button[aria-label="Stop"]:enabled')
        .waitFor({ timeout: 10000 })
        .then(() => true)
        .catch(() => false)
    report('playback session: take starts after confirm', gateRecording)
    const typeDuringTake = await page.evaluate(() => navigator.audioSession.type)
    report('playback session: take runs on play-and-record', typeDuringTake === 'play-and-record', typeDuringTake)
    await page.locator('button[aria-label="Stop"]:enabled').click()
    await ctx.close()
}

// ---------- iPhone context, permission denied ----------
{
    const ctx = await browser.newContext({
        userAgent: IPHONE_UA,
        viewport: { width: 390, height: 844 },
    })
    // Denial surfaces at the warm-up: blocked toast, and the dialog never shows.
    await ctx.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () =>
            Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
    })
    const page = await ctx.newPage()
    await login(page)
    await openFirstScore(page)
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    const blockedToast = await page
        .getByText(/Microphone access was blocked/i)
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false)
    report('denied mic: blocked toast shown', blockedToast)
    const dialogOnDenied = await page.getByRole('dialog').count()
    report('denied mic: guide dialog never shows', dialogOnDenied === 0)
    await page.screenshot({ path: `${SHOTS}/micmode-denied.png` })
    await ctx.close()
}

// ---------- Desktop context (control) ----------
{
    const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        permissions: ['microphone'],
    })
    const page = await ctx.newPage()
    await login(page)
    await openFirstScore(page)
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    const desktopRecording = await page
        .locator('button[aria-label="Stop"]:enabled')
        .waitFor({ timeout: 10000 })
        .then(() => true)
        .catch(() => false)
    report('desktop: recording starts directly', desktopRecording)
    const dialogCount = await page.getByRole('dialog').count()
    // Match the toast copy, not bare "Mic Mode" — the script's own score
    // title ("Mic mode check …") echoes in the header and would false-positive.
    const toastCount = await page.getByText(/keep Mic Mode on Wide Spectrum/i).count()
    report('desktop: no dialog on record', dialogCount === 0)
    report('desktop: no mic-mode toast on record', toastCount === 0)
    await page.screenshot({ path: `${SHOTS}/micmode-desktop-control.png` })
    await ctx.close()
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
