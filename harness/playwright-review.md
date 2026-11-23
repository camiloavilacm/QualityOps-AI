# Dashboard test review record

Complete one copy of this record in the disposable exercise workspace. The lead supplies the sanitized C dashboard checkout and records its revision. The independent reviewer records the verdict and the human owner approves each generated test or repair.

| Run input | Value to record before execution |
|---|---|
| Dashboard | Revision, local start command, campaign route and clean browser starting state |
| Evidence | Sanitized export path and SHA-256 bound to the mixed campaign |
| Environment | OS, browser build, exact Playwright, CLI and MCP package versions |
| Agent | Model identifier, configuration, Planner input and approved Markdown plan |
| Criterion | Open the mixed campaign through its intended control. Verify BLOCKED, the confirmed failure for x, and the missing evidence for y in its displayed reasons. |

## Generator and Healer replay

Retain the original generated test and capture each deliberate UI diff separately. Once the Generator has produced the spec, set `QUALITYOPS_TEST_PATH` to its path and `QUALITYOPS_TEST_PROJECT` to its project name from the Playwright configuration. Run this from the disposable exercise workspace with the pinned Playwright Test package installed.

```sh
npx --no-install playwright test "${QUALITYOPS_TEST_PATH:?set the generated spec path}" \
  --project="${QUALITYOPS_TEST_PROJECT:?set the configured Playwright project}" --retries=0 --trace=on
```

Record the resolved command and store each trace before starting the next replay.

| UI | Test | Expected first attempt | Actual result and trace |
|---|---|---|---|
| Correct dashboard | Generated | Passes all three assertions | |
| Renamed accessible control | Original | Locator fails on the intended control | |
| Renamed accessible control | Proposed locator repair | Passes all three assertions | |
| Missing reason removed | Accepted locator for this UI | Fails on the missing reason assertion | |

Attach the original failure trace, proposed diff, independent rationale and human decision for each change. Verify which control the repaired locator selects. For the dropped reason, retain the failing assertion, file the product regression, and record the verdict on any Healer proposal. A deletion, skip or retry increase cannot close that regression.

## Matched browser runs

Reset the local page and browser state before each run. Give CLI and MCP the same campaign, task, model and success criterion. Record the CLI commands, MCP observation transcript and independently checked visible decision and reasons. For the fixture-only WebMCP summary tool, record its discovered name and input schema, an allowed lookup, an invalid lookup, and field-by-field agreement with the displayed campaign. Keep the tool registration in the disposable page.

| Interface | Completion and asserted result | Evidence path | Input tokens | Output tokens |
|---|---|---|---|---|
| CLI | | | | |
| MCP | | | | |

Enter **unmeasured** when telemetry is unavailable. Record which interface suited the task and the observation that supports the choice.
