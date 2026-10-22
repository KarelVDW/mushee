import type { Page, Route } from '@playwright/test'

import { expect, test } from './fixtures'

/**
 * Mocked-API auth-page e2e: the login/signup/reset-password forms — field
 * behavior, password visibility toggles, Enter submits, the navigation links
 * between them, and errors in Solkey's words with their next step — plus the
 * onboarding flow from the emailed code to the first score. better-auth
 * endpoints are answered by the fixture mock, so a "successful" sign-in
 * exercises the real client flow end-to-end into the mocked library; a test
 * that needs a failure answers that one endpoint itself (registered after the
 * fixture, so it wins).
 */

test.beforeEach(({ apiMock }) => {
    void apiMock
})

const NOW = '2026-01-01T00:00:00.000Z'

/** A better-auth session as get-session answers it, for a user who may not have verified yet. */
function sessionFor(emailVerified: boolean) {
    return {
        user: { id: 'e2e-user-1', name: 'E2E Tester', email: 'e2e@example.com', emailVerified, createdAt: NOW, updatedAt: NOW },
        session: { id: 'e2e-session-1', userId: 'e2e-user-1', token: 'e2e-token', expiresAt: '2099-01-01T00:00:00.000Z' },
    }
}

function corsHeaders(route: Route): Record<string, string> {
    return {
        'access-control-allow-origin': route.request().headers()['origin'] ?? '*',
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type',
    }
}

/**
 * Answer one mocked-API path with `answer()` (status + JSON body), the preflight included.
 * Every other request falls through to the fixture mock.
 */
async function answer(page: Page, path: string, reply: () => { status: number; body: unknown }) {
    await page.route(
        (url) => url.port === '4999' && url.pathname === path,
        (route) => {
            if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(route), body: '' })
            const { status, body } = reply()
            return route.fulfill({ status, contentType: 'application/json', headers: corsHeaders(route), body: JSON.stringify(body) })
        },
    )
}

/**
 * Open the sign-in or sign-up page and wait for its one form. Under the dev server the form
 * streams in behind its Suspense fallback (the same form without ?next=) and is revealed a
 * beat after hydration; typing before then would go into the fallback about to be swapped out.
 */
async function openAuthPage(page: Page, path: string) {
    await page.goto(path)
    await expect(page.locator('form')).toHaveCount(1)
}

/** A better-auth failure: its machine code and the library's own English, which must never reach the screen. */
const failure = (code: string, message: string, status = 400) => ({ status, body: { code, message } })

test('login: password visibility toggles and Enter submits into the library', async ({ page }) => {
    await openAuthPage(page, '/login')

    const password = page.getByRole('textbox', { name: 'Password' })
    await page.getByLabel('Email').fill('e2e@example.com')
    await password.fill('hunter2hunter2')

    // The eye toggle flips the input to plain text and back. It keeps one name and reports
    // its state through aria-pressed.
    const showPassword = page.getByRole('button', { name: 'Show password' })
    await expect(password).toHaveAttribute('type', 'password')
    await showPassword.click()
    await expect(password).toHaveAttribute('type', 'text')
    await expect(showPassword).toHaveAttribute('aria-pressed', 'true')
    await showPassword.click()
    await expect(password).toHaveAttribute('type', 'password')
    await expect(showPassword).toHaveAttribute('aria-pressed', 'false')

    // Autofill hints: password managers offer the saved login.
    await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'email')
    await expect(password).toHaveAttribute('autocomplete', 'current-password')

    // Enter submits the form; the mocked sign-in succeeds into /scores.
    await password.press('Enter')
    await expect(page).toHaveURL(/\/scores$/)
    await expect(page.getByRole('heading', { name: 'Your scores' })).toBeVisible()
})

test('login: the sign-in button submits too, and links lead to signup and reset', async ({ page }) => {
    await openAuthPage(page, '/login')

    // Tab + switch-mode links route to /signup.
    await page.getByRole('link', { name: 'Create account' }).click()
    await expect(page).toHaveURL(/\/signup$/)
    await page.getByRole('link', { name: 'Sign in' }).first().click()
    await expect(page).toHaveURL(/\/login$/)

    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await expect(page).toHaveURL(/\/reset-password$/)
    await page.goBack()

    await page.getByLabel('Email').fill('e2e@example.com')
    await page.getByRole('textbox', { name: 'Password' }).fill('hunter2hunter2')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/scores$/)
})

test('the wordmark leads home from the auth card', async ({ page }) => {
    await openAuthPage(page, '/login')
    await page.getByRole('link', { name: 'Solkey home' }).click()
    await expect(page).toHaveURL(/\/$/)
})

test('login: a wrong password says so plainly and links the reset, the email carried over', async ({ page }) => {
    await answer(page, '/api/auth/sign-in/email', () => failure('INVALID_EMAIL_OR_PASSWORD', 'Invalid email or password', 401))
    await openAuthPage(page, '/login')

    await page.getByLabel('Email').fill('e2e@example.com')
    await page.getByRole('textbox', { name: 'Password' }).fill('wrong-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByText("That email and password don't match. Check for a typo, or reset your password.")).toBeVisible()
    await expect(page.getByText('Invalid email or password')).toHaveCount(0)
    await page.getByRole('link', { name: 'reset your password' }).click()
    await expect(page).toHaveURL(/\/reset-password$/)
    await expect(page.getByLabel('Email')).toHaveValue('e2e@example.com')
})

test('login: keeping a pending deletion signs out to a card that says until when it can be undone', async ({ page }) => {
    await answer(page, '/account/deletion', () => ({ status: 200, body: { pending: true, purgeAfter: '2026-11-01T12:00:00.000Z' } }))
    await openAuthPage(page, '/login')

    await page.getByLabel('Email').fill('e2e@example.com')
    await page.getByRole('textbox', { name: 'Password' }).fill('hunter2hunter2')
    await page.getByRole('button', { name: 'Sign in' }).click()

    const dialog = page.getByRole('dialog', { name: 'Your account is set to be deleted.' })
    await dialog.getByRole('button', { name: 'Keep it deleted' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('status').filter({ hasText: 'Signed out.' })).toHaveText(
        /^Signed out\. Your account will be deleted on .+\. Sign in before then if you change your mind\.$/,
    )
})

test('the sign-in and sign-up links carry ?next= across, so a deep link survives switching forms', async ({ page }) => {
    // The share page's "save a copy" CTA sends visitors to /signup?next=/s/<token>.
    await openAuthPage(page, '/signup?next=%2Fs%2Fe2e-token')
    await page.getByRole('link', { name: 'Sign in' }).first().click()
    await expect(page).toHaveURL(/\/login\?next=%2Fs%2Fe2e-token$/)
    await page.getByRole('link', { name: 'Create one' }).click()
    await expect(page).toHaveURL(/\/signup\?next=%2Fs%2Fe2e-token$/)
})

test('signup: filling the form creates the account and moves on to onboarding', async ({ page }) => {
    await openAuthPage(page, '/signup')

    // The rule is shown before anyone fails it; signing up costs nothing.
    await expect(page.getByText('At least 8 characters.')).toBeVisible()
    await expect(page.getByText('Free to start — no card needed.')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Password' })).toHaveAttribute('autocomplete', 'new-password')

    await page.getByLabel('Your name').fill('E2E Signup')
    await page.getByLabel('Email').fill('new@example.com')
    await page.getByRole('textbox', { name: 'Password' }).fill('a-strong-passphrase-9')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page).toHaveURL(/\/onboarding/)
})

test('signup: an address that already has an account offers sign-in, the email and ?next= carried over', async ({ page }) => {
    await answer(page, '/api/auth/sign-up/email', () =>
        failure('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'User already exists. Use another email.', 422),
    )
    await openAuthPage(page, '/signup?next=%2Fs%2Fe2e-token')

    await page.getByLabel('Your name').fill('Returning Person')
    await page.getByLabel('Email').fill('taken@example.com')
    await page.getByRole('textbox', { name: 'Password' }).fill('a-strong-passphrase-9')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByText("There's already an account with this email.")).toBeVisible()
    await expect(page.getByText('Use another email')).toHaveCount(0)
    await page.getByRole('link', { name: 'Sign in instead' }).click()
    await expect(page).toHaveURL(/\/login\?next=%2Fs%2Fe2e-token$/)
    await expect(page.getByLabel('Email')).toHaveValue('taken@example.com')
})

test('signup: a too-short password is flagged under its field', async ({ page }) => {
    await answer(page, '/api/auth/sign-up/email', () => failure('PASSWORD_TOO_SHORT', 'Password too short'))
    await openAuthPage(page, '/signup')

    await page.getByLabel('Your name').fill('E2E Signup')
    await page.getByLabel('Email').fill('new@example.com')
    const password = page.getByRole('textbox', { name: 'Password' })
    await password.fill('short')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByText('Use at least 8 characters.', { exact: true })).toBeVisible()
    await expect(password).toHaveAttribute('aria-invalid', 'true')
    // Read out as it arrives: focus stays on the button, where the field's own description isn't read.
    await expect(page.getByText('Password: Use at least 8 characters.', { exact: true })).toHaveAttribute('aria-live', 'polite')
    await expect(page.getByText('Password too short')).toHaveCount(0)
})

test('reset password: requesting a link reaches the sent stage and can resend', async ({ page }) => {
    await page.goto('/reset-password')

    const send = page.getByRole('button', { name: 'Send reset link' })
    await expect(send).toBeDisabled()
    await expect(page.getByLabel('Email')).toHaveAttribute('type', 'email')
    await page.getByLabel('Email').fill('e2e@example.com')
    await expect(send).toBeEnabled()
    await send.click()

    // Sent stage: the resend affordance works, and we can go back.
    const resend = page.getByRole('button', { name: /resend the link/ })
    await expect(resend).toBeVisible()
    await resend.click()
    await expect(page.getByText(/link sent again/i)).toBeVisible()

    await page.getByRole('button', { name: 'Use a different email' }).click()
    await expect(send).toBeVisible()
})

test('reset password: a rejected address is flagged under its field, and the emailed link keeps ?next=', async ({ page }) => {
    const redirects: string[] = []
    page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/request-password-reset')
            redirects.push((request.postDataJSON() as { redirectTo: string }).redirectTo)
    })
    let attempts = 0
    await answer(page, '/api/auth/request-password-reset', () =>
        ++attempts === 1 ? failure('INVALID_EMAIL', 'Invalid email') : { status: 200, body: { status: true } },
    )
    await page.goto('/reset-password?next=%2Fs%2Fe2e-token')

    const email = page.getByLabel('Email')
    await email.fill('e2e@example.com')
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByText("That email doesn't look quite right.", { exact: true })).toBeVisible()
    await expect(email).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('alert').filter({ hasText: "That email doesn't look quite right." })).toHaveCount(0)
    await expect(page.getByText('Invalid email')).toHaveCount(0)

    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByRole('heading', { name: 'Check your email.' })).toBeVisible()
    // better-auth sends the visitor back to this URL with ?token= added: the destination rides along.
    expect(redirects.at(-1)).toMatch(/\/reset-password\?next=%2Fs%2Fe2e-token$/)
})

test('reset password: the new-password stage validates strength and match', async ({ page }) => {
    await page.goto('/reset-password?token=e2e-reset-token')

    // One meter on the page: the strength meter, not a step bar beside it.
    await expect(page.getByRole('progressbar')).toHaveCount(0)

    const save = page.getByRole('button', { name: 'Save new password' })
    await expect(save).toBeDisabled()

    await page.getByLabel('New password').fill('correct-horse-battery')
    await page.getByLabel('Confirm password').fill('correct-horse-battery')
    await expect(save).toBeEnabled()

    // The one eye toggle reveals both fields.
    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(page.getByLabel('New password')).toHaveAttribute('type', 'text')
    await expect(page.getByLabel('Confirm password')).toHaveAttribute('type', 'text')

    // A mismatch disables saving again.
    await page.getByLabel('Confirm password').fill('different')
    await expect(save).toBeDisabled()
})

test('reset password: a dead link says so and asks for a new one', async ({ page }) => {
    await answer(page, '/api/auth/reset-password', () => failure('INVALID_TOKEN', 'Invalid token'))
    await page.goto('/reset-password?token=e2e-used-token')

    await page.getByLabel('New password').fill('correct-horse-battery')
    await page.getByLabel('Confirm password').fill('correct-horse-battery')
    await page.getByRole('button', { name: 'Save new password' }).click()

    await expect(page.getByText('This reset link has expired or was already used. Ask for a new one below.')).toBeVisible()
    await expect(page.getByText('Invalid token')).toHaveCount(0)
    await page.getByLabel('Email').fill('e2e@example.com')
    await page.getByRole('button', { name: 'Send a new link' }).click()
    await expect(page.getByRole('heading', { name: 'Check your email.' })).toBeVisible()
})

test.describe('onboarding', () => {
    test('an organic signup sees four steps and ends in its first score, ready to record', async ({ page, apiMock }) => {
        const patches: Array<Record<string, unknown>> = []
        page.on('request', (request) => {
            if (request.method() === 'PATCH' && request.url().endsWith('/onboarding'))
                patches.push(request.postDataJSON() as Record<string, unknown>)
        })
        await page.goto('/onboarding')

        // The session is verified already: the verify step shows its check and moves on by itself.
        const record = page.getByRole('heading', { name: 'What will you record?' })
        await expect(record).toBeVisible()
        await expect(record).toBeFocused()
        await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Step 2 of 4')
        // Nothing to go back to: a verified email has nothing to redo.
        await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Skip setup' })).toBeVisible()

        // A chordal pick gets the one melody line.
        await page.getByRole('button', { name: 'Pick Piano' }).click()
        await expect(page.getByText('On piano, play the tune one note at a time — Solkey writes melodies.')).toBeVisible()
        await page.getByRole('button', { name: 'Continue' }).click()

        // The mic: 'Not now' skips only the mic, not the rest of the setup.
        await expect(page.getByRole('heading', { name: 'Allow microphone access.' })).toBeFocused()
        await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0)
        await page.getByRole('button', { name: 'Not now' }).click()

        // The optional survey: single-choice rows, nothing chosen up front, the way on always there —
        // 'Skip' until something is picked, then 'Continue'.
        await expect(page.getByRole('heading', { name: 'A bit about you.' })).toBeFocused()
        const background = page.getByRole('radiogroup', { name: 'Where are you with music?' })
        await expect(background.getByRole('radio', { checked: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Skip', exact: true })).toBeVisible()
        await background.getByRole('radio', { name: 'Hobbyist' }).click()
        await expect(page.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0)
        await expect(background.getByRole('radio', { name: 'Hobbyist' })).toHaveAttribute('aria-checked', 'true')
        await page.getByRole('button', { name: 'Continue' }).click()

        // Done: straight into a first score on the instrument picked.
        await expect(page.getByRole('heading', { name: "You're all set, E2E." })).toBeVisible()
        await expect(page.getByText("You're on Sketch — free, with 3 minutes of recording a day.")).toBeVisible()
        await page.getByRole('button', { name: 'Record my first melody' }).click()
        await expect(page).toHaveURL(/\/scores\/e2e-created-1\?first=1$/)
        expect(apiMock.creates[0]).toMatchObject({ title: 'My first melody' })
        expect(JSON.stringify(apiMock.creates[0])).toContain('Piano')

        // The answers were saved, and the last step marked onboarding complete.
        expect(patches).toContainEqual({ instruments: ['Piano'] })
        expect(patches).toContainEqual(expect.objectContaining({ background: 'hobbyist', completedAt: expect.any(String) }))
    })

    test('a visitor from a paid pricing card gets a fifth step: that plan chosen, the price on its button', async ({ page }) => {
        await page.goto('/onboarding?plan=pro')
        await expect(page.getByRole('heading', { name: 'What will you record?' })).toBeVisible()
        await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Step 2 of 5')
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByRole('button', { name: 'Not now' }).click()
        // Nothing picked in the survey: its button skips it.
        await page.getByRole('button', { name: 'Skip', exact: true }).click()

        await expect(page.getByRole('heading', { name: 'Start free, or pick a plan.' })).toBeVisible()
        await expect(
            page.getByText('Sketch is free forever: 3 minutes of recording a day and up to 5 scores. Upgrade any time in Settings.'),
        ).toBeVisible()
        await expect(page.getByRole('button', { name: /^Continue to payment · .9\/month$/ })).toBeVisible()
        await expect(page.getByText("You'll confirm on the next page. Cancel any time.")).toBeVisible()

        // The free plan: nothing to pay, and the button says so.
        await page.getByRole('button', { name: /^Sketch/ }).click()
        await expect(page.getByRole('button', { name: 'Start free' })).toBeVisible()
        await expect(page.getByText("You'll confirm on the next page. Cancel any time.")).toHaveCount(0)
    })

    test('mic on an iPhone: the Wide Spectrum steps show inline, and Done remembers them for the editor', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'userAgent', {
                get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
            })
            // A granted microphone (on the prototype: WebKit hands out a fresh mediaDevices wrapper).
            Object.defineProperty(MediaDevices.prototype, 'getUserMedia', {
                configurable: true,
                value: () => Promise.resolve(new MediaStream()),
            })
        })
        await page.goto('/onboarding')
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByRole('button', { name: 'Allow microphone' }).click()

        await expect(page.getByText('Microphone connected.')).toBeVisible()
        await expect(page.getByRole('listitem').filter({ hasText: 'Tap Mic Mode.' })).toBeVisible()
        // The walkthrough's own buttons lead; the footer's Continue waits.
        await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0)
        await page.getByRole('button', { name: 'Done — Wide Spectrum is on' }).click()

        await expect(page.getByRole('heading', { name: 'A bit about you.' })).toBeVisible()
        expect(await page.evaluate(() => window.localStorage.getItem('solkey:mic-mode-guide'))).not.toBeNull()
    })

    test('each step opens at the top of the page, not where the last one was scrolled to', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 600 })
        await page.goto('/onboarding')
        await expect(page.getByRole('heading', { name: 'What will you record?' })).toBeFocused()
        await page.getByRole('button', { name: 'All instruments' }).click()
        // Continue sits below the fold on a phone: reaching it scrolls the page down.
        await page.getByRole('button', { name: 'Continue' }).scrollIntoViewIfNeeded()
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
        await page.getByRole('button', { name: 'Continue' }).click()

        await expect(page.getByRole('heading', { name: 'Allow microphone access.' })).toBeFocused()
        expect(await page.evaluate(() => window.scrollY)).toBe(0)
    })

    test('a granted mic off an iPhone moves on by itself, Back still there for the beat it shows', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(MediaDevices.prototype, 'getUserMedia', {
                configurable: true,
                value: () => Promise.resolve(new MediaStream()),
            })
        })
        await page.goto('/onboarding')
        await page.getByRole('button', { name: 'Continue' }).click()
        await expect(page.getByText('Your browser will ask for permission next.')).toBeVisible()
        await page.getByRole('button', { name: 'Allow microphone' }).click()

        await expect(page.getByText("You're ready to record.")).toBeVisible()
        await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
        await expect(page.getByRole('heading', { name: 'A bit about you.' })).toBeFocused()
    })

    test('a blocked mic leaves one next step: Continue, with Try again a quiet text button', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(MediaDevices.prototype, 'getUserMedia', {
                configurable: true,
                value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
            })
        })
        await page.goto('/onboarding')
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByRole('button', { name: 'Allow microphone' }).click()

        await expect(page.getByText('Microphone blocked.')).toBeVisible()
        await expect(
            page.getByText('No problem — the editor works without a mic, and recording will ask again when you need it.'),
        ).toBeVisible()
        await expect(page.getByText(/^To allow it now: .+ Then Try again\.$/)).toBeVisible()
        await expect(page.getByText("You can change this any time in your browser's site settings.")).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
        await page.getByRole('button', { name: 'Continue' }).click()
        await expect(page.getByRole('heading', { name: 'A bit about you.' })).toBeFocused()
    })

    test('verify: the code submits itself on the sixth digit, and a wrong one is said in plain words', async ({ page }) => {
        let verified = false
        let attempts = 0
        await answer(page, '/api/auth/get-session', () => ({ status: 200, body: sessionFor(verified) }))
        await answer(page, '/api/auth/email-otp/verify-email', () => {
            attempts++
            if (attempts === 1) return failure('INVALID_OTP', 'Invalid OTP')
            verified = true
            return { status: 200, body: { status: true, token: null, user: sessionFor(true).user } }
        })
        await page.goto('/onboarding')

        const code = page.getByLabel('6-digit code')
        await expect(code).toHaveAttribute('inputmode', 'numeric')
        await expect(code).toHaveAttribute('autocomplete', 'one-time-code')
        await expect(page.getByRole('button', { name: 'Verify' })).toHaveCount(0)

        await code.fill('123456')
        await expect(page.getByText("That code doesn't match. Check the newest email from us, or send a new code.")).toBeVisible()
        await expect(code).toHaveAttribute('aria-invalid', 'true')
        await expect(page.getByText('Invalid OTP')).toHaveCount(0)

        await code.fill('654321')
        await expect(page.getByText('Email verified.')).toBeVisible()
        await expect(page.getByRole('heading', { name: 'What will you record?' })).toBeVisible()
    })

    test('approved off the waitlist, an empty library goes straight into a first melody on the onboarding pick', async ({
        page,
        apiMock,
    }) => {
        await answer(page, '/onboarding', () => ({ status: 200, body: { instruments: ['Violin'] } }))
        // An empty library; creating a score still falls through to the fixture mock.
        await page.route(
            (url) => url.port === '4999' && url.pathname === '/scores',
            (route) =>
                route.request().method() === 'GET'
                    ? route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders(route), body: '[]' })
                    : route.fallback(),
        )
        await page.goto('/beta')

        await expect(page.getByRole('heading', { name: "You're in." })).toBeVisible()
        await expect(page.getByRole('link', { name: 'Go to my library' })).toHaveAttribute('href', '/scores')
        await page.getByRole('button', { name: 'Record my first melody' }).click()
        await expect(page).toHaveURL(/\/scores\/e2e-created-1\?first=1$/)
        expect(apiMock.creates[0]).toMatchObject({ title: 'My first melody' })
        expect(JSON.stringify(apiMock.creates[0])).toContain('Violin')
    })

    test('approved off the waitlist with scores already, the welcome just opens the library', async ({ page, apiMock }) => {
        await page.goto('/beta')

        await expect(page.getByRole('heading', { name: "You're in." })).toBeVisible()
        await expect(page.getByRole('link', { name: 'Open my library' })).toHaveAttribute('href', '/scores')
        await expect(page.getByRole('button', { name: 'Record my first melody' })).toHaveCount(0)
        expect(apiMock.creates).toHaveLength(0)
    })

    test('verify: a mistyped email starts over at signup with the name filled in, the destination and plan kept', async ({ page }) => {
        await answer(page, '/api/auth/get-session', () => ({ status: 200, body: sessionFor(false) }))
        await page.goto('/onboarding?next=%2Fs%2Fe2e-token&plan=pro')

        await page.getByRole('button', { name: 'Start over' }).click()
        await expect(page).toHaveURL(/\/signup\?next=%2Fs%2Fe2e-token&plan=pro$/)
        await expect(page.getByLabel('Your name')).toHaveValue('E2E Tester')
        await expect(page.getByLabel('Email')).toHaveValue('')
    })
})
