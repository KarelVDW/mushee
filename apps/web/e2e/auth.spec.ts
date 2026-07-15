import { expect, test } from './fixtures'

/**
 * Mocked-API auth-page e2e: the login/signup/reset-password forms — field
 * behavior, password visibility toggles, Enter submits, and the navigation
 * links between them. better-auth endpoints are answered by the fixture mock,
 * so a "successful" sign-in exercises the real client flow end-to-end into the
 * mocked library.
 */

test.beforeEach(({ apiMock }) => {
    void apiMock
})

test('login: password visibility toggles and Enter submits into the library', async ({ page }) => {
    await page.goto('/login')

    const password = page.getByRole('textbox', { name: 'Password' })
    await page.getByLabel('Email').fill('e2e@example.com')
    await password.fill('hunter2hunter2')

    // The eye toggle flips the input to plain text and back.
    await expect(password).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Toggle password visibility' }).click()
    await expect(password).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: 'Toggle password visibility' }).click()
    await expect(password).toHaveAttribute('type', 'password')

    // Enter submits the form; the mocked sign-in succeeds into /scores.
    await password.press('Enter')
    await expect(page).toHaveURL(/\/scores$/)
    await expect(page.getByRole('heading', { name: 'Your scores' })).toBeVisible()
})

test('login: the sign-in button submits too, and links lead to signup and reset', async ({ page }) => {
    await page.goto('/login')

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

test('signup: filling the form creates the account and moves on to onboarding', async ({ page }) => {
    await page.goto('/signup')

    await page.getByLabel('Your name').fill('E2E Signup')
    await page.getByLabel('Email').fill('new@example.com')
    await page.getByRole('textbox', { name: 'Password' }).fill('a-strong-passphrase-9')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page).toHaveURL(/\/onboarding/)
})

test('reset password: requesting a link reaches the sent stage and can resend', async ({ page }) => {
    await page.goto('/reset-password')

    const send = page.getByRole('button', { name: 'Send reset link' })
    await expect(send).toBeDisabled()
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

test('reset password: the new-password stage validates strength and match', async ({ page }) => {
    await page.goto('/reset-password?token=e2e-reset-token')

    const save = page.getByRole('button', { name: 'Save new password' })
    await expect(save).toBeDisabled()

    await page.getByLabel('New password').fill('correct-horse-battery')
    await page.getByLabel('Confirm password').fill('correct-horse-battery')
    await expect(save).toBeEnabled()

    // A mismatch disables saving again.
    await page.getByLabel('Confirm password').fill('different')
    await expect(save).toBeDisabled()
})
