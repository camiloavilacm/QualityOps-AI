import { test, expect } from '../fixtures/dashboard'

test('clean-page', async ({ page }) => {
  await page.goto('/clean')
  await expect(page.getByRole('heading')).toHaveText('Clean fixture')
})
test('uncaught-js-error', async ({ page }) => {
  await page.goto('/uncaught')
  await expect(page.getByRole('heading')).toHaveText('Clean fixture')
  await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 50)))
})
test('console-error', async ({ page }) => {
  await page.goto('/console')
  await expect(page.getByRole('heading')).toHaveText('Clean fixture')
})
test('same-origin-404', async ({ page }) => {
  await page.goto('/clean')
  await page.evaluate(async () => { await fetch('/404') })
})
test('same-origin-500', async ({ page }) => {
  await page.goto('/clean')
  await page.evaluate(async () => { await fetch('/500') })
})
test('request-failed', async ({ page }) => {
  await page.goto('/clean')
  await page.evaluate(async () => { try { await fetch('/disconnect') } catch { /* deliberate transport fault */ } })
})
test('second-tab-error', async ({ page, context }) => {
  await page.goto('/clean')
  const second = await context.newPage()
  await second.goto('/uncaught')
  await expect(second.getByRole('heading')).toHaveText('Clean fixture')
  await second.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 50)))
})
test('navigation-abort', async ({ page }) => {
  await page.goto('/clean')
  const started = page.waitForRequest(request => request.url().endsWith('/slow'))
  const attempted = page.goto('/slow').catch(error => String(error))
  await started
  await page.goto('/clean?after-abort')
  expect(await attempted).toContain('net::ERR_ABORTED')
  await expect(page.getByRole('heading')).toHaveText('Clean fixture')
})
