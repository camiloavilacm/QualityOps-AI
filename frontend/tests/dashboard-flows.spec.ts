import { expect, test } from './fixtures/dashboard'

test.describe('Dashboard multi-view showcase flows', () => {
  test('passing campaign displays ELIGIBLE with complete evidence and absent investigation', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /fixture-pass/i }).click()
    await expect(page).toHaveURL(/\?campaign=fixture-pass$/)

    await expect(page.locator('.decision-value')).toHaveText('ELIGIBLE')
    const reasons = page.getByRole('region', { name: 'Decision reasons' }).getByRole('listitem')
    await expect(reasons).toHaveCount(2)
    await expect(reasons.nth(0)).toContainText('ALL_REQUIRED_PASSED')
    await expect(reasons.nth(1)).toContainText('ALL_REQUIRED_PASSED')

    await expect(page.getByRole('region', { name: 'Investigation and evaluation' }))
      .toContainText('No investigation or evaluation record is available for this fixture.')
  })

  test('partial campaign displays INCONCLUSIVE gate and INCONCLUSIVE investigation abstention', async ({ page }) => {
    await page.goto('/?campaign=fixture-partial')
    await expect(page.locator('.decision-value')).toHaveText('INCONCLUSIVE')

    const inv = page.getByRole('region', { name: 'AI failure investigation (read-only)' })
    await expect(inv.locator('.pill')).toHaveText('INCONCLUSIVE')
    await expect(inv).toContainText('Offline authored replay')
    await expect(inv).toContainText('insufficient_causal_evidence')
  })

  test('failing campaign keeps BLOCKED gate decision when investigator returns ERROR', async ({ page }) => {
    await page.goto('/?campaign=fixture-fail')
    await expect(page.locator('.decision-value')).toHaveText('BLOCKED')

    const inv = page.getByRole('region', { name: 'AI failure investigation (read-only)' })
    await expect(inv.locator('.pill')).toHaveText('ERROR')
    await expect(inv).toContainText('backend_unavailable')
  })

  test('projected defect campaign displays DIAGNOSED finding with working evidence citation anchors', async ({ page }) => {
    await page.goto('/?campaign=c-5125ee1591d8d901')
    await expect(page.locator('.decision-value')).toHaveText('NOT APPLICABLE')

    const inv = page.getByRole('region', { name: 'AI failure investigation (read-only)' })
    await expect(inv.locator('.pill')).toHaveText('DIAGNOSED')
    await expect(inv).toContainText('soft-delete-filter')
    await expect(inv).toContainText('The generated listing query had no deletion predicate')

    const citeA1 = inv.getByRole('link', { name: 'Evidence a1' })
    const citeA2 = inv.getByRole('link', { name: 'Evidence a2' })
    await expect(citeA1).toHaveAttribute('href', '#evidence-a1')
    await expect(citeA2).toHaveAttribute('href', '#evidence-a2')
    await citeA1.click()
    await expect(page).toHaveURL(/#evidence-a1$/)
  })

  test('evaluation view displays 120-trial live benchmark (BLOCKED FAIL) and offline authored comparison', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Evaluation' }).click()
    await expect(page).toHaveURL(/\?view=evaluation$/)

    await expect(page.locator('.decision-value')).toHaveText('BLOCKED (FAIL)')
    await expect(page.locator('.decision')).toContainText('120 (60 baseline + 60 candidate)')

    const liveSection = page.getByRole('region', { name: /Measured Live Bedrock Benchmark/i })
    await expect(liveSection).toContainText('eu.amazon.nova-lite-v1:0')
    await expect(liveSection).toContainText('eu.anthropic.claude-haiku-4-5-20251001-v1:0')

    const offlineSection = page.getByRole('region', { name: /Offline Authored Replay/i })
    await expect(offlineSection).toContainText('authored-baseline')
    await expect(offlineSection).toContainText('authored-candidate')
  })

  test('unknown campaign query displays unavailable fallback and navigates back', async ({ page }) => {
    await page.goto('/?campaign=nonexistent')
    await expect(page.getByRole('heading', { name: 'Campaign unavailable' })).toBeVisible()
    await page.getByRole('link', { name: '← All campaigns' }).click()
    await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()
  })
})
