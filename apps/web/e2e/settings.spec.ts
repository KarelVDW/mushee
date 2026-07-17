import { expect, test } from './fixtures'

/**
 * Mocked-API settings e2e: tab navigation, profile save, the change-password
 * and delete-account dialogs (validation guards included), sign out, and the
 * footer's cookie-settings entry point.
 */

test.beforeEach(async ({ page, apiMock }) => {
    void apiMock
    await page.goto('/settings')
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
})

test('profile: saving a display name posts the update and confirms with a toast', async ({ page }) => {
    const name = page.getByLabel('Display name')
    await expect(name).toHaveValue('E2E Tester')

    await name.fill('Renamed Tester')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status').first()).toContainText(/saved|updated/i)
})

test('account tab: password dialog validates before allowing an update', async ({ page }) => {
    await page.getByRole('button', { name: 'Account', exact: true }).click()
    await page.getByRole('button', { name: 'Change password' }).click()

    const dialog = page.getByRole('dialog', { name: 'Change password' })
    await expect(dialog).toBeVisible()
    const update = dialog.getByRole('button', { name: 'Update password' })
    await expect(update).toBeDisabled()

    await dialog.getByLabel('Current password').fill('old-password-1')
    await dialog.getByLabel('New password', { exact: true }).fill('brand-new-passphrase-7')
    await dialog.getByLabel('Confirm new password').fill('brand-new-passphrase-7')
    await expect(update).toBeEnabled()

    // Mismatched confirmation blocks the update again.
    await dialog.getByLabel('Confirm new password').fill('something-else')
    await expect(update).toBeDisabled()

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
})

test('account tab: delete-account is guarded by phrase, password, and checkbox', async ({ page }) => {
    await page.getByRole('button', { name: 'Account', exact: true }).click()
    await page.getByRole('button', { name: 'Delete my account' }).click()

    const dialog = page.getByRole('dialog', { name: 'Delete your account?' })
    await expect(dialog).toBeVisible()
    const confirm = dialog.getByRole('button', { name: 'Delete account' })
    await expect(confirm).toBeDisabled()

    // Each guard alone is not enough.
    await dialog.getByPlaceholder('delete my account').fill('delete my account')
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel('Your password').fill('hunter2hunter2')
    await expect(confirm).toBeDisabled()
    await dialog.getByRole('checkbox').check()
    await expect(confirm).toBeEnabled()

    // A wrong phrase re-disables even with the rest satisfied.
    await dialog.getByPlaceholder('delete my account').fill('delete account')
    await expect(confirm).toBeDisabled()

    await dialog.getByRole('button', { name: 'Keep my account' }).click()
    await expect(dialog).toHaveCount(0)
})

test('sign out returns to the login page', async ({ page }) => {
    await page.getByRole('button', { name: 'Account', exact: true }).click()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login$/)
})

test('the footer cookie-settings button reopens the consent dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'Cookie settings' }).click()

    const dialog = page.getByRole('dialog').filter({ hasText: 'Session replay & linked analytics' })
    await expect(dialog).toBeVisible()

    // The switch toggles and saving closes the dialog.
    const analytics = dialog.getByRole('switch', { name: 'Session replay & linked analytics' })
    const before = await analytics.getAttribute('aria-checked')
    await analytics.click()
    await expect(analytics).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true')
    await dialog.getByRole('button', { name: 'Save preferences' }).click()
    await expect(dialog).toHaveCount(0)
})
