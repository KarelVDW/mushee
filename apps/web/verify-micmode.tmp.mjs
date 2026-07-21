import { chromium } from '@playwright/test'

const SHOTS = '/private/tmp/claude-501/-Users-karelvandewinkel-Projecten-mushee/2b08d81a-0cce-4141-8a40-155931555331/scratchpad'
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
    const page = await ctx.newPage()
    await login(page)
    await openFirstScore(page)

    // (1) First record press → invasive dialog, recording NOT started.
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const dialogShown = await dialog
        .getByText('iPhone user')
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false)
    report('dialog appears on first iPhone record press', dialogShown)

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

    // (2) Confirm → dialog closes, recording starts (record button turns active).
    await confirmBtn.click()
    const dialogGone = await dialog
        .waitFor({ state: 'detached', timeout: 5000 })
        .then(() => true)
        .catch(() => false)
    report('dialog closes on confirm', dialogGone)
    // No reminder toast on this confirm-run.
    await page.waitForTimeout(1500)
    const toastAfterConfirm = await page.getByText(/keep Mic Mode on Wide Spectrum/i).count()
    report('no reminder toast on the confirm-run take', toastAfterConfirm === 0)
    await page.screenshot({ path: `${SHOTS}/micmode-recording-after-confirm.png` })

    // (3) Stop, then record again → no dialog, but the reminder toast.
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    await page.waitForTimeout(1500)
    const dialogAgain = await page.getByRole('dialog').count()
    report('no dialog on second take', dialogAgain === 0)
    const toast = page.getByText('Recording on iPhone: keep Mic Mode on Wide Spectrum (Control Center) so every note comes through.')
    const toastShown = await toast
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false)
    report('reminder toast on second take', toastShown)
    await page.screenshot({ path: `${SHOTS}/micmode-toast-second-take.png` })
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
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
    await page.waitForTimeout(2000)
    const dialogCount = await page.getByRole('dialog').count()
    const toastCount = await page.getByText(/Mic Mode/i).count()
    report('desktop: no dialog on record', dialogCount === 0)
    report('desktop: no mic-mode toast on record', toastCount === 0)
    await page.screenshot({ path: `${SHOTS}/micmode-desktop-control.png` })
    await ctx.close()
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
