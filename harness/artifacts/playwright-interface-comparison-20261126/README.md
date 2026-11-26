# Matched browser interface comparison

Source: `QualityOps-AI` main snapshot `a85de9faab17d86450ac792a44fc9a86d37d4a66`.
Campaign: sanitized `fixture-mixed` (see the hashes in `summary.json`).

All interfaces used a fresh isolated browser context at `http://127.0.0.1:4183/`, viewport 1280x800, and the same criterion: navigate to the mixed campaign and observe `BLOCKED`, `REQUIRED_FAILURE/x`, and `INSUFFICIENT_EVIDENCE/y`. Browser binaries were the same Chrome for Testing 159.0.8154.6 executable. The CLI and MCP packages are pinned in their local evidence package locks and were installed under `/private/tmp/qualityops-interface-comparison-20261126`; they are not project dependencies.

## Reproduction commands

From the pinned dashboard snapshot with its locked frontend dependencies:

```sh
npm run build
npm run preview -- --port 4183
```

Playwright CLI (`@playwright/cli@0.1.25`):

```sh
playwright-cli -s=cli --config playwright-cli.config.json --json open http://127.0.0.1:4183/
playwright-cli -s=cli --json snapshot
playwright-cli -s=cli --json click e15
playwright-cli -s=cli --json snapshot
playwright-cli -s=cli --json eval '() => ({ url: location.href, decision: document.querySelector(".decision-value")?.textContent?.trim(), reasons: [...document.querySelectorAll(".reason-list > li")].map(li => ({ label: li.querySelector(".reason-main h3")?.textContent?.trim(), execution_id: li.querySelector(".reason-main p code")?.textContent?.trim(), code: li.querySelector(".reason-evidence > code")?.textContent?.trim() })) })'
```

Playwright MCP (`@playwright/mcp@0.0.86`): `node mcp/run-mcp.mjs`. The script starts the pinned MCP server, navigates from `/`, snapshots, clicks the unique campaign link, checks the DOM, discovers the page-registered WebMCP tools, calls the valid and invalid campaign inputs, and closes the browser.

WebMCP and native adapter suite:

```sh
npm run test:webmcp -- --reporter=json --retries=0
```

Input/output tokens are unmeasured for the CLI and MCP because no model client or token telemetry was available. WebMCP uses no model.
