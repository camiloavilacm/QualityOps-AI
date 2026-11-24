import { expect, test } from './fixtures/dashboard'

test.describe('Test group', () => {
  test('seed', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()
    await expect(page.locator('.campaign-card')).toHaveCount(5)
    await expect(page.getByRole('link', { name: /Inspect baseline vs\. candidate/i })).toBeVisible()
  })
})
