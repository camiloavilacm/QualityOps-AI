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


## PR verification foundation (V7-C1/C2)

The shared trusted container runner is the candidate-execution entry point; see
`../harness/README.md`. Candidate dependencies and dashboard builds are prepared
before execution. Sources and bundles remain read-only. `PW_OUTPUT_DIR`, the
Playwright JSON reporter path, and each script's explicit `--report` / `--output`
argument support evidence under `/evidence`; internal preview uses IPv4 loopback
and a strict port. Tests use one worker and zero retries. There is no Stage 2
hygiene/canary or Stage 4 summary-tool acceptance in this foundation.

Container acceptance remains **BLOCKED** on Docker's extracted-image storage.
The user freed 21 GiB and Docker starts; the 10 GiB preparation prerequisite
remains, while free disk capacity is no longer the observed blocker. The pinned
`6802…` layer pull digest failure was resolved through an exact, verified OCI
import. Stopped-container diagnostics still expose `/usr/bin/node` as zero bytes,
including after reloading only the task-created image. The independently verified
upstream `a41…` layer contains a 150,348,872-byte Node binary with SHA-256
`d931c649850ffa7155b8ceffb400dc916ef325866e509cc52ae36e33e8fbb9a9`.

No verification container has executed successfully. Docker storage repair or a
clean local Linux daemon is needed before retrying; these observations do not
establish an inherent Rosetta limitation. See the persistent [runtime summary](../harness/artifacts/container-continuation-004/publication/summary.json),
[stopped-container diagnostic](../harness/artifacts/base-runtime-probe-restored/diagnostic.json),
and [verified OCI archive record](../harness/artifacts/image-preparation/full-archive-verification.json).
The [container runner instructions](../harness/container/README.md) retain the
preparation and acceptance requirements.

The installed local package commands are `npm run pw -- <arguments>`,
`npm run typecheck`, `npm run build`, and `npm run test:e2e -- --reporter=json`.
The ordinary project retains the eight original dashboard test titles/assertions;
seed's former inline error check now uses the automatic production fixture.
`node scripts/test_guard_fixture.mjs --report /evidence/guard/report.json` selects
only `chromium-guard-meta`: exactly two clean controls and six guard-attributed
failures. Its successful orchestration intentionally contains a nonzero child
Playwright exit. `node scripts/test_webmcp_lifecycle.mjs --report
/evidence/lifecycle/report.json` selects exactly four passing lifecycle tests.
Both scripts save discovery, execution, child commands and validation outcome.
They reject missing reports, crashes, timeouts and unexpected identities/statuses.

Run the capability probe before changing native lifecycle support:
`node scripts/probe_webmcp.mjs --output /evidence/probe/report.json`. It checks
actual Chromium `159.0.8154.6`, native `document.modelContext` hints separately
from Playwright's translated adapter, execution, abort disposal, and unsupported
mode. A host preparation probe does not establish container isolation or verifier
acceptance. Native lifecycle source currently supplies transaction/rollback and
idempotence only; the dashboard does not register summary tools yet. The four
lifecycle tests import the production core and inject registration hosts in the
approved meta-test only. Native host integration and read-only summary contracts
remain Stage 4 acceptance.

Reports and traces contain synthetic fixture diagnostics only. The production
error guard records bounded reason codes, omitting raw console/error text, URLs,
headers and credentials. Navigation cancellation is accepted only after another
successful navigation on the same frame supersedes the aborted request.
