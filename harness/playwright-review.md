# Dashboard test review record

Completed in the disposable exercise workspace `/Users/camiloavila/Documents/qualityops-ai-playwright-exercise`. The lead supplied the sanitized C1 dashboard checkout (`b7a61e99a4112ed5dd4022de7a356d83a47e6f32`). The read-only independent reviewer recorded the verdicts below. Human owner approval is required before accepting any generated test or repair into a tracked branch.

| Run input | Recorded value |
|---|---|
| Dashboard | Revision `b7a61e99a4112ed5dd4022de7a356d83a47e6f32` (`stage1/c1-dashboard`), start command `npm --prefix ../frontend run dev -- --port 4173`, campaign route `http://127.0.0.1:4173/` → `/?campaign=fixture-mixed`, clean browser context per run |
| Evidence | `frontend/src/mixed-campaign.json`, SHA-256 `1bdda5cadd7c835f08123d29af8c56eb51c7356cdd9153bd34c865c0c84f0662` (verified) |
| Environment | macOS 15.7.1 (Build `24G231`), Node `v26.13.1`, npm `11.20.0`, Chromium `159.0.8154.6` (`chromium-1255`), `@playwright/test@1.65.1`, `@playwright/cli@0.1.25`, `@playwright/mcp@0.0.86` (MCP server `1.66.0-alpha-2026-11-18`) |
| Agent | Lead + Read-only Independent Reviewer (`research` subagent); Planner plan at `exercise/specs/mixed-campaign-plan.md` |
| Criterion | Open the mixed campaign through its intended control. Verify `BLOCKED`, the confirmed failure for `x`, and the missing evidence for `y` in its displayed reasons. |

## Generator and Healer replay

Resolved command run from `exercise/`:

```sh
QUALITYOPS_TEST_PATH=tests/mixed-campaign.spec.ts \
QUALITYOPS_TEST_PROJECT=chromium \
npx --no-install playwright test "${QUALITYOPS_TEST_PATH}" \
  --project="${QUALITYOPS_TEST_PROJECT}" --retries=0 --trace=on
```

| UI | Test | Expected first attempt | Actual result and trace |
|---|---|---|---|
| Correct dashboard (`b7a61e9`) | Generated (`exercise/artifacts/mixed-campaign.original.spec.ts`) | Passes all three assertions | **PASS** (1 passed, 621ms) — `exercise/artifacts/traces/01-correct-generated.zip`, `exercise/artifacts/logs/01-correct-generated.log` |
| Renamed accessible control (`ui-variant-1-renamed-control.diff`) | Original | Locator fails on the intended control | **FAIL** (`TimeoutError` on `getByRole('link', { name: /Mixed campaign/i })`) — `exercise/artifacts/traces/02-renamed-original-fail.zip`, `exercise/artifacts/logs/02-renamed-original-fail.log` |
| Renamed accessible control (`ui-variant-1-renamed-control.diff`) | Proposed locator repair (`healer-proposal-1-locator-repair.diff`) | Passes all three assertions | **PASS** (1 passed, 362ms; also verified **PASS** on restored baseline in `05-correct-repaired-pass.zip`) — `exercise/artifacts/traces/03-renamed-repaired-pass.zip`, `exercise/artifacts/logs/03-renamed-repaired-pass.log` |
| Missing reason removed (`ui-variant-2-dropped-reason.diff`) | Accepted locator (`exercise/tests/mixed-campaign.spec.ts`) | Fails on the missing reason assertion | **FAIL** on first attempt (`expect(missingReason).toContainText('Insufficient evidence')`, `element(s) not found`) — `exercise/artifacts/traces/04-dropped-reason-fail.zip`, `exercise/artifacts/logs/04-dropped-reason-fail.log` |

### Independent Reviewer Verdicts

- **Planner Plan (`exercise/specs/mixed-campaign-plan.md`):** **PASS** — Matches the exact criterion, pins revision, fixture SHA-256, URL, and clean browser context.
- **Variant 1 — Renamed Accessible Control (`healer-proposal-1-locator-repair.diff`):** **ACCEPT (pending human approval)** — Changes only line 7 from `getByRole('link', { name: /Mixed campaign/i })` to `getByRole('link', { name: /fixture-mixed/i })`. Verified to uniquely target `<a className="campaign-card" href="?campaign=fixture-mixed">`, confirm navigation via `toHaveURL(/\?campaign=fixture-mixed$/)`, and preserve all three required assertions plus `toHaveCount(2)` untouched. Passes on first attempt (`--retries=0`) against both Variant 1 and the restored baseline UI.
- **Variant 2 — Missing-Evidence Reason Dropped (`ui-variant-2-dropped-reason.diff`):** **RETAIN FAILURE AS PRODUCT REGRESSION** — Caught on first attempt (`--retries=0`) directly on the `INSUFFICIENT_EVIDENCE` assertion (`element(s) not found`). No assertion was weakened or deleted, the test was not skipped, and retries were not increased. Any Healer proposal that deletes the assertion, skips the test, or raises retries is **REJECTED**.
- **Human decision:** *Pending human owner approval.*

## Matched browser runs

Both CLI and MCP runs reset browser state (`close` / fresh headless server) before navigating to `http://127.0.0.1:4173/`, discovering link ref `e12` (`?campaign=fixture-mixed`), clicking it, and verifying `BLOCKED`, `REQUIRED_FAILURE` (`Execution x`), and `INSUFFICIENT_EVIDENCE` (`Execution y`).

| Interface | Completion and asserted result | Evidence path | Input tokens | Output tokens |
|---|---|---|---|---|
| CLI (`@playwright/cli@0.1.25`) | **PASS** — Clicked `e12`, navigated to `/?campaign=fixture-mixed`, verified `BLOCKED`, `REQUIRED_FAILURE` (`Execution x`), `INSUFFICIENT_EVIDENCE` (`Execution y`) | `exercise/artifacts/cli-run.log` | **unmeasured** | **unmeasured** |
| MCP (`@playwright/mcp@0.0.86`, server `1.66.0-alpha-2026-11-18`) | **PASS** — `browser_navigate` → `browser_snapshot` → `browser_click(target: e12)` → `browser_snapshot` confirmed `BLOCKED`, `REQUIRED_FAILURE` (`Execution x`), `INSUFFICIENT_EVIDENCE` (`Execution y`) | `exercise/artifacts/mcp-run.json` | **unmeasured** | **unmeasured** |

### WebMCP verification (`page.webmcp`, Chromium `159.0.8154.6`)

- **Registration:** Disposable-only (`exercise/artifacts/diffs/disposable-webmcp-tool.diff`, `document.modelContext.registerTool` in disposable `frontend/src/main.tsx`).
- **Discovered tool:** `get_campaign_summary` (`readOnly: true`), input schema requiring string `campaign_id` with `additionalProperties: false`.
- **Allowed lookup (`{ "campaign_id": "fixture-mixed" }`):** Returned `{ campaign_id: "fixture-mixed", decision: "BLOCKED", completeness: "partial", policy_version: "mandatory-v2", reasons: [...], evidence_ids: ["x"] }`.
- **Invalid lookup (`{ "campaign_id": "unknown-campaign" }`):** Deterministically rejected with `{ error: "UNKNOWN_OR_INVALID_CAMPAIGN", campaign_id: "unknown-campaign", allowed_campaign_ids: ["fixture-mixed"] }`.
- **Field-by-field agreement with displayed DOM:** `fieldAgreement: true` (`deepStrictEqual(domSummary, validResult)`). Evidence: `exercise/artifacts/webmcp-run.json`.

### Interface suitability observation

- **Playwright CLI** suited this short, repeatable verification task best: deterministic shell commands (`open`, `snapshot`, `click`, `eval`, `close`) with compact output and no long-lived JSON-RPC harness needed.
- **Playwright MCP** suited interactive multi-step exploration where structured accessibility snapshots and dynamic tool schemas are consumed over a persistent session.
- **Caveats noted by Independent Reviewer:** Token counts are `unmeasured` (not emitted by local harness); initial load logged one `/favicon.ico` 404 console error; `mixed-campaign.spec.ts` asserts all three criterion assertions and `toHaveCount(2)` without explicitly asserting the `Evidence x` href or `No evidence artifact available` text; WebMCP registration remains strictly inside the disposable workspace.
