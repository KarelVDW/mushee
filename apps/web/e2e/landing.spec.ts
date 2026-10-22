import { expect, stayLocal, test } from './fixtures'

/**
 * Landing-page + cookie-consent e2e. The CTA tests run unauthenticated (no
 * apiMock fixture, so no session cookie): the nav must offer sign-in and the
 * hero CTA must lead to signup. The consent tests need the banner, which the
 * apiMock fixture normally pre-answers — they run without it too, aborting
 * external traffic to stay hermetic.
 */

test('unauthed landing: sign-in and the hero CTA route to the auth pages', async ({ page }) => {
    await stayLocal(page)
    await page.goto('/')

    await expect(page.getByRole('link', { name: 'Start free' }).first()).toBeVisible()
    await page.getByRole('link', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/login$/)

    await page.goBack()
    await page.getByRole('link', { name: 'Start free' }).first().click()
    await expect(page).toHaveURL(/\/signup$/)
})

test('hero: one action and a free-to-start line; the demo is captioned, named and can be paused', async ({ page }) => {
    await stayLocal(page)
    await page.goto('/')

    const main = page.getByRole('main')
    // The nav keeps the only Sign in; the hero's second action is gone.
    await expect(main.getByText('Already have an account?')).toHaveCount(0)
    await expect(main.getByText('Free to start — no card, nothing to install.')).toBeVisible()

    await expect(page.getByRole('img', { name: 'Demo: a hummed melody turning into notes on a staff' })).toBeVisible()
    await expect(main.getByText("Someone humming Frère Jacques. Each note appears a moment after it's sung.")).toBeVisible()
    await page.getByRole('button', { name: 'Pause demo' }).click()
    await expect(page.getByRole('button', { name: 'Play demo' })).toBeVisible()
})

test('How it works says "one note at a time" once; Good to know opens on the chords question', async ({ page }) => {
    await stayLocal(page)
    await page.goto('/')

    const how = page.locator('#how')
    await expect(how.getByRole('heading', { name: 'Sing or play the tune' })).toBeVisible()
    await expect(how).toContainText('Your voice or any instrument, one note at a time.')
    await expect(page.locator('#features')).not.toContainText('one note at a time')

    const faq = page.locator('#faq')
    await expect(faq.getByRole('heading', { name: 'Good to know.' })).toBeVisible()
    const first = faq.locator('details').first()
    await expect(first).toHaveAttribute('open', '')
    await expect(first.locator('summary')).toHaveText('Can Solkey write chords?')
    await expect(first).toContainText('Solkey writes melodies, one note at a time.')
    // The other answers open on a tap.
    const second = faq.locator('details').nth(1)
    await expect(second).not.toHaveAttribute('open', '')
    await second.locator('summary').click()
    await expect(second).toHaveAttribute('open', '')

    const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent()
    expect(jsonLd).toContain('"FAQPage"')
    expect(jsonLd).toContain('Can Solkey write chords?')
})

test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 664 } })

    test('the cookie banner sits below the hero’s Start free, and the page scrolls clear of it', async ({ page }) => {
        await stayLocal(page)
        await page.goto('/')

        const banner = page.getByRole('dialog', { name: 'Cookie consent' })
        await expect(banner).toBeVisible()
        const cta = page.getByRole('main').getByRole('link', { name: 'Start free' }).first()
        const [bannerBox, ctaBox] = [await banner.boundingBox(), await cta.boundingBox()]
        expect(bannerBox && ctaBox && bannerBox.y >= ctaBox.y + ctaBox.height).toBe(true)
        expect(bannerBox?.height ?? Infinity).toBeLessThanOrEqual(210)

        // The page is padded by the banner's footprint, so the footer can scroll above it.
        await page.getByRole('contentinfo').scrollIntoViewIfNeeded()
        await page.mouse.wheel(0, 10_000)
        const footer = await page.getByRole('contentinfo').boundingBox()
        const sheet = await banner.boundingBox()
        expect(footer && sheet && footer.y + footer.height <= sheet.y + 1).toBe(true)
    })
})

test('unauthed visitors get the brand icons, not a login redirect', async ({ request }) => {
    // The PWA manifest icons and the iOS home-screen icon are fetched without a
    // session; the auth proxy must not bounce them to /login.
    for (const path of ['/icon-192.png', '/apple-icon.png']) {
        const response = await request.get(path, { maxRedirects: 0 })
        expect(response.status(), path).toBe(200)
    }
})

test('cookie banner: "Essential only" saves and stays dismissed across a reload', async ({ page }) => {
    await stayLocal(page)
    await page.goto('/')

    const banner = page.getByRole('dialog', { name: 'Cookie consent' })
    await expect(banner).toBeVisible()
    await banner.getByRole('button', { name: 'Essential only' }).click()
    await expect(banner).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole('link', { name: 'Start free' }).first()).toBeVisible()
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

    const analytics = page.getByRole('switch', { name: 'Screen replays to help us fix bugs' })
    await expect(analytics).toHaveAttribute('aria-checked', 'false')
    await analytics.click()
    await expect(analytics).toHaveAttribute('aria-checked', 'true')

    await page.getByRole('button', { name: 'Save preferences' }).click()
    await expect(page.getByRole('dialog', { name: 'Cookie consent' })).toHaveCount(0)
})
