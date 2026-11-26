# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mixed-campaign.spec.ts >> mixed campaign displays BLOCKED with both independent reasons
- Location: tests/mixed-campaign.spec.ts:3:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('link', { name: /Mixed campaign/i })
Expected: 1
Received: 0
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" getByRole('link', { name: /Mixed campaign/i }) with timeout 5000ms
  - waiting for getByRole('link', { name: /Mixed campaign/i })
    14 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - generic [ref=e4]:
      - link "QualityOps AI" [ref=e5] [cursor=pointer]:
        - /url: ./
        - generic [aria-hidden] [ref=e6]: Q
        - text: QualityOps AI
      - navigation "Primary" [ref=e7]:
        - link "Campaigns" [ref=e8] [cursor=pointer]:
          - /url: ./
        - link "Evaluation" [ref=e9] [cursor=pointer]:
          - /url: "?view=evaluation"
  - main [ref=e10]:
    - region "Campaigns" [ref=e11]:
      - heading "Campaigns" [level=1] [ref=e12]
      - paragraph [ref=e13]: Inspect deterministic release gate decisions, sanitized evidence, and read-only offline investigations.
      - generic [ref=e14]:
        - 'link "Combined campaign fixture-mixed Confirmed required failure on x plus missing evidence on y. Gate: BLOCKED Investigation: ABSENT" [ref=e15] [cursor=pointer]':
          - /url: "?campaign=fixture-mixed"
          - generic [ref=e16]:
            - strong [ref=e17]: Combined campaign
            - code [ref=e18]: fixture-mixed
            - paragraph [ref=e19]: Confirmed required failure on x plus missing evidence on y.
            - generic [ref=e20]:
              - generic [ref=e21]: "Gate: BLOCKED"
              - generic [ref=e22]: "Investigation: ABSENT"
          - generic [aria-hidden] [ref=e23]: Open campaign ↗
        - 'link "Passing campaign fixture-pass All required executions passed with complete verified evidence. Gate: ELIGIBLE Investigation: ABSENT" [ref=e24] [cursor=pointer]':
          - /url: "?campaign=fixture-pass"
          - generic [ref=e25]:
            - strong [ref=e26]: Passing campaign
            - code [ref=e27]: fixture-pass
            - paragraph [ref=e28]: All required executions passed with complete verified evidence.
            - generic [ref=e29]:
              - generic [ref=e30]: "Gate: ELIGIBLE"
              - generic [ref=e31]: "Investigation: ABSENT"
          - generic [aria-hidden] [ref=e32]: Open campaign ↗
        - 'link "Partial evidence campaign fixture-partial No confirmed failure, but missing execution evidence prevents eligibility. Gate: INCONCLUSIVE Investigation: INCONCLUSIVE" [ref=e33] [cursor=pointer]':
          - /url: "?campaign=fixture-partial"
          - generic [ref=e34]:
            - strong [ref=e35]: Partial evidence campaign
            - code [ref=e36]: fixture-partial
            - paragraph [ref=e37]: No confirmed failure, but missing execution evidence prevents eligibility.
            - generic [ref=e38]:
              - generic [ref=e39]: "Gate: INCONCLUSIVE"
              - generic [ref=e40]: "Investigation: INCONCLUSIVE"
          - generic [aria-hidden] [ref=e41]: Open campaign ↗
        - 'link "Failing campaign (investigator outage) fixture-fail Confirmed required failure blocks release even when the AI investigator errors. Gate: BLOCKED Investigation: ERROR" [ref=e42] [cursor=pointer]':
          - /url: "?campaign=fixture-fail"
          - generic [ref=e43]:
            - strong [ref=e44]: Failing campaign (investigator outage)
            - code [ref=e45]: fixture-fail
            - paragraph [ref=e46]: Confirmed required failure blocks release even when the AI investigator errors.
            - generic [ref=e47]:
              - generic [ref=e48]: "Gate: BLOCKED"
              - generic [ref=e49]: "Investigation: ERROR"
          - generic [aria-hidden] [ref=e50]: Open campaign ↗
        - 'link "Projected defect investigation c-5125ee1591d8d901 Read-only offline investigator producing cited claims against sanitized observations. Gate: PROJECTION Investigation: DIAGNOSED" [ref=e51] [cursor=pointer]':
          - /url: "?campaign=c-5125ee1591d8d901"
          - generic [ref=e52]:
            - strong [ref=e53]: Projected defect investigation
            - code [ref=e54]: c-5125ee1591d8d901
            - paragraph [ref=e55]: Read-only offline investigator producing cited claims against sanitized observations.
            - generic [ref=e56]:
              - generic [ref=e57]: "Gate: PROJECTION"
              - generic [ref=e58]: "Investigation: DIAGNOSED"
          - generic [aria-hidden] [ref=e59]: Open campaign ↗
    - region "Investigator evaluation reports" [ref=e60]:
      - generic [ref=e61]:
        - heading "Investigator evaluation reports" [level=2] [ref=e62]
        - paragraph [ref=e63]:
          - text: "120 measured live Bedrock trials (eu-west-1, promotion:"
          - code [ref=e64]: "false"
          - text: ", status:"
          - code [ref=e65]: fail
          - text: ) + 20-case offline authored replay.
      - link "Inspect baseline vs. candidate ↗" [ref=e66] [cursor=pointer]:
        - /url: "?view=evaluation"
```

# Test source

```ts
  1  | import { expect, test } from './fixtures/dashboard'
  2  | 
  3  | test('mixed campaign displays BLOCKED with both independent reasons', async ({ page }) => {
  4  |   await page.goto('/')
  5  |   const campaign = page.getByRole('link', { name: /Mixed campaign/i })
> 6  |   await expect(campaign).toHaveCount(1)
     |                          ^ Error: expect(locator).toHaveCount(expected) failed
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
  17 |   await expect(missing).toContainText('Insufficient evidence')
  18 |   await expect(missing).toContainText('Execution y')
  19 |   await expect(reasons).toHaveCount(2)
  20 | })
  21 | 
```