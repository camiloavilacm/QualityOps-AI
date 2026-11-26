# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mixed-campaign.spec.ts >> mixed campaign displays BLOCKED with both independent reasons
- Location: tests/mixed-campaign.spec.ts:3:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('region', { name: 'Decision reasons' }).getByRole('listitem').filter({ hasText: 'INSUFFICIENT_EVIDENCE' })
Expected substring: "Insufficient evidence"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" getByRole('region', { name: 'Decision reasons' }).getByRole('listitem').filter({ hasText: 'INSUFFICIENT_EVIDENCE' }) with timeout 5000ms
  - waiting for getByRole('region', { name: 'Decision reasons' }).getByRole('listitem').filter({ hasText: 'INSUFFICIENT_EVIDENCE' })

```

```yaml
- banner:
  - link "QualityOps AI":
    - /url: ./
  - navigation "Primary":
    - link "Campaigns":
      - /url: ./
    - link "Evaluation":
      - /url: "?view=evaluation"
- main:
  - link "← All campaigns":
    - /url: ./
  - heading "Mixed campaign" [level=1]
  - paragraph:
    - code: fixture-mixed
    - text: Synthetic fixture
  - heading "Release decision" [level=2]
  - paragraph: BLOCKED
  - term: Evidence completeness
  - definition: partial
  - term: Policy version
  - definition:
    - code: mandatory-v2
  - region "Decision reasons":
    - heading "Decision reasons" [level=2]
    - list:
      - listitem:
        - heading "Confirmed required failure" [level=3]
        - paragraph:
          - text: Execution
          - code: x
        - code: REQUIRED_FAILURE
        - paragraph:
          - link "Evidence x":
            - /url: "#evidence-x"
            - text: Evidence
            - code: x
  - region "Evidence":
    - heading "Evidence" [level=2]
    - list:
      - listitem:
        - code: x
        - text: Execution report
  - region "Investigation and evaluation":
    - heading "Investigation and evaluation" [level=2]
    - paragraph: No investigation or evaluation record is available for this fixture.
```

# Test source

```ts
  1  | import { expect, test } from './fixtures/dashboard'
  2  | 
  3  | test('mixed campaign displays BLOCKED with both independent reasons', async ({ page }) => {
  4  |   await page.goto('/')
  5  |   const campaign = page.getByRole('link', { name: /fixture-mixed/i })
  6  |   await expect(campaign).toHaveCount(1)
  7  |   await campaign.click()
  8  |   await expect(page).toHaveURL(/\?campaign=fixture-mixed$/)
  9  |   await expect(page.locator('.decision-value')).toHaveText('BLOCKED')
  10 | 
  11 |   const reasons = page.getByRole('region', { name: 'Decision reasons' }).getByRole('listitem')
  12 |   const failure = reasons.filter({ hasText: 'REQUIRED_FAILURE' })
  13 |   await expect(failure).toContainText('Confirmed required failure')
  14 |   await expect(failure).toContainText('Execution x')
  15 | 
  16 |   const missing = reasons.filter({ hasText: 'INSUFFICIENT_EVIDENCE' })
> 17 |   await expect(missing).toContainText('Insufficient evidence')
     |                         ^ Error: expect(locator).toContainText(expected) failed
  18 |   await expect(missing).toContainText('Execution y')
  19 |   await expect(reasons).toHaveCount(2)
  20 | })
  21 | 
```