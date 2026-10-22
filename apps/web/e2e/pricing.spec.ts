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

test('pricing FAQ: native disclosures, opening on the chords question', async ({ page }) => {
    await stayLocal(page)
    await page.goto('/pricing')

    const faq = page.locator('section[aria-labelledby="pricing-faq"]')
    const first = faq.locator('details').first()
    await expect(first.locator('summary')).toHaveText('Can Solkey write chords?')
    await expect(first).toHaveAttribute('open', '')
    const recordingTime = faq.locator('details').filter({ hasText: 'What counts as recording time?' })
    await recordingTime.locator('summary').click()
    await expect(recordingTime).toContainText('Your minutes refill once a day, at midnight UTC — Settings shows you when that is where you live.')
})

test('pricing cards read as plans: taglines, allowances in words, Start free and Choose …', async ({ page }) => {
    await stayLocal(page)
    await page.goto('/pricing')

    await expect(page.getByText('For trying things out')).toBeVisible()
    await expect(page.getByText('3 minutes of recording a day', { exact: true })).toBeVisible()
    await expect(page.getByText('Enough for about six 30-second recordings.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Choose Songwriter' })).toHaveAttribute('href', '/signup?plan=pro')
    await expect(page.getByRole('link', { name: 'Choose Arranger' })).toBeVisible()
})

test('signed in, the pricing page marks your plan and offers the others as switches', async ({ page, apiMock }) => {
    void apiMock // the mock account is on Sketch
    await page.goto('/pricing')

    await expect(page.getByRole('link', { name: 'Switch to Songwriter' })).toHaveAttribute('href', '/settings?tab=plan&plan=pro')
    await expect(page.getByRole('link', { name: 'Switch to Studio' })).toHaveAttribute('href', '/settings?tab=plan&plan=studio')
    const yourPlan = page.getByRole('link', { name: 'Your plan', exact: true })
    await expect(yourPlan).toHaveAttribute('href', '/settings?tab=plan')
    await yourPlan.click()
    await expect(page).toHaveURL(/\/settings\?tab=plan$/)
})

test('landing nav and footer link to the pricing page', async ({ page }) => {
    await stayLocal(page)
    await page.goto('/')
    await page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Pricing' }).click()
    await expect(page).toHaveURL(/\/pricing$/)
})
