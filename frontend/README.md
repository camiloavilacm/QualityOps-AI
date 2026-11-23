# Local Release Review & Playwright Test Agents

The static dashboard presents sanitized campaign exports (`src/mixed-campaign.json`, `src/showcase-export.json`) and the sanitized 120-trial live Bedrock benchmark report (`src/live-evaluation.json`).

## Run Locally

Requires Node.js 22.12+ and Python 3.11+ with `jsonschema[format-nongpl]==4.26.0`:

```sh
npm ci
npm run dev -- --port 4173
```

Open `http://127.0.0.1:4173/` to inspect all cinque campaign cards (`ELIGIBLE`, `BLOCKED`, `INCONCLUSIVE`, and `DIAGNOSED` projection) and the evaluation comparison report (`/?view=evaluation`).

## Verify Exports & Run E2E Tests

From the repository root:

```sh
python -B frontend/scripts/export_mixed.py --check
python -B frontend/scripts/export_showcase.py --check
npm --prefix frontend run build
npm --prefix frontend run test:e2e
```

## Playwright Test Agents (Local Dev-Time Only)

This directory includes official Playwright v1.56+ (`@playwright/test@1.65.1`) Test Agent definitions initialized via:

```sh
npx --prefix frontend playwright init-agents --loop=codex --config=playwright.config.ts --project=chromium
```

- **Seed test:** `tests/seed.spec.ts` verifies clean dashboard boot (`5` campaign cards, zero console/page errors).
- **Reviewed plan:** `specs/dashboard-plan.md` defines the human-reviewed scenarios before spec generation.
- **Generated specs:** `tests/mixed-campaign.spec.ts` and `tests/dashboard-flows.spec.ts`.

### Strict Healer Guardrails ([SPEC.md §2](../SPEC.md) & [PLAN.md](../PLAN.md))

1. **No CI self-healing:** GitHub Actions CI runs `npm --prefix frontend run test:e2e` (`--retries=0`) deterministically with zero agent/Healer invocation.
2. **Human approval required:** Every Planner Markdown plan, Generator spec, or Healer repair diff requires independent review and human approval before promotion.
3. **Never weaken assertions:** Accept a Healer locator repair only after verifying it targets the intended control and preserves all decision and reason assertions. If a UI change drops a required reason or alters a decision, retain the failing test as a product regression—never delete assertions, skip tests, or increase retries.
