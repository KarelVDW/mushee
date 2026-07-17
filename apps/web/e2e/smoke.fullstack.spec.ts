import { expect, type Page, test } from '@playwright/test'

/**
 * Full-stack smoke. Runs against a REAL running stack (web + @mushee/api + DBs)
 * on alternate ports. Auto-skips if the web app isn't reachable, so it's safe to
 * run in any environment.
 *
 *   - Always (when the app is up): the public login page serves and hydrates.
 *   - Authed flows: sign in through the real login form (default: the seeded
 *     demo account, override with E2E_EMAIL/E2E_PASSWORD) and drive the score
 *     CRUD lifecycle — create → edit → rename → reload → delete — against the
 *     real API. This is the tier that catches transport-layer bugs the mocked
 *     suite structurally cannot (empty response bodies, content-type handling).
 *     E2E_SESSION_TOKEN is still honored as a cookie-based alternative.
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3300'
const SESSION_TOKEN = process.env.E2E_SESSION_TOKEN
const EMAIL = process.env.E2E_EMAIL ?? 'demo@mushee.local'
const PASSWORD = process.env.E2E_PASSWORD ?? 'mushee-demo'

let reachable: boolean | null = null
async function webIsUp(): Promise<boolean> {
    if (reachable !== null) return reachable
    try {
        const res = await fetch(WEB_URL, { method: 'GET' })
        reachable = res.ok || res.status < 500
    } catch {
        reachable = false
    }
    return reachable
}

test.beforeEach(async () => {
    test.skip(!(await webIsUp()), `Web app not reachable at ${WEB_URL} — start the stack first (see e2e/README.md).`)
})

test('public login page serves and hydrates', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveURL(/\/login$/)
    // The form hydrated: at least one input and a submit control are interactive.
    await expect(page.locator('input').first()).toBeVisible()
    await expect(page.getByRole('button').first()).toBeVisible()
})

/**
 * Reach the authed library: prefer an explicit session token (cookie), else
 * sign in through the real login form with the demo credentials. Skips the
 * test when neither path yields a session.
 */
async function signIn(page: Page, context: import('@playwright/test').BrowserContext, baseURL: string | undefined) {
    if (SESSION_TOKEN) {
        const host = new URL(baseURL ?? WEB_URL).hostname
        await context.addCookies([{ name: 'better-auth.session_token', value: SESSION_TOKEN, domain: host, path: '/' }])
        await page.goto('/scores')
    } else {
        await page.goto('/login')
        await page.getByLabel('Email').fill(EMAIL)
        await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
        await page.getByRole('button', { name: 'Sign in' }).click()

        const arrived = await page
            .waitForURL('**/scores', { timeout: 15_000 })
            .then(() => true)
            .catch(() => false)
        test.skip(!arrived, `Could not sign in as ${EMAIL} — seed the demo accounts (pnpm db:seed) or set E2E_EMAIL/E2E_PASSWORD.`)
    }
    await expect(page.getByRole('heading', { name: 'Your scores' })).toBeVisible()
}

test('authed: the full score lifecycle — create, edit, rename, reload, delete — through the real API', async ({
    page,
    context,
    baseURL,
}) => {
    test.slow()
    await signIn(page, context, baseURL)

    // Create a fresh score.
    const title = `E2E Smoke ${Date.now()}`
    await page.getByRole('button', { name: 'New score' }).click()
    await page.getByLabel('Title').fill(title)
    await page.getByRole('button', { name: 'Create score' }).click()

    // Landed in the editor on the created score.
    await expect(page).toHaveURL(/\/scores\/[^/]+$/)
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
    const editorUrl = page.url()

    // Edit a note pitch and let the debounced autosave (2s) flush to the API.
    await page.locator('div[tabindex="0"]').first().focus()
    await page.keyboard.press('ArrowUp')
    await page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/scores\//.test(r.url()) && r.ok(), {
        timeout: 15_000,
    })

    // Rename through the header title input; the rename autosaves too.
    const renamed = `${title} (renamed)`
    await page.getByRole('textbox', { name: 'Score title' }).fill(renamed)
    await page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/scores\//.test(r.url()) && r.ok(), {
        timeout: 15_000,
    })

    // Reload from the API and confirm the score still opens with the new title.
    await page.goto(editorUrl)
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
    await expect(page.locator('header input')).toHaveValue(renamed)

    // Delete it from the library and prove it's gone — no error toast, row
    // removed, and still absent after a full reload. (This exact flow broke in
    // production while the mocked suite stayed green.)
    await page.getByRole('button', { name: 'Back to library' }).click()
    await page.getByRole('button', { name: `Delete ${renamed}` }).click()
    await page.getByRole('button', { name: 'Delete score' }).click()

    await expect(page.getByRole('button', { name: renamed, exact: true })).toHaveCount(0)
    await expect(page.getByText(/could not delete/i)).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Your scores' })).toBeVisible()
    await expect(page.getByRole('button', { name: renamed, exact: true })).toHaveCount(0)
})

test('authed: a body-less DELETE and its empty 200 response round-trip cleanly', async ({ page, context, baseURL }) => {
    await signIn(page, context, baseURL)

    // Create a throwaway score, then delete it and inspect the raw response the
    // real server produced: success status, and the client must not choke on
    // the empty body or send a JSON content-type without a body.
    const title = `E2E Delete Probe ${Date.now()}`
    await page.getByRole('button', { name: 'New score' }).click()
    await page.getByLabel('Title').fill(title)
    await page.getByRole('button', { name: 'Create score' }).click()
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
    await page.getByRole('button', { name: 'Back to library' }).click()

    const deleteResponse = page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/scores\//.test(r.url()), {
        timeout: 15_000,
    })
    await page.getByRole('button', { name: `Delete ${title}` }).click()
    await page.getByRole('button', { name: 'Delete score' }).click()

    const res = await deleteResponse
    expect(res.status()).toBe(200)
    await expect(page.getByText(/could not delete/i)).toHaveCount(0)
    await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0)
})
