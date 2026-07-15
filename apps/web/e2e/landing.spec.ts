import { expect, test } from './fixtures'

/**
 * Landing-page + cookie-consent e2e. The CTA tests run unauthenticated (no
 * apiMock fixture, so no session cookie): the nav must offer sign-in and the
 * hero CTA must lead to signup. The consent tests need the banner, which the
 * apiMock fixture normally pre-answers — they run without it too, aborting
 * external traffic to stay hermetic.
 */

// Keep unauthed pages hermetic: the app origin passes, everything else is cut.
async function stayLocal(page: import('@playwright/test').Page) {
    await page.route(/^https?:\/\//, (route) => {
        const url = new URL(route.request().url())
        return url.hostname === 'localhost' ? route.continue() : route.abort()
    })
}

test('unauthed landing: sign-in and the hero CTA route to the auth pages', async ({ page }) => {
    await stayLocal(page)
    await page.goto('/')

    await expect(page.getByRole('button', { name: 'Start free' }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/login$/)

    await page.goBack()
    await page.getByRole('button', { name: 'Start free' }).first().click()
    await expect(page).toHaveURL(/\/signup$/)
})

test('cookie banner: "Essential only" saves and stays dismissed across a reload', async ({ page }) => {
    await stayLocal(page)
    await page.goto('/')

    const banner = page.getByRole('dialog', { name: 'Cookie consent' })
    await expect(banner).toBeVisible()
    await banner.getByRole('button', { name: 'Essential only' }).click()
    await expect(banner).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole('button', { name: 'Start free' }).first()).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Cookie consent' })).toHaveCount(0)
})

test('cookie banner: "Accept all" dismisses it too', async ({ page }) => {
    await stayLocal(page)
    await page.goto('/')

    const banner = page.getByRole('dialog', { name: 'Cookie consent' })
    await banner.getByRole('button', { name: 'Accept all' }).click()
    await expect(banner).toHaveCount(0)
})

test('cookie banner: Customize opens preferences with a working analytics switch', async ({ page }) => {
    await stayLocal(page)
    await page.goto('/')

    await page.getByRole('dialog', { name: 'Cookie consent' }).getByRole('button', { name: 'Customize' }).click()

    const analytics = page.getByRole('switch', { name: 'Session replay & linked analytics' })
    await expect(analytics).toHaveAttribute('aria-checked', 'false')
    await analytics.click()
    await expect(analytics).toHaveAttribute('aria-checked', 'true')

    await page.getByRole('button', { name: 'Save preferences' }).click()
    await expect(page.getByRole('dialog', { name: 'Cookie consent' })).toHaveCount(0)
})
