# QualityOps AI MVP proposal

## Approval boundary

The human owner confirmed a33bc9dba103e321b4513ccf6b57ccf0b61c5106 as the frozen Stage 1 contract baseline. The wire version remains 2.0.0-draft.1. See contracts/CHANGES.md for compatibility history.

## Reference inventory

| Repository and inspected revision | Candidate for reuse |
|---|---|
| qa-features, e7c566ff831139889195643a1b906b7edab76f48 | features/auth/login.feature links SEED-1 to tagged acceptance criteria. Preserve the source bytes and revision. governance/approvals/seed-1-approved-v1.json is a separate approval artifact. |
| qa-ai-generation-pipeline, b0369e2ecb337dabe7cbb31437614807e2e3a417 | contracts/envelopes.json and tools/pytest_evidence.py are adapter references. The README separates isolated baseline runs and single-fault runs. Preserve that distinction in report parsing. Generation remains upstream. |
| qa-payroll-gate-eval, 77d6dc5b9d320d1ac6b95107491cc41bcba3d354 | scenarios/acc_ledger_outage.yaml separates fixture observations from scenario expectations. Use the fixture and deterministic grader pattern in src/payroll_gate/graders.py for investigator evaluation. Keep payroll-specific rules upstream. |

## Delivery dependencies and acceptance

The single ownership map is harness/ownership.json, referenced by AGENTS.md and consumed by the scope checker. Module owners keep tests in their module. The lead owns shared fixtures and integration tests. Reviewer access is read-only.

| Order | Owner | Dependency and acceptance |
|---|---|---|
| 0. Contract review | Lead and human owner | Review the three reconciled schemas, policy examples, identity semantics and separation fixtures. Human approves the contract baseline and ownership before worktree creation. |
| 1. Ingestion | A | Against the approved baseline, import two recorded campaigns. Validate provenance, expected matrix, actual bytes and completeness before atomic publication. Verify retries and conflicting imports. |
| 2. Gate | A | Consume verified evidence and approved policy. Replay all policy fixtures with no model dependency. Preserve failure and missing reasons together. |
| 3. Evaluation | B | After fixture and evidence interfaces are approved, build versioned held-out corpus and offline graders. Report actual trial denominators. |
| 4. Investigator | B | Exercise bounded evidence reads and recorded-response replay against the independent graders. Verify abstention, citation support, operational error handling and credential boundaries. Paid trials require separate authorization. |
| 5. Presentation | C | Build against approved sanitized recorded exports. Verify all three gate outcomes and all investigation statuses, including absent records. The C1 mixed-campaign flow passed local browser checks at `b7a61e99a4112ed5dd4022de7a356d83a47e6f32` on `stage1/c1-dashboard`. That revision supplies `frontend/README.md` with the run command and validated export digest for the Playwright exercise. |
| 6. Integration and independent review | Lead then reviewer | Assemble locally verified revisions only. Replay recorded evidence through the vertical slice. Review private data isolation, missing evidence and pure gate dependencies. Human decides promotion. |

After approval, independent fixture-based tasks may proceed in isolated worktrees while producer integration follows the dependencies above. Every handoff includes its tested revision, exact commands and captured outcomes.

## Approved development QA and investigator evaluation roadmap

This roadmap adds local development QA and extends B1/B2 acceptance using the existing v2 interfaces. Generated Playwright tests, proposed repairs, and deliberate UI changes belong in a disposable development workspace. The release gate continues to use verified campaign evidence and approved policy. Ordinary PR checks use local fixtures and offline replay.

| Task | Owner and paths | Start condition and evidence |
|---|---|---|
| B2 offline review | Independent reviewer, read-only | Finish the outstanding B2 review first. Record the exact reviewed revision, commands, findings, and verdict. B1 is available at `910e216`. Offline review passed on corrected snapshot `2d0b77c1`. See the [review record](harness/offline-review.md) for the full digest, prior failures and coverage limits. |
| B1/B2 evaluation and security regressions | B, `evaluators/` and `backend/investigator/`. Lead coordinates any shared integration tests under `tests/`. | Offline regressions passed in the B1 worktree. The review record includes replay commands, grading results and security coverage. |
| Playwright dashboard exercise | Lead, `harness/`; read-only independent reviewer | **Exercise and independent review complete locally** on dashboard commit `a85de9faab17d86450ac792a44fc9a86d37d4a66`; mixed campaign fixture SHA-256 `1bdda5cadd7c835f08123d29af8c56eb51c7356cdd9153bd34c865c0c84f0662`. The baseline passed; the locator repair passed on the renamed and baseline dashboards; the dropped-reason variant failed on the retained `INSUFFICIENT_EVIDENCE` assertion. Independent review PASS. User approved the locator repair on 2026-11-26; the exact locator already exists in `frontend/tests/mixed-campaign.spec.ts`, so no product code edit was needed. See [current exercise record](harness/playwright-review.md#current-main-replay-2026-11-26) and [evidence packet](harness/artifacts/playwright-dashboard-exercise-20261126/summary.json). The full generated test remains an exercise artifact and was not promoted. This was a host development run, not a new isolated-container gate acceptance. |
| Matched CLI/MCP/WebMCP comparison | Lead, `harness/`; read-only independent reviewer | **Complete; independent review PASS** on the same campaign and dashboard revision. CLI, Playwright MCP, and WebMCP all showed `BLOCKED` with `REQUIRED_FAILURE/x` and `INSUFFICIENT_EVIDENCE/y`; invalid campaign input was rejected; the native/adapter suite passed 3/3. CLI/MCP tokens are recorded as unmeasured. See [comparison record](harness/playwright-review.md#matched-climcpwebmcp-comparison-2026-11-26) and [evidence packet](harness/artifacts/playwright-interface-comparison-20261126/summary.json). Host development run only, not isolated-container acceptance. |

### B1/B2 evaluation acceptance

- Deterministic tests verify evidence identity and digest binding, citation resolution, tool authorization, budget enforcement, and identical canonical gate output with the investigator available and unavailable.
- One-turn evaluations grade a correct diagnosis, a plausible diagnosis with an irrelevant but resolvable citation, and a case requiring abstention against held-out truth. Report citation validity and claim support separately. The irrelevant citation earns zero claim-support credit.
- End-to-end replay checks the ordered tool calls, evidence actually returned, and final investigation status and findings. Feed the final v2 record unchanged to B1 and verify the grade. Keep grading expectations outside the reader and model inputs.
- Report **pass@3** as complete case groups with at least one acceptable trial divided by all complete case groups. Report **pass^3** as groups with three acceptable trials over the same denominator. Preserve individual failures and safety violations in both reports. An incomplete benchmark comparison fails closed. Use the existing 20-case, three-independent-trial protocol for separately authorized live runs. Repeated replay of one transcript verifies reproducibility.

### B2 defensive retrieval and security acceptance

Use the existing evidence reader with offline fixtures for missing, irrelevant, stale, and contradictory observations, plus direct and indirect prompt injection, cross-campaign access, synthetic sensitive-data canaries, and excessive tool use. Each case must declare allowed calls, allowed evidence IDs, expected investigation status, and permitted output. Verify that insufficient evidence yields `INCONCLUSIVE`, unauthorized reads disclose zero protected content, and investigator failure leaves the canonical gate output identical.

The independent reviewer records the case or applicability rationale for each entry in the [OWASP 2025 Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/?cat=253), pinned to the 2025 edition.

| OWASP entry | Review target |
|---|---|
| LLM01 Prompt Injection | Direct and evidence-embedded instructions |
| LLM02 Sensitive Information Disclosure | Canary redaction and cross-campaign read denial |
| LLM03 Supply Chain | Pinned dependency and fixture provenance review |
| LLM04 Data and Model Poisoning | Stale or contradictory fixture observations and evidence identity binding. Model training is outside the slice. |
| LLM05 Improper Output Handling | Structured result validation, permitted output and unchanged input to the B1 grader |
| LLM06 Excessive Agency | Read-only tool permissions, campaign scope and call budgets |
| LLM07 System Prompt Leakage | Verify authorized output excludes internal prompt content and grading data |
| LLM08 Vector and Embedding Weaknesses | The evidence reader uses an identifier allowlist. Verify this applicability decision against the reviewed revision. |
| LLM09 Misinformation | Irrelevant citations, claim support and abstention |
| LLM10 Unbounded Consumption | Excessive reads and invocation, token, timeout and cost bounds |

### Playwright exercise and PR evidence

Use the [exercise record](harness/playwright-review.md) to capture the independent verdict and matched runs. Use the mixed campaign fixture whose expected decision is `BLOCKED` with both `REQUIRED_FAILURE` and `INSUFFICIENT_EVIDENCE`. Give the Planner that criterion and review its Markdown before running the Generator. Exercise the Healer on two disposable UI variants.

| UI variation | Required independent verdict |
|---|---|
| Control gets a new accessible name and behavior remains correct | Accept a locator repair only after verifying it selects the intended control and preserves both reason assertions. |
| UI still shows `BLOCKED` but drops the missing-evidence reason | Retain the failure and report the regression. Reject deleting the assertion, skipping the test or increasing retries to get a pass. |

Record the criterion, original failure trace, proposed diff, reviewer rationale and replay artifacts for both correct and faulty UI. The accepted test must pass the correct UI and catch the known regression on its first attempt. Use the [Playwright Test Agents documentation](https://playwright.dev/docs/test-agents) for Planner, Generator and Healer.

Use the same local campaign inspection for the interface comparison. Pin browser and package versions, model, starting state and success criterion in the evidence packet.

| Interface | Use and evidence |
|---|---|
| Playwright CLI | Short, repeatable coding-agent task. Save reproducible commands and the asserted UI result. |
| Playwright MCP | Interactive exploration needing successive structured observations. Save the tool transcript and verify the same UI result independently. |
| WebMCP | Exercise a fixture-only campaign summary tool registered by the page. Verify discovery, valid and invalid inputs, and agreement with the displayed summary. Both browser interfaces can exercise the page capability. |

Record completion and input/output tokens for matched CLI and MCP runs. Mark token use **unmeasured** when telemetry is unavailable. See the [CLI and MCP comparison](https://github.com/microsoft/playwright-mcp#playwright-mcp-vs-playwright-cli) and [Playwright v1.64 WebMCP release notes](https://playwright.dev/docs/release-notes#version-164).

### Staged PR Verification Plan v7 (Agent Harness, Guardrails & WebMCP)

The four-stage design and approved shared Linux/amd64 container first slice for PR verification guardrails, context error guards, AST policies, an isolated paired mutation canary, complete offline CI, and bounded read-only WebMCP tools are documented in [docs/pr-verification-webmcp-harness-plan.md](docs/pr-verification-webmcp-harness-plan.md). It preserves F01–F12 traceability and the existing ownership map. Stages 1–3 were implemented, independently reviewed, human-accepted, and merged to `main`. Stage 4 verifier SHA `6ea930c18214ed3bda95b9d10c4b9b3a5060daf5` was independently reviewed and human-accepted with runtime-policy SHA-256 `70c2af797f09b01d27f47c3e42436e290da4eddea86a3c35767e42d16e4dd359`; the accepted-run record SHA-256 is `e5b2ca22bb481a85e01c30620f84e6e28321169b37b68347d9d25fefb3ac71b2`. Its Gate 4 accepted run passed at `/private/var/tmp/qualityops-stage4-accepted-final/summary.json`. PR #9 merged at `4baf009ebdf472ce053779af82ed6b8754d5a2cf`; required CI run `45642698048` passed all three checks. The authored-evaluation oracle has a separate independent PASS review. H1 is complete: active `main` ruleset `28085830` has no bypass actors, and remote R12/R14 enforcement checks both PASS. See `harness/artifacts/h1-remote-enforcement-20261125/summary.json` and [implementation evidence](harness/container/implementation-record.json). The local GitHub CLI credential was removed and the connected GitHub app now asks before writes; the CLI OAuth grant was not revoked globally. The Planner/Generator/Healer dashboard exercise completed locally with independent review PASS on 2026-11-26; human approval of the locator repair is recorded in `harness/playwright-review.md`. The matched CLI/MCP/WebMCP comparison completed locally with independent review PASS on 2026-11-26; see `harness/playwright-review.md` and `harness/artifacts/playwright-interface-comparison-20261126/summary.json`. Pages deployment was authorized by the human on 2026-11-26 and completed successfully from main SHA `6c66744dad48120ff7bed57eaf218a4cef8a2be4` (PR #11, workflow run `45797108356`, deployment `8082011684`). The live dashboard at `https://camiloavilacm.github.io/QualityOps-AI/` serves the built JavaScript and CSS with byte-for-byte SHA-256 matches; details are in `harness/container/implementation-record.json`.

