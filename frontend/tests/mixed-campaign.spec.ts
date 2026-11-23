import { expect, test } from '@playwright/test'

test('mixed campaign displays BLOCKED with confirmed failure for x and missing evidence for y', async ({ page }) => {
  await page.goto('/')

  // Open the mixed campaign through its intended control
  await page.getByRole('link', { name: /fixture-mixed/i }).click()
  await expect(page).toHaveURL(/\?campaign=fixture-mixed$/)

  // 1. Verify BLOCKED release decision
  await expect(page.locator('.decision-value')).toHaveText('BLOCKED')

  const reasons = page.getByRole('region', { name: 'Decision reasons' }).getByRole('listitem')

  // 2. Verify confirmed required failure for execution x
  const failureReason = reasons.filter({ hasText: 'REQUIRED_FAILURE' })
  await expect(failureReason).toContainText('Confirmed required failure')
  await expect(failureReason).toContainText('Execution x')

  // 3. Verify missing / insufficient evidence for execution y
  const missingReason = reasons.filter({ hasText: 'INSUFFICIENT_EVIDENCE' })
  await expect(missingReason).toContainText('Insufficient evidence')
  await expect(missingReason).toContainText('Execution y')

  await expect(reasons).toHaveCount(2)
})
