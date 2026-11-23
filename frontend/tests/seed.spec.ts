import { expect, test } from '@playwright/test'

test.describe('Test group', () => {
  test('seed', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()
    await expect(page.locator('.campaign-card')).toHaveCount(5)
    await expect(page.getByRole('link', { name: /Inspect baseline vs\. candidate/i })).toBeVisible()
    expect(errors).toEqual([])
  })
})
