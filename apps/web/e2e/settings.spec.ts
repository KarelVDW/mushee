import type { Page } from '@playwright/test'

import { expect, MOCK_SCORE_ID, MOCK_TITLE, test } from './fixtures'

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

/** The billing state the shared mock serves (Sketch, billing not configured), with `overrides`. */
async function mockBilling(page: Page, overrides: Record<string, unknown>) {
    await page.route(/localhost:4999\/billing\/subscription$/, (route) => {
        const headers = {
            'access-control-allow-origin': route.request().headers()['origin'] ?? '*',
            'access-control-allow-credentials': 'true',
            'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
            'access-control-allow-headers': 'content-type',
        }
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' })
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers,
            body: JSON.stringify({
                tierId: 'free',
                tierName: 'Sketch',
                status: null,
                interval: null,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                billingConfigured: false,
                betaMode: false,
                credits: { limitSeconds: 180, usedSeconds: 0, remainingSeconds: 180, packSeconds: 0 },
                ...overrides,
            }),
        })
    })
}

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

test('tabs: four tabs, the current one selected, each kept in the URL across a reload', async ({ page }) => {
    const tabs = page.getByRole('tablist', { name: 'Settings' }).getByRole('tab')
    await expect(tabs).toHaveText(['Profile', 'Plan', 'Recordings', 'Account'])
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

test('recordings tab: lists every recording with its score and deletes one', async ({ page, apiMock }) => {
    await page.getByRole('tab', { name: 'Recordings' }).click()
    await expect(page).toHaveURL(/\/settings\?tab=recordings$/)
    const rows = page.getByRole('list', { name: 'Recordings' }).getByRole('listitem')
    await expect(rows).toHaveCount(4)
    await expect(rows.first()).toContainText(MOCK_TITLE)
    await rows.first().getByRole('button', { name: 'Delete recording' }).click()
    await rows.first().getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(rows).toHaveCount(3)
    expect(apiMock.recordingDeletes).toEqual(['take-2'])
})

test('recordings tab: links each score, labels orphans "Deleted score", and disables play without audio', async ({ page }) => {
    await page.goto('/settings?tab=recordings')
    const rows = page.getByRole('list', { name: 'Recordings' }).getByRole('listitem')
    await expect(rows).toHaveCount(4)

    // Recordings on a live score link to it; the orphan's score is gone, so its name is plain text.
    const live = rows.filter({ hasText: MOCK_TITLE })
    await expect(live).toHaveCount(3)
    await expect(live.first().getByRole('link', { name: MOCK_TITLE })).toHaveAttribute('href', `/scores/${MOCK_SCORE_ID}`)
    const orphan = rows.filter({ hasText: 'Deleted score' })
    await expect(orphan).toHaveCount(1)
    await expect(orphan).not.toContainText(MOCK_TITLE)
    await expect(orphan.getByRole('link')).toHaveCount(0)
    await expect(orphan.getByRole('button', { name: 'Play recording' })).toBeEnabled()

    // The audio-less recording (7 s) cannot be played; the others can.
    const silent = rows.filter({ hasText: '0:07' })
    await expect(silent).toHaveCount(1)
    const silentPlay = silent.getByRole('button', { name: 'Play recording' })
    await expect(silentPlay).toBeDisabled()
    await expect(silentPlay).toHaveAttribute('title', 'No audio was kept for this recording')
    await expect(rows.getByRole('button', { name: 'Play recording', disabled: false })).toHaveCount(3)
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
    await expect(card).toContainText('Scores: 1 of 5')
    await expect(page.getByRole('progressbar', { name: 'Recording time used today' })).toHaveAttribute(
        'aria-valuetext',
        '3 min left of 3 min',
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
