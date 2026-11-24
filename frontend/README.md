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
and a strict port. Tests use one worker and zero retries. Stage 2 inventory, hygiene and the paired canary are described below. Stage 4
summary-tool acceptance remains pending.

The initial container attempts were blocked by corrupted extracted-image storage and
then Chromium's sandbox failing at `chroot` with an empty capability bounding set.
Docker was restarted from an empty image/container/volume store, and the pinned AMD64
image was freshly pulled. Apple Virtualization Framework and Rosetta were already
enabled. The approved runner now retains only `CAP_SYS_CHROOT` in the capability
bounding set; effective, permitted, and ambient capabilities remain empty, and
Chromium sandboxing stays enabled.

The approved Stage 1 container gate **PASS** at verifier SHA
`06a50ab582e1e9b6c19254964603df534b4794cd`: 8 ordinary passes, two guard controls
and six correctly attributed guard failures, and four lifecycle passes. The
accepted rerun evidence is in [the runtime summary](../harness/artifacts/container-accepted-stage1/summary.json)
and [published report](../harness/artifacts/container-accepted-stage1/publication/summary.json).
Stages 2–4 and remote R12/R14 checks remain NOT RUN; this is not merge or deployment
authorization. See the [container runner instructions](../harness/container/README.md)
for the exact policy and reproduction command.
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


## Stage 2 inventory, hygiene and paired canary

`tests/expected-tests.json` records actual discovery identities and source-reviewed
assertion minimums: eight ordinary dashboard tests, eight production-guard meta
tests, and four lifecycle tests. The fourth `chromium-webmcp` project records zero
discovery as **NOT INTRODUCED**, pending Stage 4; an empty run cannot pass.
The mixed test retains ID `DASH-003`; its unchanged missing-evidence assertions
are grouped in `DASH-003-REASON-01` for mutation attribution.

Run `npm run test:hygiene` for positive/negative scanner and report tests. Run
`npm run check:hygiene -- --project=chromium [--report <execution-json>]` and select
the guard/lifecycle project explicitly for their corresponding checks. The
checker uses the installed local Playwright binary, independently scans every
file under `tests/`, checks exact identities and per-test AST assertion counts,
and rejects unapproved imports, hidden test files, aliases, unsupported test APIs,
browser injection, retries and known workflow bypasses. Fixture and meta-test
operation exceptions are pinned to reviewed source bytes; new helpers require
separate policy review. Reserved read-only WebMCP evaluation checks do not
introduce absent interface tests. Counts detect deletion, not semantic equivalence.

Set `PW_HYGIENE_OUTPUT_DIR` to a fresh evidence directory and, from the trusted
launcher, `PW_VERIFIER_REVISION` to the verifier SHA. Hygiene JSON records relative
discovery/execution paths, raw report digests, separate inventory/policy digests,
and hashes labeled as the observed candidate source bytes. Execution reports
outside that directory are copied into it for durable publication. Without an
output override, evidence uses a fresh temporary directory. Parent workflows and
harness policy are read-only inputs, supplied by the trusted runner.

The trusted Stage 2 image build prepares the positive and mutated bundles from
verifier-owned sources, removes its temporary build copies, and stores both bundles
read-only in the image. `npm run test:canary` serves those prepared bundles on free
strict loopback ports 4184 and 4185, checks the rendered states independently, and
executes exactly `DASH-003` once from the read-only approved test mount against
each bundle. Runtime candidate code cannot rebuild or modify the bundles. Only the
designated missing-evidence step can kill the mutant. Set
`PW_CANARY_OUTPUT_DIR` to the trusted evidence mount; `summary.json` records
`PASS`/`KILLED` only for an attributed pair with successful cleanup. The mutated
export snapshot and each discovery/execution report remain in that output
directory. A single presentation mutant and static checks do not establish
universal assertion correctness or authorize merge. Host diagnostic passes remain
distinct from accepted container runs.
