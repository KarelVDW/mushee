import { expect, test } from '@playwright/test'

/**
 * Full-stack smoke. Runs against a REAL running stack (web + @mushee/api + DBs)
 * on alternate ports. Auto-skips if the web app isn't reachable, so it's safe to
 * run in any environment.
 *
 *   - Always (when the app is up): the public login page serves and hydrates.
 *   - Authed flow (when E2E_SESSION_TOKEN is provided): create → edit → reload a
 *     score against the real API, proving persistence end-to-end. A valid
 *     better-auth session token is required because sign-up needs email
 *     verification; export one from a seeded account, e.g.
 *       E2E_SESSION_TOKEN=... pnpm test:e2e:smoke
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3300'
const SESSION_TOKEN = process.env.E2E_SESSION_TOKEN

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

test('authed: create, edit, and reload a score persists through the real API', async ({ page, context, baseURL }) => {
    const token = SESSION_TOKEN
    test.skip(!token, 'Set E2E_SESSION_TOKEN to a valid better-auth session to run the authed flow.')
    if (!token) return

    const host = new URL(baseURL ?? WEB_URL).hostname
    await context.addCookies([{ name: 'better-auth.session_token', value: token, domain: host, path: '/' }])

    // Library loads from the real API.
    await page.goto('/scores')
    await expect(page.getByRole('heading', { name: 'Your scores' })).toBeVisible()

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

    // Reload from the API and confirm the score still opens with our title.
    await page.goto(editorUrl)
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
    await expect(page.locator('header input')).toHaveValue(title)
})
