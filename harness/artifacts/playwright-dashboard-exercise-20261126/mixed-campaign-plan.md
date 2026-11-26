# Planner output: Mixed campaign

## Criterion
From a clean browser state, open the campaign through its visible dashboard control. Confirm the release decision is `BLOCKED` and the reasons retain both `REQUIRED_FAILURE` for execution `x` and `INSUFFICIENT_EVIDENCE` for execution `y`.

## Preconditions
- Dashboard source is pinned to `a85de9faab17d86450ac792a44fc9a86d37d4a66` (`origin/main`).
- Use the sanitized `fixture-mixed` record in `frontend/src/showcase-export.json`; verify its source fixture digest in `frontend/src/mixed-campaign.json` is `1bdda5cadd7c835f08123d29af8c56eb51c7356cdd9153bd34c865c0c84f0662`.
- Start each run in a new Chromium context; run one attempt with retries set to zero.

## Scenario: inspect the mixed campaign
1. Navigate to `/`.
2. Find and open the link named `Mixed campaign`.
3. Confirm navigation to `/?campaign=fixture-mixed`.
4. Confirm the displayed release decision is `BLOCKED`.
5. In the `Decision reasons` region, confirm `REQUIRED_FAILURE` says `Confirmed required failure` and names execution `x`.
6. Confirm `INSUFFICIENT_EVIDENCE` says `Insufficient evidence` and names execution `y`.
7. Confirm exactly two decision reasons are displayed.

## Failure conditions
Fail if the campaign control is missing or ambiguous, navigation selects another campaign, decision differs, either reason/code/execution pair is absent, or an extra reason appears.
