import { expect, MOCK_TITLE, test } from './fixtures'

/**
 * Mocked-API library (scores list) e2e: listing, opening a score, the create
 * flow (which serializes a fresh Score through the model in the browser), and
 * deletion with the native confirm dialog.
 */

test.beforeEach(({ apiMock }) => {
    void apiMock
})

test('lists scores and opens one in the editor', async ({ page }) => {
    await page.goto('/scores')
    await expect(page.getByRole('heading', { name: 'Your scores' })).toBeVisible()

    const openRow = page.getByRole('button', { name: MOCK_TITLE })
    await expect(openRow).toBeVisible()
    await openRow.click()

    await expect(page).toHaveURL(new RegExp('/scores/'))
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
})

test('creates a new score and navigates into it', async ({ page, apiMock }) => {
    await page.goto('/scores')
    await page.getByRole('button', { name: 'New score' }).click()

    await page.getByLabel('Title').fill('My E2E Sonata')
    await page.getByRole('button', { name: 'Create score' }).click()

    // The POST body carries a model-serialized starting score (one completed measure).
    await expect.poll(() => apiMock.creates.length).toBeGreaterThan(0)
    const body = apiMock.creates[0]
    expect(body.title).toBe('My E2E Sonata')
    expect(body.score).toBeTruthy()

    await expect(page).toHaveURL(/\/scores\/e2e-created-1$/)
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
})

test('deletes a score after confirmation', async ({ page, apiMock }) => {
    await page.goto('/scores')
    await expect(page.getByRole('button', { name: MOCK_TITLE })).toBeVisible()

    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Delete' }).first().click()

    await expect.poll(() => apiMock.deletes.length).toBeGreaterThan(0)
    await expect(page.getByRole('button', { name: MOCK_TITLE })).toHaveCount(0)
})
