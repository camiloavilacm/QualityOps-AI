import { expect, test } from './fixtures/dashboard'

test('mixed campaign displays BLOCKED with both independent reasons', async ({ page }) => {
  await page.goto('/')
  const campaign = page.getByRole('link', { name: /Mixed campaign/i })
  await expect(campaign).toHaveCount(1)
  await campaign.click()
  await expect(page).toHaveURL(/\?campaign=fixture-mixed$/)
  await expect(page.locator('.decision-value')).toHaveText('BLOCKED')

  const reasons = page.getByRole('region', { name: 'Decision reasons' }).getByRole('listitem')
  const failure = reasons.filter({ hasText: 'REQUIRED_FAILURE' })
  await expect(failure).toContainText('Confirmed required failure')
  await expect(failure).toContainText('Execution x')

  const missing = reasons.filter({ hasText: 'INSUFFICIENT_EVIDENCE' })
  await expect(missing).toContainText('Insufficient evidence')
  await expect(missing).toContainText('Execution y')
  await expect(reasons).toHaveCount(2)
})
