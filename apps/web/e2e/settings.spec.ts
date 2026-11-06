import { expect, mockBilling, test } from './fixtures'

/**
 * Mocked-API settings e2e: the four tabs and their ?tab= deep links, profile save, the
 * plan card, the plan and pack deep links, the change-password and delete-account dialogs
 * (validation guards included), sign out, and the footer's cookie-settings entry point.
 */

test.beforeEach(async ({ page, apiMock }) => {
    void apiMock
    await page.goto('/settings')
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
})

test('profile: saving a new name posts the update and confirms with a toast', async ({ page }) => {
    const name = page.getByLabel('Your name')
    await expect(name).toHaveValue('E2E Tester')
    const save = page.getByRole('button', { name: 'Save changes' })
    // Nothing to save until the name actually changes.
    await expect(save).toBeDisabled()

    await name.fill('Renamed Tester')
    await expect(save).toBeEnabled()
    await save.click()
    await expect(page.getByRole('status').first()).toContainText(/saved|updated/i)
})

// The library's half (?new=1 opens the dialog) is covered in library.spec.ts.
test('the top-nav "New score" lands in the library with the create dialog open', async ({ page }) => {
    await page.getByRole('button', { name: 'New score' }).first().click()
    await expect(page).toHaveURL(/\/scores$/)
    await expect(page.getByRole('dialog', { name: 'New score' })).toBeVisible()
})

test('tabs: three tabs, the current one selected, each kept in the URL across a reload', async ({ page }) => {
    const tabs = page.getByRole('tablist', { name: 'Settings' }).getByRole('tab')
    await expect(tabs).toHaveText(['Profile', 'Plan', 'Account'])
    await expect(page.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('tab', { name: 'Account' }).click()
    await expect(page.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/\/settings\?tab=account$/)
    await page.reload()
    await expect(page.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Download my data' })).toBeVisible()

    // The default tab keeps the bare /settings URL.
    await page.getByRole('tab', { name: 'Profile' }).click()
    await expect(page).toHaveURL(/\/settings$/)
})

test('tabs: arrow keys move between tabs', async ({ page }) => {
    await page.getByRole('tab', { name: 'Profile' }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('tab', { name: 'Plan' })).toBeFocused()
    await expect(page.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('End')
    await expect(page.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
})

test('an old ?tab=recordings link lands on the Profile tab', async ({ page }) => {
    await page.goto('/settings?tab=recordings')
    await expect(page.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Recordings' })).toHaveCount(0)
})

test('account tab: "Download my data" produces a zip archive of the account', async ({ page }) => {
    await page.getByRole('tab', { name: 'Account' }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download my data' }).click()
    expect((await download).suggestedFilename()).toMatch(/^solkey-export-\d{4}-\d{2}-\d{2}\.zip$/)
    await expect(page.getByRole('status').first()).toContainText(/downloading/i)
})

test('profile tab: password dialog validates before allowing an update', async ({ page }) => {
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
    await page.getByRole('tab', { name: 'Account' }).click()
    await page.getByRole('button', { name: 'Delete my account' }).click()

    const dialog = page.getByRole('dialog', { name: 'Delete your account?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Type “delete my account” to confirm')).toBeVisible()
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

test('account tab: the delete-account dialog downloads the data without closing', async ({ page }) => {
    await page.getByRole('tab', { name: 'Account' }).click()
    await page.getByRole('button', { name: 'Delete my account' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete your account?' })
    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Download my data first' }).click()
    expect((await download).suggestedFilename()).toMatch(/^solkey-export-.*\.zip$/)
    await expect(dialog).toBeVisible()
})

test('sign out returns to the login page', async ({ page }) => {
    await page.getByRole('tab', { name: 'Account' }).click()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login$/)
})

test('plan tab: the plan card says what Sketch gives, what is left today and when it refills', async ({ page }) => {
    await page.goto('/settings?tab=plan')
    const card = page.getByRole('tabpanel')
    await expect(card).toContainText('Free — 3 minutes of recording a day and up to 5 scores.')
    await expect(card).toContainText('3 min left of 3 min')
    await expect(card).toContainText(/Refills (tonight|today|tomorrow) at /)
    await expect(card).toContainText('1 of 5 free scores')
    // Each number is held to its unit by a no-break space, which an exact attribute match would not normalise.
    await expect(page.getByRole('progressbar', { name: 'Recording time left today' })).toHaveAttribute(
        'aria-valuetext',
        /^3\smin left of 3\smin$/,
    )
    // Without billing in this environment nothing can be bought.
    await expect(page.getByRole('button', { name: 'See plans' })).toHaveCount(0)
})

test('an upgrade link opens the plan dialog on the asked-for tier, on the plan tab', async ({ page }) => {
    await mockBilling(page, { billingConfigured: true })
    await page.goto('/settings?tab=plan&plan=pro')
    const dialog = page.getByRole('dialog', { name: 'Change plan' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText("You're on Sketch.")
    // Tier cards are named by all their text (badges and other tiers' names included), so find the one pressed card.
    const picked = dialog.getByRole('button', { pressed: true })
    await expect(picked).toHaveCount(1)
    await expect(picked).toContainText('For daily writers')
    await expect(dialog.getByRole('button', { name: 'Continue to payment' })).toBeVisible()
    await expect(page).toHaveURL(/\/settings\?tab=plan$/)
    await expect(page.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true')

    // Back on the current plan, the footer has nothing to confirm.
    await dialog.getByRole('button', { name: /For trying things out/ }).click()
    await expect(dialog.locator('footer').getByRole('button')).toHaveText(['Close'])
})

test('a packs link opens the minute packs where they can be bought, and only the plan card otherwise', async ({ page }) => {
    await page.goto('/settings?tab=plan&packs=1')
    await expect(page.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel')).toContainText('Plan & billing')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await mockBilling(page, { billingConfigured: true })
    await page.goto('/settings?tab=plan&packs=1')
    const dialog = page.getByRole('dialog', { name: 'Extra recording minutes' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^Buy 15 min · [$€]6$/ })).toBeVisible()
    await expect(page).toHaveURL(/\/settings\?tab=plan$/)
})

test('the footer cookie-settings button reopens the consent dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'Cookie settings' }).click()

    const dialog = page.getByRole('dialog').filter({ hasText: 'Screen replays to help us fix bugs' })
    await expect(dialog).toBeVisible()

    // The switch toggles and saving closes the dialog.
    const analytics = dialog.getByRole('switch', { name: 'Screen replays to help us fix bugs' })
    const before = await analytics.getAttribute('aria-checked')
    await analytics.click()
    await expect(analytics).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true')
    await dialog.getByRole('button', { name: 'Save preferences' }).click()
    await expect(dialog).toHaveCount(0)
})
