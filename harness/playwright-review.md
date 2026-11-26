# Dashboard test review record

## Current main replay (2026-11-26)

This replay fulfills the mixed-campaign Planner/Generator/Healer exercise against the current merged `main` snapshot. Dashboard source commit: `a85de9faab17d86450ac792a44fc9a86d37d4a66`; tree: `c47bc2700dd4a9130698faa097be740e6486e13a`. The sanitized campaign `fixture-mixed` source digest is `1bdda5cadd7c835f08123d29af8c56eb51c7356cdd9153bd34c865c0c84f0662`; the displayed showcase export digest is `98f266bcc81ebfe35989d90a626ff71b396990b28f761c59b66829610cafe739`.

The criterion required navigating from the dashboard list to `fixture-mixed`, confirming `BLOCKED`, and retaining both `REQUIRED_FAILURE` for execution `x` and `INSUFFICIENT_EVIDENCE` for execution `y`. The plan, generated spec candidate, UI variants, locator repair, logs, Playwright traces, and digest manifest are in [the evidence packet](artifacts/playwright-dashboard-exercise-20261126/summary.json). The browser environment was Node `v26.12.0`, npm `11.20.0`, `@playwright/test` `1.65.1`, and Chromium `159.0.8154.6` on macOS arm64.

The test ran once per case with `--retries=0` and one worker. The baseline generated spec passed with both reason assertions and the two-reason count. Renaming the visible control from “Mixed campaign” to “Combined campaign” made the original locator fail; changing only the locator to the unique accessible name containing `fixture-mixed` passed on both the renamed dashboard and the restored baseline. A second disposable UI variant removed the `INSUFFICIENT_EVIDENCE` reason while preserving `BLOCKED` and the confirmed failure for `x`; the unchanged test failed on the missing-reason assertion on its first attempt. No repair was applied to hide that product regression.

**Independent review: PASS.** The read-only reviewer `/root/playwright_exercise_review` inspected commit `a85de9faab17d86450ac792a44fc9a86d37d4a66`, tree `c47bc2700dd4a9130698faa097be740e6486e13a`, the five browser traces, the locator-only diff, and the updated digest manifest. The follow-up review verified all five build logs and all 11 manifest entries. The reviewer confirmed both gate-reason assertions remain unchanged, the locator repair targets the intended unique control, and the known dropped-reason regression fails on `INSUFFICIENT_EVIDENCE` with zero retries.

**Workflow and limitations:** This session authored the Planner Markdown, generated spec candidate, and Healer locator proposal manually while following the configured workflow, then ran them with the installed `@playwright/test` CLI. The dedicated Playwright Test Agent MCP actions were unavailable and were not invoked. The user approved the locator repair on 2026-11-26. The exact `/fixture-mixed/i` locator already exists in `frontend/tests/mixed-campaign.spec.ts` on the reviewed source revision, so no frontend edit was needed. The full generated spec remains an exercise artifact and was not promoted. The browser run was a host development exercise, not a new isolated-container gate acceptance. A preliminary setup run was blocked by the missing local Chromium binary and selected the repository spec before the disposable generated spec; it is retained under the packet’s `setup/` path and excluded from the five scenario outcomes above.

The matched comparison from 2026-11-26 is recorded in the next section. The older CLI/MCP/WebMCP table below remains historical evidence from the earlier dashboard revision.

## Matched CLI/MCP/WebMCP comparison (2026-11-26)

The comparison used the same current-main dashboard revision `a85de9faab17d86450ac792a44fc9a86d37d4a66`, the same sanitized `fixture-mixed` data (`mixed-campaign.json` SHA-256 `1bdda5cadd7c835f08123d29af8c56eb51c7356cdd9153bd34c865c0c84f0662`; displayed export SHA-256 `98f266bcc81ebfe35989d90a626ff71b396990b28f761c59b66829610cafe739`), a fresh isolated browser context, a 1280x800 viewport, and initial route `/`. All interfaces used Google Chrome for Testing `159.0.8154.6`; CLI was `@playwright/cli@0.1.25`; Playwright MCP was `@playwright/mcp@0.0.86` backed by Playwright `1.66.0-alpha-2026-11-18`; the native/adapter test suite used `@playwright/test@1.65.1`.

**Results:** CLI navigation and Playwright MCP navigation both selected `fixture-mixed` and observed the same route, `BLOCKED` decision, `REQUIRED_FAILURE` for execution `x`, and `INSUFFICIENT_EVIDENCE` for execution `y`. Both interfaces discovered the recorded campaign summary tool. Valid `get_campaign_summary({campaign_id:"fixture-mixed"})` results matched the displayed summary and preserved both reason pairs. Unknown campaign input was rejected. The WebMCP browser suite passed all three native/adapter cases with no skips, unexpected results, or flaky results. CLI and MCP token counts are **unmeasured** because neither interface exposed model token telemetry; WebMCP made no model call.

**Independent review: PASS.** `/root/playwright_exercise_review` independently ran the comparison verifier, confirmed the DOM/tool agreement and invalid-input rejection, checked all 36 evidence hashes, and confirmed the token fields are honestly marked. Reviewed source commit `a85de9faab17d86450ac792a44fc9a86d37d4a66`, tree `c47bc2700dd4a9130698faa097be740e6486e13a`.

The complete command and response packet is [here](artifacts/playwright-interface-comparison-20261126/summary.json). Package manifests, tool transcripts, snapshots, WebMCP test report, verifier and checksum manifest are included. This was a host development run using the pinned Playwright alpha runtime; it is not an isolated-container acceptance run.

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
- **Variant 1 — Renamed Accessible Control (`healer-proposal-1-locator-repair.diff`):** **ACCEPT (human-approved 2026-11-26)** — Changes only line 7 from `getByRole('link', { name: /Mixed campaign/i })` to `getByRole('link', { name: /fixture-mixed/i })`. Verified to uniquely target `<a className="campaign-card" href="?campaign=fixture-mixed">`, confirm navigation via `toHaveURL(/\?campaign=fixture-mixed$/)`, and preserve all three required assertions plus `toHaveCount(2)` untouched. Passes on first attempt (`--retries=0`) against both Variant 1 and the restored baseline UI. The same locator is already present in the current main test.
- **Variant 2 — Missing-Evidence Reason Dropped (`ui-variant-2-dropped-reason.diff`):** **RETAIN FAILURE AS PRODUCT REGRESSION** — Caught on first attempt (`--retries=0`) directly on the `INSUFFICIENT_EVIDENCE` assertion (`element(s) not found`). No assertion was weakened or deleted, the test was not skipped, and retries were not increased. Any Healer proposal that deletes the assertion, skips the test, or raises retries is **REJECTED**.
- **Human decision:** *Locator-only repair approved by the human owner on 2026-11-26. The dropped-reason product regression remains rejected as a test-healing target.*

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
