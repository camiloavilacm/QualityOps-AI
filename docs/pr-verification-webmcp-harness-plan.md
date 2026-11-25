# Staged PR Verification Plan (v7) — Agent Harness, Guardrails & WebMCP

**Status:** Stage 1 shared-container foundation implemented, independently reviewed, human-accepted at verifier SHA `06a50ab582e1e9b6c19254964603df534b4794cd`, and integrated into `main` at `4cfe008bb6156d670504f50241adbb399f9dbd85`. The trusted Stage 1 container gate passed. Stage 2 inventory, hygiene and paired-canary work is now active; later acceptance boxes remain unchecked.

**Objective:** Establish reproducible evidence that a proposed test change preserves a reviewed requirement and detects its declared regression, then submit that evidence and the final commit SHA for human review. PR verification does not compute or override the product's deterministic campaign gate. Neither successful CI nor agent output authorizes release, merge, model promotion, or deployment.

## 1. Source, Scope, Ownership, and Trust Boundary

This revision applies the approved v7 corrections to the existing v6 plan in place. The review's product source revision is `d1645d9d4389c28803c1d0de316ab3746867f539`; the frozen contract baseline is `a33bc9dba103e321b4513ccf6b57ccf0b61c5106` (wire version `2.0.0-draft.1`). The v6 document was added at `63bd7b88f97a4196453b728c508f9f6e32d65d7c`, which changes documentation and `.gitignore` relative to the reviewed product revision. Record the actual candidate revision at implementation time; neither revision is an accepted trusted verifier by implication.

The user-supplied source is `/Users/camiloavila/.gemini/antigravity-cli/brain/f333a104-dda6-4e89-923b-bb72988fb7d9/pr_verification_webmcp_harness_plan.md`. Its SHA-256, identical to the repository's v6 copy before this edit, is `495c7150adf9696232e94bfabb0d26079a7d15b1d977d7bc0e57597738097e67`. Preserve that external source as provenance. The repository document is the revision target; no second harness plan is needed.

The approved shared-container plan authorizes the first implementation slice: lead-owned documentation, `harness/` and `.github/`, and C-owned Stage 1 foundation under `frontend/`. The following work packages retain their ownership; `harness/ownership.json` remains unchanged. Stages 2–4 remain follow-up work, with no passing empty gates.

| Work package | Owner and allowed paths | Inputs, acceptance, and handoff |
|---|---|---|
| V7-C1 — Dashboard test foundation | C; `frontend/` | Existing eight tests, v2 sanitized fixtures; automatic production guard, migrated specs, type checking, project selection, hygiene/inventory checks, isolated canary. Hand off exact revision and local evidence. |
| V7-L1 — Trusted verification | Lead; `harness/` | Reviewed baseline, scope policy, independent expectations; scope checker, report validator, cumulative launcher, red-team runner, authored-evaluation oracle, and evidence records. No frontend or workflow ownership exception. |
| V7-L2 — CI and governance | Lead; `.github/` | C1/L1 interfaces; complete offline jobs, SHA-pinned actions, artifacts, review routing, and PR template. Remote ruleset changes remain H1. |
| V7-C2 — WebMCP presentation | C; `frontend/` | Sanitized showcase, successful capability probe; lifecycle core and meta-tests, two bounded summary tools, native/adapter tests, read-only observations. Coordinate lifecycle foundation in Stage 1 and summary integration in Stage 4. |
| V7-R1 — Independent review | Read-only reviewer | Exact final revisions, commands, results, isolation, scope, oracle derivation, and limitations. Report verdict without self-approval by the implementing owner. |
| V7-H1 — Remote protection verification | Human maintainer | Separate authorization for ruleset configuration and disposable remote tests R12/R14; record revisions, identities, settings, and observed enforcement. |

Use isolated worktrees for write-heavy implementation owners, with lead integration and no concurrent edits to shared files. A task handoff names its work package, allowlist, accepted schemas/fixtures, tests, definition of done, and stop conditions. No inference spend, infrastructure changes, remote writes, pushes, PR creation, merges, or deployments are authorized by this planning revision. Frozen schemas, gate semantics, evaluator thresholds, and recorded results stay unchanged.

### Approved shared container runtime

The approved implementation source is the attached `approved-plan.md` (SHA-256 recorded in `harness/container/implementation-record.json`). Starting HEAD is `63bd7b88f97a4196453b728c508f9f6e32d65d7c`; pre-existing uncommitted v7 document and roadmap edits were preserved. This is an infrastructure bootstrap, not an accepted verifier revision.

Use `harness/container/runtime-policy.json` and `harness/container/Dockerfile` for local and CI browser verification. Base image: `mcr.microsoft.com/playwright@sha256:766137e2d9caad4744187e53cdc89320ba6f2eb57cff097374020944b44dd0a9`, platform `linux/amd64`, image-provided Node 26, Playwright 1.65.1 and exact Chromium 159.0.8154.6. Upstream Dockerfile and unmodified seccomp profile are pinned to Playwright commit `bbd948344ea9a60bf1e6f125c02ca99b2b51593b`; profile SHA-256 is `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`.

Locked dependency installation and dashboard build occur during trusted preparation from the verifier export only. Candidate execution installs nothing. Prepared sources/bundles are read-only; only approved ordinary specs are overlaid through a read-only tests mount. Future Gate 2 positive and mutated bundles must be built separately during trusted preparation; no runtime rebuild or candidate-selected mutation is permitted.

Execution uses `pwuser`, a read-only root, `CAP_SYS_CHROOT` retained only in the capability bounding set for Chromium's namespace sandbox, `no-new-privileges`, the pinned seccomp profile, `--network none`, IPv4 loopback fixture servers, two CPUs, 4 GiB memory with no extra swap, 512 processes, private 1 GiB shared memory, one worker, five-minute child commands and a thirty-minute overall gate. The in-container probe requires empty effective, permitted and ambient capability sets and only `CAP_SYS_CHROOT` in the bounding set; Chromium uses it in its child user namespace. Only `/tmp` and disposable evidence output are writable. No host home, credentials, private evidence, Docker socket, privileged mode or host networking are mounted. Inspect Docker settings and run in-container denial/resource/loopback probes before any candidate code. Missing Docker, failed isolation, missing reports and cleanup failures fail closed; no unrestricted fallback.

The four-argument launcher interface remains unchanged. `--bootstrap` is an explicit infrastructure-evidence mode requiring identical verifier/candidate SHAs; it cannot accept itself or execute overlays. Trusted overlays additionally require an external maintainer acceptance record binding verifier SHA, runtime policy digest, independent review, human acceptance, candidate SHA and exact approved spec blob digests. This record is an operational approval boundary, not cryptographic authentication. See [container instructions](../harness/container/README.md).

Gate 1 runs foundation checks only. Gate 2 introduces hygiene, inventory and the paired canary; Gate 3 retains thirteen local red-team cases and R12/R14 `NOT RUN`; Gate 4 retains WebMCP summary acceptance. The current launcher explicitly blocks unimplemented stages. CI browser feedback uses the same runner in bootstrap mode, the existing Python 3.12 offline suite remains separate, and Pages publication is held pending separately authorized integration and deployment.

### Trusted Healer verification

Obtain the launcher, scope policy, fixture, helpers, exact inventory, Playwright configuration, report validators, and reporters from a human-reviewed verifier revision outside candidate control. The lead's `harness/run_pr_verification.mjs` must resolve and record immutable verifier and candidate revisions, prepare a disposable workspace from the verifier, check the complete diff, and overlay only explicitly approved ordinary spec files. Preserve the original reviewed product/build inputs. Do not import candidate configuration, package scripts, dependencies, helpers, fixture, workflow, inventory, oracle, or reporter code into that verification run.

Use `harness/check_healer_scope.py` from the trusted revision to check the baseline-to-candidate diff, including rename, deletion, symlink, and untracked overlay handling. The allowlist initially contains only the three reviewed ordinary spec files, with per-change approval. A new generated test remains disposable until a human accepts its spec and inventory change through a separate infrastructure review. No candidate label, manifest, or configuration can grant its own scope exception. Reject an unresolvable revision or ambiguous scope.

Run candidate tests without credentials, with writes bounded to disposable inputs/output and network restricted to declared local fixture servers. Isolation must constrain candidate code execution; instructions and an AST scanner alone are insufficient. Fail verification if the launcher cannot establish those restrictions. Install locked dependencies from trusted inputs before restricted execution. Report the actual isolation mechanism and its limits.

Changes to verification infrastructure follow a separate maintainer-reviewed work package. Promote a new trusted verifier revision only after independent review and explicit human acceptance bound to that revision. Candidate-controlled CI can provide useful feedback; it does not establish a non-bypassable trust boundary.

### Governance

Keep zero required GitHub approving reviews as the solo-maintainer default. The maintainer records human review and merge authorization against the final commit SHA; a later commit invalidates that authorization. Credential withholding is an operational requirement to establish and verify, not an assumed fact about the present agent environment.

Stage 3 proposes read-only inspection of production branch rules and H1 separately handles changes. Record required-check names and trusted sources, ruleset settings and bypass actors, enforcement state, and tested revisions. CODEOWNERS routes review; it does not independently prevent modification or authorize merging.

## 2. Technical Audit Reconciliation (F01–F12)

All twelve findings are addressed in the proposed design below, pending implementation and verification. These are acceptance commitments, not completed results.

| Finding | Severity | Proposed acceptance and stage |
|---|---|---|
| F01 — Solo-maintainer PR approval deadlock | Critical | Zero required approvals; SHA-bound human review; honest operational credential boundary. Record actual check sources and rules. H1 remote tests require separate authorization. Stages 1/3. |
| F02 — Guard meta-test layer mismatch | Critical | Real runner executes the production automatic fixture under `chromium-guard-meta`; exactly two clean controls and six guard-attributed failures. Stage 1. |
| F03 — AST rules contradict fixture and helpers | Critical | Separate ordinary, fixture/helper, WebMCP read-only, and meta-test operation policies; mutation mocks only in approved meta-tests. Stage 2. |
| F04 — `.test.ts` escapes discovery | High | Independent filesystem scan rejects unapproved test-like files and declarations; R1a and R1b remain separate cases. Stage 2. |
| F05 — WebMCP inventory unverified | High | Discovery and execution inventories for all four projects; ordinary and WebMCP success contracts separated from intentional guard failures. Stages 2/4. |
| F06 — Canary server selection and mutation isolation | High | Two independently built temporary copies, strict ports, rendered-state precheck, positive control, `DASH-003` plus `DASH-003-REASON-01` failure attribution, guaranteed cleanup. Stage 2. |
| F07 — `minExpects` assertion integrity limits | High | Counts detect deletion; the canary demonstrates only its declared regression. Human semantic review remains required. Stage 2. |
| F08 — Workflow and checker self-modification | High | Baseline-owned scope policy, launcher, configuration, fixture, inventory, and reporters; candidate overlay limited to approved ordinary specs. Infrastructure promotion needs independent and human review. Stages 2/3. |
| F09 — WebMCP native annotations and capability probe | High | Probe pinned browser before implementation; plain native projections with Hint annotations; separate Playwright adapter assertions. Stages 1/4. |
| F10 — WebMCP transactional lifecycle and read-only purity | High | Dedicated lifecycle project proves unsupported mode, duplicate initialization, second-registration rollback, and disposal; interface tests observe unchanged DOM, URL, storage, and application data. Stages 1/4. |
| F11 — Exact inventory execution contract | Medium | Stable IDs, actual titles, duplicate rejection, exact sets, one attempt, expected and actual statuses, and outcome; explicit guard exception contract. Stages 1/2. |
| F12 — Cumulative gates and clean reproducibility | Medium | Stage N runs all checks from stages 1 through N with recorded commands, versions, digests, revisions, results, and limitations. Remote cases remain separate. Stages 1–4. |

## 3. Detailed Implementation Plan — Four Stages

All paths and commands described as new below are planned interfaces. They are not installed by this document and must not be reported as executed. Stage numbers refer to this PR-verification plan, not to the repository's authorization stages.

### Stage 1 — Runnable Test Foundation

**Owners:** C1/C2 for frontend; L1 for launcher/report validation; L2 for governance documents. **Done when:** the eight original dashboard tests retain their behavior, all test/configuration sources type-check, and production guard/lifecycle meta-tests execute under explicitly selected projects with attributable results.

#### Governance and type checking

- L2 adds `.github/CODEOWNERS` and `.github/PULL_REQUEST_TEMPLATE.md`. Route `.github/`, `.agents/`, `AGENTS.md`, `PLAN.md`, contracts, backend gate/ingestion, held-out truth, harness, samples, frontend agent instructions/configuration/scripts/tests/lockfiles, sanitized exports, and WebMCP source to `@camiloavilacm`. The template records owner, approved paths, changed test IDs, rationale, revisions, evidence, limitations, independent verdict, and final human authorization.
- C1 adds `frontend/AGENTS.md` referencing repository rules and existing Planner/Generator/Healer definitions, and `frontend/CLAUDE.md` importing it. Amend `frontend/.codex/agents/playwright_test_healer.toml`: remove directions to use `test.fixme()`, weaken assertions, alter expected behavior merely to pass, or continue until every defect is hidden. A real regression retains its failure. CI invokes no agent or Healer. Generated/healed changes need independent review and human acceptance.
- Expand `frontend/tsconfig.json` beyond its present `src` include to cover application code, fixtures, helpers, ordinary/meta/WebMCP specs, and `playwright.config.ts`. Add narrowly scoped native WebMCP declarations and required pinned type dependencies, with lockfile changes reviewed. `npm run typecheck` runs `tsc --noEmit`; `build` also type-checks. Avoid broad `any` declarations or treating Playwright's translated annotation types as native declarations.

#### Production guard and existing tests

- Add `frontend/tests/fixtures/dashboard.ts` exporting the shared `test`/`expect` and automatic `guardErrors` fixture (`{ auto: true }`). Observe context-level uncaught errors, `console.error`, same-origin HTTP status at least 400, and unexpected request failures across all pages, including a second tab. Accumulate bounded diagnostics, attach via `testInfo.attach`, and fail in teardown with stable reason codes. Never throw inside an asynchronous listener.
- Ignore only a verified legitimate navigation cancellation with `net::ERR_ABORTED`, not every aborted request. Preserve listener coverage through the test and remove listeners on fixture disposal. Do not expose raw credentials in diagnostics. Add a data-URI favicon to `frontend/index.html` if needed to remove an irrelevant missing-favicon request.
- Migrate `seed.spec.ts`, `mixed-campaign.spec.ts`, and `dashboard-flows.spec.ts` to import from `./fixtures/dashboard`. Move seed's inline browser-error observation into the automatic fixture. Preserve its UI assertions and all other behavior: one seed, one mixed, six dashboard-flow tests, including the separate recorded live/offline display assertions. No recorded artifact changes.
- Dashboard helpers may navigate; specs retain explicit decision, reason, and evidence assertions.

#### One configuration, four reachable projects

Use `frontend/playwright.config.ts` exclusively, `testMatch` for `.spec.ts`, `forbidOnly: true`, `retries: 0`, bounded timeouts, traces on failure, and unique output directories. Put exclusions on each project, never on a global `testIgnore` that would hide another project's tests.

| Project | Selected files | Exact planned executions | Outcome contract |
|---|---|---:|---|
| `chromium` | Only the three approved ordinary spec files | 8 | All pass once |
| `chromium-guard-meta` | `tests/meta/guard-verification.spec.ts` | 8 | Two controls pass; six guard-attributed failures |
| `chromium-webmcp` | `tests/webmcp.spec.ts` | 3, introduced Stage 4 | All pass once |
| `chromium-webmcp-lifecycle` | `tests/meta/webmcp-lifecycle.spec.ts` | 4 | All pass once; expected host failures are handled by the test |

Use existing default base URL `http://127.0.0.1:4183`, overridden only by trusted `PW_BASE_URL`. With that override, disable the internal webServer; otherwise use a strict-port preview, with server reuse disabled during verification. Each project excludes every other category. Do not execute the not-yet-authored Stage 4 interface inventory in an earlier stage or accept an empty run as a pass.

#### Guard orchestrator and lifecycle foundation

C1 adds `frontend/scripts/test_guard_fixture.mjs` and `tests/meta/guard-verification.spec.ts`. The orchestrator owns a bounded local mock server and explicitly selects `--project=chromium-guard-meta`, with a unique JSON report. All eight cases import the actual production fixture, not a copied guard:

| Case | Required execution and attribution |
|---|---|
| `clean-page` | Pass, expected outcome |
| `uncaught-js-error` | Fail, unexpected outcome; `UNCAUGHT_JS_ERROR` from guard |
| `console-error` | Fail, unexpected outcome; `CONSOLE_ERROR` from guard |
| `same-origin-404` | Fail, unexpected outcome; `HTTP_404` from guard |
| `same-origin-500` | Fail, unexpected outcome; `HTTP_500` from guard |
| `request-failed` | Fail, unexpected outcome; `REQUEST_FAILED` from guard |
| `second-tab-error` | Fail, unexpected outcome; `UNCAUGHT_JS_ERROR` from guard |
| `navigation-abort` | Pass, expected outcome; verified legitimate cancellation |

All cases have `expectedStatus: passed`, one attempt, no skips or retries. The six negative executions must fail through the guard and expected reason, with no unrelated fatal errors. The orchestrator returns success only after validating this entire special contract; the child runner's nonzero exit alone is insufficient. Missing reports, crashes, timeouts, missing cases, and incorrect reasons fail verification. Always clean up the mock server.

C2 supplies the production lifecycle core in `frontend/src/webmcp.ts` and the four-case lifecycle spec; summary payloads and dashboard registration wait for Stage 4. Run the Stage 4 capability probe before this first WebMCP implementation. Lifecycle tests import the real core and use registration-host mocks only in this approved meta-test: unsupported environment preserves a functioning dashboard, duplicate initialization creates no duplicate tools, failure on tool two aborts tool one, and explicit disposal unregisters everything and permits clean reinitialization. C2 adds `frontend/scripts/test_webmcp_lifecycle.mjs` selecting the dedicated project, collecting JSON, checking all four passing executions, and cleaning up. This early bounded core makes Stage 1 runnable without depending on Stage 4 summary tools.

L1 defines `harness/check_pr_reports.mjs` to validate explicit project/outcome contracts from the trusted inventory, and `harness/run_pr_verification.mjs` as the cumulative launcher described in Section 4. Stage 1's lead-owned `harness/pr-verification-policy.json` records the actual ordinary/guard/lifecycle identities and outcome contracts before validation; Stage 2 reconciles the frontend inventory with that reviewed policy. Guard/lifecycle orchestrators must also check their own reports; the independent validator checks them again.

### Stage 2 — Inventory, Hygiene, and Paired Canary

**Owners:** C1 for frontend scanners/inventory/canary; L1 for trusted scope and independent validation. **Done when:** exact discovery/execution contracts, scanner negative cases, and a positive/mutated canary all satisfy the trusted verifier, without expanding Healer scope.

#### Actual inventory and AST policy

Add `frontend/tests/expected-tests.json` from actual discovery and reviewed assertions. Each entry records project, unique stable ID, exact file and `titlePath`, optional assertion `stepId`, and reviewed `minExpects`. Reject duplicate IDs and duplicate identities within a project. Record counts for all four project contracts when their tests are introduced. Never initialize from the illustrative titles in v6.

Keep `DASH-003` assigned to the existing mixed test, whose actual title is `mixed campaign displays BLOCKED with confirmed failure for x and missing evidence for y`. Wrap the existing missing-evidence assertion in the named step `DASH-003-REASON-01`, without replacing or weakening that assertion. Preserve all original titles unless a separately reviewed identity migration is required. Review counts against the actual source after moving seed's browser-error assertion into the fixture.

C1 adds `frontend/scripts/check_test_hygiene.mjs`, accepting `--project=<name>` and optional `--report <path>`, and its `node --test` suite `check_test_hygiene.test.mjs`. It invokes the installed local Playwright binary with `frontend/` as working directory and no runtime package resolution. The checker must:

- Independently scan all of `frontend/tests/`, including helpers. Reject unapproved test-like extensions (`.test.ts`, `.test.js`, `.spec.js`, `.spec.mts`, `.tsx`, and equivalent variants), symlink escapes, and test declarations outside approved specs. R1a tests unexpected `.spec.ts` inventory; R1b tests filenames outside runner discovery.
- Enforce one trusted configuration; exact approved imports; no aliases for `test` or `expect`; allow `test`, `describe`, `step`, and approved lifecycle hooks; ban `skip`, `only`, `fail`, `fixme`, `slow`, spec-level `use`/`extend`, soft assertions, configured expectations, dynamic imports, empty error swallowing, and arbitrary code execution/imports. Statically analyzable locator changes are the intended Healer scope.
- Ban ordinary-spec browser injection, route interception, listener removal, alternate browser contexts, HAR routing, `waitForTimeout`, and evaluation escapes. Recursively scan approved helpers and reject unapproved imports. Production fixture listeners/base extension are a reviewed exception, not an ordinary-spec privilege.
- Permit WebMCP interface tests only bounded native tool discovery/execution and read-only DOM, URL, storage, and application-data observations. Inspect allowed evaluation bodies, not just the presence of `document.modelContext`. Reject arbitrary scripts and mutation. Registration mocks, injected errors, and other mutation triggers are confined to the exact approved meta-test files, which remain scope-protected and independently inventoried.
- Count `expect(...)` and `expect.poll(...)` against reviewed per-test minimums. This detects some assertion deletion, not semantic equivalence. A replacement tautology or wrong locator may preserve the count; the declared canary and human semantic review remain necessary.
- Validate trusted configuration/workflow structure, zero retries, forbidden focused tests, required commands, and absence of bypasses. An AST/workflow checker does not enforce trust when a candidate controls that checker.
- Run project-specific discovery with JSON and compare exact expected and discovered sets, then validate execution with `--report`: all tests executed exactly once, `expectedStatus === 'passed'`, actual status `passed`, and outcome `expected`. Guard-meta instead uses its two-pass/six-failure contract. Reject unexpected tests, missing results, skipped/expected-failure tests, retries, duplicate results, and runner-level failures. Keep discovery and execution evidence distinct.

L1's scope checker and independent report validator use baseline-owned inventory and policy, never the candidate's revised expectations. Record and test both permitted patterns and forbidden aliases, escapes, filenames, missing imports, report tampering, retries, and missing executions.

#### Isolated paired canary

C1 adds `frontend/scripts/check_canary_regression.mjs`. L1's trusted launcher supplies the approved spec overlay and reviewed build inputs. The canary must:

1. Create two separate temporary copies with trusted source and locked dependencies. Never edit the working tree or reuse a mutable `dist` directory between variants.
2. Leave the positive copy unchanged. In the mutated copy of `frontend/src/showcase-export.json`, remove only reasons whose code is `INSUFFICIENT_EVIDENCE` from campaign `fixture-mixed`. Assert the exact intended one-reason change. Do not change `mixed-campaign.json`, policy, canonical evidence, reconciliation expectations, other campaigns, or recorded results.
3. Build both copies independently after mutation. Record original/mutated export and bundle digests. Check ports 4184 and 4185 are free; start positive and mutated preview servers with `--strictPort`. Set explicit `PW_BASE_URL` to avoid an internal server or stale preview.
4. Use an independent trusted browser precheck against each served bundle. Positive UI must show `BLOCKED`, `REQUIRED_FAILURE`, and `INSUFFICIENT_EVIDENCE`; mutated UI must retain `BLOCKED` and `REQUIRED_FAILURE` while losing only the missing-evidence reason. Fetching an HTML shell alone does not verify the rendered mutation.
5. Run exactly `DASH-003` in each workspace, with one attempt, no retries, unique output/report destinations, and the actual approved title. The selected spec currently contains one test; exact discovery must still confirm its identity. Positive report: all selected assertions pass. Mutated report: failure at `DASH-003-REASON-01` on the missing-evidence assertion.
6. Return `KILLED` only for that attributed positive-pass/mutated-fail pair. A surviving mutant, absent report, unrelated failure, wrong step, crash, timeout, or occupied port makes verification `FAIL`; retain the detailed cause separately. No heuristic interpretation of any nonzero exit as a kill.
7. In `finally`, terminate only owned server processes and remove both temporary copies on success or failure, after retaining bounded evidence. Never kill an unrelated process occupying a port.

The canary proves detection of this one declared presentation regression. It does not prove preservation of every assertion's meaning or authorize a merge.

C1 proposes package commands `check:hygiene`, `test:hygiene`, and `test:canary`; C1/C2 also expose the Stage 1 commands listed in Section 4. L2 wires the completed checks into ordinary offline CI as they become available, without claiming trusted enforcement from candidate-owned workflow code.

### Stage 3 — Complete Offline CI and Accurate Protection Claims

**Owners:** L2 for `.github/`; L1 for red-team orchestration and records; H1 for separately authorized remote changes. **Done when:** all offline suites and cumulative browser checks are reproducible, thirteen local scenarios meet their expected outcomes, and remote status/limitations are stated accurately.

#### Existing Python checks and browser jobs

Retain the existing Python setup and dependency installation: `harness/requirements.txt` and `jsonschema[format-nongpl]==4.26.0`. Preserve pinned read-only preparation of `https://github.com/camiloavilacm/qa-features` at `e7c566ff831139889195643a1b906b7edab76f48`, the current archived failure-fixture copy, and `QUALITYOPS_QA_FEATURES_ROOT`. Preparation may fetch read-only source; offline test execution uses the prepared local reference. Do not introduce privileged untrusted-PR execution.

Use these established commands, covering the current 63 Python tests across the first four commands plus the two export checks. Record actual discovered/executed counts; this planning revision does not claim to have rerun them.

```sh
python -B -m unittest -v backend.ingestion.test_importer backend.gate.test_gate
python -B -m unittest -v backend.investigator.test_investigator backend.investigator.test_retrieval
python -B -m unittest discover -s evaluators -p test_evaluate.py -v
python -B -m unittest -v tests/test_vertical_slice.py
python -B frontend/scripts/export_mixed.py --check
python -B frontend/scripts/export_showcase.py --check
```

Replace the invalid v6 Python test and export invocations with this exact suite. The planned Python job also runs `python -B harness/checks.py contracts` for the existing schema/requirement-bundle checks. Do not invoke the full Stage 0 harness test discovery without its required macOS sandbox: its denial tests deliberately fail in an unrestricted process. Any separately retained Stage 0 harness run must use its documented trusted runner on a supported platform and report that result separately. The new L1 launcher must prove its own declared isolation before running candidate code.

Harden `.github/workflows/ci.yml` with minimal `contents: read`, checkout `persist-credentials: false`, full 40-character action commit pins, PR concurrency cancellation, no verification path filters, and no `continue-on-error` or swallowed failures. Review exact action revisions before selecting them. Add `.github/dependabot.yml` for weekly GitHub Actions updates. No action SHA is asserted as reviewed by this planning document.

| Planned job/check identity | Required work |
|---|---|
| `python-contracts-and-eval` | Pinned Python dependency/reference setup; harness/contract checks; the six established commands above; counts, export digests, and summary artifacts. |
| `frontend-e2e` | Locked dependencies and matching Chromium installation; typecheck/build; hygiene unit tests; ordinary discovery/execution and report validation; guard-meta; paired canary; trusted local red-team runner; artifacts. |
| `frontend-webmcp` | Locked dependencies and matching Chromium installation; capability probe; typecheck/build; lifecycle-meta with validation; Stage 4 WebMCP discovery/execution with validation; independent-oracle and read-only comparisons; artifacts. Enable required Stage 4 checks only once implemented, never manufacture a passing empty job. |

Before the Stage 4 interface exists, lifecycle verification is included in the foundation/browser checks, with the probe, so Stage 1 remains executable. Once the separate WebMCP job is active it owns those checks; the cumulative launcher still executes them at every applicable gate.

Every browser job invokes the shared container runner. Trusted image preparation runs `npm ci --ignore-scripts` from the verifier lockfile and builds the dashboard; the pinned base already contains matching Chromium. No dependency or browser installation occurs during candidate execution. C1 defines the `pw` package script as the installed local `playwright` binary; npm run supplies the frontend working directory and must not resolve an uninstalled package dynamically. Pin Node/Python settings and report actual versions. Collect explicit JSON reports, discovery inventories, guard diagnostics, canary state/attribution, probe results, lifecycle results, and summaries. Upload bounded sanitized JSON even on failure and traces on failure, with seven-day retention and unique artifact names. Evidence upload cannot convert verification failure into success.

#### Ruleset and human review boundary

H1 proposes a separately reviewed active ruleset targeting `main`: require a PR, zero required approving reviews, current-branch checks, and no configured bypass actors where supported. Record actual enforcement state, bypass settings, repository/ruleset identity, required-check names and source applications, and the commit associated with each result. Planned checks are `python-contracts-and-eval`, `frontend-e2e`, and, after Stage 4, `frontend-webmcp`. Do not assume job names alone identify a trusted check source or prevent a candidate replacing its workflow.

Agents should have no write/merge credentials; the human maintainer reviews and authorizes merging the exact final SHA. This remains an operational boundary. Ordinary candidate-controlled CI and labels cannot make it non-bypassable. Production rule inspection is read-only; ruleset writes and disposable remote experiments require separate explicit authorization.

#### Exactly 15 red-team scenarios

L1 defines `harness/verify_red_team_matrix.mjs --local --output <directory>`; this replaces v6's undefined frontend-owned red-team runner. It creates a fresh disposable workspace per local case, invokes trusted scope and appropriate checks, asserts the expected detection/outcome, records candidate/verifier revisions and artifacts, and always cleans up. A correct rejection is a passing verification of the scenario, while the rejected candidate's check is `FAIL`. R7 is a required passing control. Do not run remote cases from this command.

There are **15 scenarios: thirteen local cases and two remote cases**. R1a/R1b explain why IDs through R14 yield fifteen rows. Initial result for every row is `NOT RUN`.

| ID | Scenario | Expected observation | Execution boundary |
|---|---|---|---|
| R1a | Add unapproved `.spec.ts` | Scope rejection; isolated inventory-unit exercise also detects unexpected spec | Local |
| R1b | Add unapproved `.test.ts` | Scope rejection; filesystem-policy exercise detects undiscovered test-like file | Local |
| R2 | Add workflow `continue-on-error: true` | Trusted scope rejects workflow edit; hygiene-unit exercise rejects bypass | Local |
| R3 | Add browser escape in helper | Trusted scope rejects helper edit; recursive scanner exercise rejects escape | Local |
| R4 | Delete assertions below reviewed minimum | AST assertion-count rejection | Local |
| R5 | Remove mixed missing-evidence assertion | Independent canary cannot attribute a kill; verification fails, even if another check rejects earlier | Local |
| R6 | Add skip/only/alias operations | AST-policy rejection | Local |
| R7 | Valid locator repair on renamed control, same behavior | Reviewed intended control, preserved assertions, full applicable trusted checks pass, canary killed | Local |
| R8 | Set configuration retries to two | Trusted scope rejects config edit; config-unit exercise rejects retries | Local |
| R9 | Remove production fixture import | Import-source rejection | Local |
| R10 | Remove mandatory workflow check | Trusted scope rejects workflow edit; structure-unit exercise detects omission | Local |
| R11 | Replace hygiene checker with no-op | Trusted scope rejects checker edit before candidate checker executes | Local |
| R12 | Merge attempt with failing required check | Authenticated, otherwise permitted attempt rejected specifically by required-check rule | Remote; separately authorized disposable target; NOT RUN |
| R13 | Replace approved title with unapproved title | Exact identity/inventory rejection | Local |
| R14 | Direct push to protected branch | Authenticated, otherwise write-capable principal rejected specifically by branch rule | Remote; separately authorized disposable target; NOT RUN |

Component mutation exercises are trusted verifier unit tests in disposable copies, not permissions for Healer to overlay infrastructure. Record each component result separately from early scope rejection; do not claim the canary ran if scope/count checks stopped that candidate first. For R5, invoke the canary independently in its isolated unit exercise to demonstrate its own failure condition. R7's temporary control rename belongs only to its trusted disposable UI variant.

R12/R14 remain `NOT RUN` until authorization and evidence from a disposable remote target exist. Authentication denial demonstrates credential isolation at most; it does not prove branch-rule enforcement. Never push directly to production `main` as a test. Local Gate 3 can pass its declared offline scope with these exclusions, but remote enforcement acceptance remains open.

### Stage 4 — Bounded WebMCP Presentation

**Owners:** C2 for frontend; L1 for independent oracle/validation; L2 for CI; R1 for independent review. **Done when:** native and adapter contracts, lifecycle, strict arguments, independent summary comparisons, and read-only observations pass on the pinned browser in cumulative Gate 4.

#### Mandatory capability probe

C2 implements `frontend/scripts/probe_webmcp.mjs --output <json>`, first used before Stage 1 lifecycle code and repeated before summary implementation and in every WebMCP CI job. It launches locked Chromium `159.0.8154.6` (Playwright `1.65.1`, Chromium revision `1255`) with `--enable-features=WebMCP`, on a local secure context. Check actual binary version, native `document.modelContext`, registration, discovery, tool execution, Hint annotations, abort cleanup, and unsupported-mode handling. Project each native tool into plain serializable name, description, input schema, and annotations before returning it through `page.evaluate`; never return native handles/window/function objects.

Separately record `page.webmcp.tools()` and `page.webmcp.callTool()` behavior. The installed adapter translates native `readOnlyHint`, `consequentialHint`, `untrustedContentHint` into `readOnly`, `consequential`, `untrustedContent`. Require native values `true`, `false`, `false`; in translated output require read-only `true` and allow the false fields to be absent, but never true. A translated omission is not evidence that the native false value was checked. The installed adapter also supports alternate native surfaces; that fallback must not silently satisfy the declared `document.modelContext` requirement.

This is a planned runtime contract, not a claim that a probe has passed. A mismatch in native surface, signature, version, serialization, annotations, or abort behavior is `BLOCKED` before dependent implementation; record it and propose reconciliation. Unsupported user browsers still render the dashboard without uncaught errors. Do not install shims or weaken assertions to manufacture capability support.

#### Tool contracts and lifecycle

Finish `frontend/src/webmcp.ts`, integrate registration in `frontend/src/main.tsx`, and protect the source via CODEOWNERS. Use only projections of the existing sanitized `showcase-export.json`:

| Tool | Exact accepted input | Successful payload |
|---|---|---|
| `get_campaign_summary` | Object with exactly `campaign_id: "fixture-mixed"` | `{ campaign_id, gate, completeness, evidence_ids }`; `gate` is the full recorded gate for that campaign, `evidence_ids` its sanitized evidence IDs. |
| `get_evaluation_summary` | Empty object `{}` | Existing offline `evaluation` summary: authored source, zero live trials, corpus/grader versions, case count, run IDs, baseline/candidate metrics, checks, threshold status, and promotion field. |

Tool descriptions and payloads explicitly preserve `source: "authored"` and `live_trials: 0` for evaluation. The separately displayed recorded live benchmark is outside this tool's initial interface. No paid invocation, private evidence, held-out rubric, arbitrary path/URL, or general campaign lookup.

Validate exact object shape in application handlers as well as advertised input schemas (`additionalProperties: false`). Reject absent campaign ID, wrong types, null/array inputs, unknown IDs, extra fields, and malformed arguments. Reject missing evaluation arguments at the application-handler boundary; the Playwright adapter may normalize omitted input to `{}`, so test that distinction in approved meta-tests instead of claiming the native UI can observe it. Invalid JSON may be rejected by the transport before handler invocation; record that boundary separately.

Use application-owned MCP-compatible result envelopes: `{ content: [{ type: "text", text: JSON.stringify(payload) }], isError: false }`. Handled argument errors return the same envelope with `isError: true` and a bounded public error message. Do not assume the native browser validates or supplies that envelope. No paths, stack traces, labels, credentials, or private data in errors.

Registration is transactional: one `AbortController` covers both tools, failure of the second registration aborts the first, repeated initialization is idempotent, explicit disposal aborts and resets state, and reinitialization after disposal is clean. Catch unsupported/failing registration without breaking the dashboard. Tool calls perform no writes to DOM, URL, storage, application data, gate decisions, or source artifacts. Host mocks and failure injection stay in the four lifecycle meta-tests.

#### Independent comparisons and three interface tests

L1 adds `harness/oracles/authored-evaluation-v1.json`, derived independently from pinned evaluator expectations in `evaluators/test_evaluate.py`, `evaluators/authored_examples.py`, and `evaluators/evaluate.py`, including denominators and zero-denominator states. Use evaluator interfaces as read-only sources; do not modify B-owned files or derive expected output by importing the frontend exporter. R1 independently reviews derivation. Record exact source revision, source digests, oracle bytes/digest, and reviewer verdict; no digest or approval is invented here.

The oracle is a test-only expectation outside browser assets and tool inputs. Keep it and all held-out truth/rubric data out of frontend imports, bundles, served fixture roots, browser evaluations, and investigator inputs. Tests compare expectations in the runner and read only public values from the page; add a bundle/input separation check. Never fix a mismatch by changing expected values to match the exporter.

Add `frontend/tests/webmcp.spec.ts` with three tests, inventoried using actual titles and reviewed assertions:

- `MCP-001`: Exact two-tool discovery, plain native projections, native Hint values, separately translated annotations, bounded execution and repeated initialization without duplicates. Explicit native rollback/disposal and unsupported cases remain in the lifecycle project.
- `MCP-002`: Exact valid campaign payload, strict invalid-input cases and bounded envelopes. Compare `gate` against `samples/reconciliation/expectations.json` at `mixed.gate` in the runner; compare completeness/evidence IDs against approved sanitized source and displayed DOM. Preserve both reasons, `BLOCKED`, and immutable provenance fields. Repeated calls leave observed state unchanged.
- `MCP-003`: Exact authored evaluation result, strict empty-object contract, and source/zero-live-trial labeling. Compare all exposed summary fields to the independent L1 oracle and the dashboard's offline section. Repeated calls leave observed state unchanged.

For purity checks, snapshot DOM, URL, localStorage, sessionStorage, and relevant application-owned data before/after repeated calls; compare source/bundle digests in the runner. Use a reviewed read-only data accessor if application state is not otherwise observable; do not add writable debug controls. Document what is observed and the limits of dynamic tests; unchanged observed values alone do not prove arbitrary code purity.

## 4. Proposed Commands, Cumulative Gates, and Evidence

The following command interfaces must be implemented by their owners before use. Exact report destinations are mandatory; nested orchestrators record their child commands, environments, reports, and exit codes. `ARTIFACTS` below describes paths, not an untrusted candidate override.

| Planned interface | Owner and defined behavior |
|---|---|
| `npm --prefix frontend run pw -- <arguments>` | C1: `playwright` from locked local dependencies, running in `frontend/`; used for browser installation, version reporting, and project-specific discovery. |
| `npm --prefix frontend run typecheck` | C1: `tsc --noEmit` over app, tests, fixture, config, and declarations. |
| `npm --prefix frontend run test:e2e` | C1: `playwright test --project=chromium`; JSON set via `PLAYWRIGHT_JSON_OUTPUT_FILE=artifacts/e2e/report.json` and `--reporter=json`. |
| `npm --prefix frontend run test:guard` | C1: `node scripts/test_guard_fixture.mjs --report artifacts/guard/report.json`; explicitly selects guard-meta and validates all eight executions. |
| `npm --prefix frontend run test:webmcp-lifecycle` | C2: `node scripts/test_webmcp_lifecycle.mjs --report artifacts/webmcp-lifecycle/report.json`; explicitly selects lifecycle project and validates four executions. |
| `npm --prefix frontend run test:hygiene` | C1: `node --test scripts/check_test_hygiene.test.mjs`. |
| `npm --prefix frontend run check:hygiene -- --project=<name> [--report <path>]` | C1: `node scripts/check_test_hygiene.mjs`; exact discovery saved per project plus optional execution check. |
| `npm --prefix frontend run test:canary` | C1: `node scripts/check_canary_regression.mjs --output artifacts/canary`; separate positive/mutated reports, state precheck, and attribution. |
| `npm --prefix frontend run test:webmcp` | C2: `playwright test --project=chromium-webmcp`; `PLAYWRIGHT_JSON_OUTPUT_FILE=artifacts/webmcp/report.json` and `--reporter=json`. |
| `node frontend/scripts/probe_webmcp.mjs --output <json>` | C2: capability checks in Stage 4, available before first lifecycle implementation; fail or block on mismatch. |
| `python -B harness/check_healer_scope.py --verifier-revision <sha> --candidate-revision <sha>` | L1: trusted full diff/overlay allowlist and candidate scope validation, with machine-readable result. |
| `node harness/check_pr_reports.mjs --project <name> --report <json>` | L1: independent trusted expected-set/outcome validation; report identity includes revisions/digests. |
| `node harness/verify_red_team_matrix.mjs --local --output <directory>` | L1: thirteen isolated local cases and explicit NOT RUN remote records; no remote mutation mode in ordinary CI. |
| `node harness/run_pr_verification.mjs --stage <1..4> --verifier-revision <sha> --candidate-revision <sha> --output <directory>` | L1: trusted cumulative launcher, restricted candidate workspace, complete command transcript, cleanup, and summary. |

Frontend package commands run with `frontend/` as their working directory, so their `artifacts/...` destinations are under that directory in the disposable workspace. Direct repository-root probe/red-team outputs are explicitly rooted under `frontend/artifacts/` and `harness/artifacts/`. Each gate gets its own workspace/output root; never reuse a stale report. The launcher must reconcile paths, not assume a JSON reporter file exists because a command exited.

### Cumulative command schedule

For each gate, invoke the trusted launcher from its accepted revision with actual full SHAs substituted for placeholders. These are planned commands, not commands run during the documentation edit:

```sh
node harness/run_pr_verification.mjs --stage 1 --verifier-revision <verifier-sha> --candidate-revision <candidate-sha> --output <gate-1-directory>
node harness/run_pr_verification.mjs --stage 2 --verifier-revision <verifier-sha> --candidate-revision <candidate-sha> --output <gate-2-directory>
node harness/run_pr_verification.mjs --stage 3 --verifier-revision <verifier-sha> --candidate-revision <candidate-sha> --output <gate-3-directory>
node harness/run_pr_verification.mjs --stage 4 --verifier-revision <verifier-sha> --candidate-revision <candidate-sha> --output <gate-4-directory>
```

The launcher records and runs these cumulative groups in dependency order, with bounded failure collection; it never skips a failed dependency and then calls the gate a pass:

| Gate | Required commands and checks |
|---|---|
| 1 | Trusted scope preparation and image build (locked dependencies and dashboard build from verifier only); verify image-provided Chromium; `node frontend/scripts/probe_webmcp.mjs --output frontend/artifacts/probe/report.json`; `npm --prefix frontend run typecheck`; `npm --prefix frontend run build`; ordinary discovery via `npm --silent --prefix frontend run pw -- test --project=chromium --list --reporter=json` saved to `frontend/artifacts/e2e/discovery.json`; JSON ordinary execution via `PLAYWRIGHT_JSON_OUTPUT_FILE=artifacts/e2e/report.json npm --prefix frontend run test:e2e -- --reporter=json`; `npm --prefix frontend run test:guard`; `npm --prefix frontend run test:webmcp-lifecycle`; independent `check_pr_reports.mjs` for all three executing projects. |
| 2 | All Gate 1 checks, plus `npm --prefix frontend run test:hygiene`; `check:hygiene` discovery and execution validation for `chromium`, `chromium-guard-meta`, and `chromium-webmcp-lifecycle`; `npm --prefix frontend run test:canary`; explicit KILLED attribution and baseline-owned scope tests. |
| 3 | All Gate 2 checks, plus pinned Python/reference preparation, `python -B harness/checks.py contracts`, all six established Python/export commands in Stage 3, workflow/configuration validation, and `node harness/verify_red_team_matrix.mjs --local --output harness/artifacts/red-team`. Record R12/R14 NOT RUN with the authorization boundary. |
| 4 | All Gate 3 checks, plus successful pre-summary-implementation probe and repeated job probe; `check:hygiene --project=chromium-webmcp`; JSON `test:webmcp`; execution revalidation using `check:hygiene --project=chromium-webmcp --report artifacts/webmcp/report.json` and independent `node harness/check_pr_reports.mjs --project chromium-webmcp --report frontend/artifacts/webmcp/report.json`; reviewed oracle provenance, bundle/input separation, DOM/offline comparisons, and native/translated annotation checks. Guard, lifecycle, canary, Python, and thirteen local red-team cases remain included. |

In the schedule, `check:hygiene` and `test:webmcp` abbreviate the complete npm interfaces in the command table. For each already executed project, run `npm --prefix frontend run check:hygiene -- --project=<name> --report <frontend-relative-report>` and the independent validator with the repository-relative path. Discovery for guard/lifecycle is explicitly selected and saved by their orchestrators. The first accepted verifier must undergo infrastructure review; a candidate cannot bootstrap its own trusted status by passing itself.

### Evidence contract and remaining acceptance

Every cumulative gate records exact commands and working directories, exit codes, verifier/candidate revisions, dependency/Node/Python/Playwright/browser versions, source/fixture/oracle digests, discovered/executed inventories, attempt counts, guard reason attribution, canary positive/mutated outcomes, lifecycle/probe results, and per-scenario red-team outcomes. Preserve failures and relevant diagnostics. Use `PASS`, `FAIL`, `NOT RUN`, or `BLOCKED` precisely; `KILLED` is a canary classification within a verification record, not an approval status. State limitations separately and bind independent review and human acceptance to the tested final SHA.

Projected outcomes remain acceptance goals: a correct generated test or valid locator repair can become a human-review candidate; weakened assertions or a known UI regression should be rejected or reported with evidence. The assertion scanner and this one mutant cannot establish universal semantic correctness. No gate here approves product release or alters deterministic campaign eligibility.

## 5. Pending Acceptance Checklist

- [ ] F01: Operational human review and credential boundary documented; zero required approving reviews; final-SHA acceptance; remote rules independently evidenced only when authorized.
- [ ] F02: Production guard runs exactly eight cases, with two passing controls and six attributed failures.
- [ ] F03: Categorized AST policies permit only declared ordinary, fixture/helper, WebMCP read-only, and meta operations.
- [ ] F04: Filesystem scanner rejects unapproved filenames/declarations; both R1a and R1b demonstrated.
- [ ] F05: Each project's exact discovery/execution inventory validated; no global exclusion hides meta-tests.
- [ ] F06: Separate temporary builds/strict servers, rendered mutation precheck, positive control, designated-step kill, and cleanup verified.
- [ ] F07: Assertion counts described and tested as deletion detection; broader semantic review recorded.
- [ ] F08: Trusted scope/configuration/fixture/inventory/reporters outside candidate control; infrastructure changes independently reviewed and human-accepted.
- [ ] F09: Pinned native capability probe passes before implementation and in WebMCP jobs; native versus translated fields and serialization checked separately.
- [ ] F10: Unsupported mode, duplicate initialization, rollback, and disposal tested in reachable lifecycle project; repeated tools preserve observed state.
- [ ] F11: Stable actual test identities, DASH-003 step attribution, duplicates, statuses, outcomes, and single attempts verified.
- [ ] F12: All four gates cumulative and reproducible, complete offline suites included, and evidence tied to immutable revisions.
- [ ] Authored evaluation oracle independently reviewed, source/digest recorded, and excluded from public assets/model/tool inputs.
- [ ] All thirteen local red-team cases meet expectations, including R7 passing control; R12/R14 remain NOT RUN until separately authorized and executed.
- [ ] Independent reviewer records final scope/security verdict and known limitations. Human accepts any trusted verifier promotion and any later merge against the final SHA.

**Current execution status:** Stage 1 container bootstrap PASS at verifier SHA `06a50ab582e1e9b6c19254964603df534b4794cd`: 8 ordinary checks pass, guard controls and six attributed fixture failures pass validation, 4 lifecycle checks pass, and cleanup/artifact collection pass. Chromium sandbox runs with only `CAP_SYS_CHROOT` in the capability bounding set; effective/permitted/ambient sets are empty. Independent review and exact-SHA human acceptance PASS, and the trusted same-SHA Stage 1 rerun PASS. Stages 2–4, thirteen local red-team cases, R12/R14 and CI execution remain NOT RUN. See `harness/container/implementation-record.json` and `harness/artifacts/container-accepted-stage1/` for accepted-run evidence; this does not authorize merge or deployment.
