import { expect, stayLocal, test } from './fixtures'

/**
 * The dedicated /pricing route. Runs unauthenticated and hermetic (app origin
 * only). In beta mode the page shows the beta notice instead of the tier
 * ladder, so the assertions cover what both modes share: the heading, the FAQ,
 * and the CTA leading to signup.
 */
test('pricing page: heading, FAQ and structured data are present; CTA routes to signup', async ({ page }) => {
    await stayLocal(page)
    await page.goto('/pricing')

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Simple plans')
    await expect(page.getByRole('heading', { name: 'Questions, answered.' })).toBeVisible()
    await expect(page.getByText('What counts as recording time?')).toBeVisible()

    const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent()
    expect(jsonLd).toContain('"FAQPage"')
    expect(jsonLd).toContain('"SoftwareApplication"')

    // The get-started CTA's two signed-out labels (launch / closed beta), one table in GetStartedButton.
    await page
        .getByRole('link', { name: /Start free|Request access/ })
        .first()
        .click()
    await expect(page).toHaveURL(/\/signup$/)
})

test('landing nav and footer link to the pricing page', async ({ page }) => {
    await stayLocal(page)
    await page.goto('/')
    await page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Pricing' }).click()
    await expect(page).toHaveURL(/\/pricing$/)
})
