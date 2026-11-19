QualityOps AI — Product and Engineering Specification
Status: Proposed; contract freeze pending
Version: 0.1.0
Purpose: Small, reproducible showcase of evidence-driven release eligibility and evaluated, read-only AI failure investigation.
1. Problem and audience
Quality engineers must reconcile test results, requirements, and diagnostic artifacts from different runners. A green summary may conceal missing evidence; an AI-generated explanation may be plausible but unsupported. QualityOps AI consumes versioned evidence from existing QA projects, produces a deterministic release eligibility decision, and separately evaluates AI-generated failure investigations.

Audience: QA engineers, SDETs, QA architects, and technical leads. This is not a replacement for test execution or reporting products such as Allure or ReportPortal.
2. Approved scope
The MVP has exactly four core capabilities:
1. Versioned evidence ingestion: validate, normalize, and preserve provenance and integrity of test campaign evidence.
2. Deterministic release gate: compute an independently replayable decision from validated evidence and an explicitly versioned policy.
3. Read-only AI failure investigation: investigate failed or incomplete campaigns using bounded evidence-reading tools and Amazon Bedrock Converse; return cited, structured findings or explicit uncertainty.
4. Investigator evaluation: measure diagnosis accuracy, citation validity/support, abstention behavior, schema validity, safety, cost, and latency using a versioned ground-truth corpus.
A static React/TypeScript dashboard is a presentation layer for recorded results, not a fifth core capability.
Non-goals
- No runtime AI-generated tests, application code, or self-healing.
- No automatic release approval, merge, deployment, or code modification by the investigator.
- No test execution framework, replacement for existing QA repositories, or general orchestration service.
- No public anonymous Bedrock invocation endpoint.
- No enterprise identity, multi-tenancy, billing, or production-grade operational portal.
- No modification of the existing reference repositories.
3. Source systems and ownership
Reference repositories (read-only):
- camiloavilacm/qa-features: approved acceptance criteria, test contracts, versioned campaign evidence, and traceability conventions.
- camiloavilacm/qa-ai-generation-pipeline: existing synthetic fault variants and baseline/mutant evidence where suitable for evaluation fixtures; no runtime code generation.
- camiloavilacm/qa-payroll-gate-eval: reusable patterns for Converse, fixtures, deterministic grading, and model/prompt comparison. Do not assume its payroll-specific prompts or grading labels apply directly.
Import existing artifacts through adapters. Never assume the upstream result format without inspecting a pinned revision. Record the source repository and commit SHA for each imported bundle. Upstream artifacts are not modified.
4. Architecture and technology boundaries
- Evidence ingestion and gate: Python, JSON Schema Draft 2020-12, local CLI for reproducible execution.
- Canonical evidence storage: private Amazon S3 with immutable/versioned object naming and SHA-256 integrity checks; local filesystem adapter for development/tests.
- AI investigator: Python AWS Lambda, raw Amazon Bedrock Converse API, strictly read-only evidence tools.
- Evaluation: Python deterministic graders, versioned fixtures, recorded-response replay, optional explicitly authorized live Bedrock runs.
- Dashboard: static React + TypeScript, reading sanitized, versioned JSON artifacts; GitHub Pages is the preferred MVP host.
- CI: GitHub Actions for contract validation, unit/integration/security tests, offline replay, and protected live evaluation when explicitly authorized.
Do not introduce DynamoDB, CloudFront, an application database, an agent framework, or an always-on API unless a demonstrated requirement cannot be met otherwise and a scope change is approved.
Trust boundaries
1. Test logs, traces, and application output are untrusted data.
2. Canonical raw evidence is private; public artifacts are separately sanitized and allowlisted.
3. The release gate consumes only validated evidence and policy; it must not consume model output.
4. The investigator may read approved evidence but cannot modify evidence, policies, decisions, code, or deployment state.
5. Evaluation ground truth is inaccessible to the model and its evidence-reading tools.
5. Versioned contracts
Use contracts/v2/ for JSON schemas and examples. Codex must inspect and reconcile any already-created contracts rather than overwrite them indiscriminately. Incompatible changes require a new schema version and explicit approval.
5.1 Evidence bundle
At minimum, capture:
- schema_version, campaign_id, and collection timestamp.
- Source repository, commit SHA, workflow/run identifier when available.
- Expected execution matrix/test identifiers and observed executions.
- Acceptance-criterion or requirement references where available.
- Per-execution result: passed, failed, skipped, error, or explicitly missing as appropriate to the schema.
- Evidence observation status: complete, partial, unavailable, or error.
- Artifact IDs, types, content digests, and safe retrieval references.
- Completeness/integrity validation results and provenance of imported artifacts.
Do not fabricate missing executions or assume that an omitted test passed. Keep the distinction between execution outcome and observation completeness.
5.2 Gate decision
At minimum, capture:
- schema_version, campaign_id, policy_version, canonical input digest.
- Exactly one decision: ELIGIBLE, BLOCKED, INCONCLUSIVE.
- Deterministic machine-readable reason codes and affected execution/evidence IDs.
- Evaluated timestamp as metadata, excluded from the canonical reproducibility comparison where appropriate.
5.3 Investigation result
At minimum, capture:
- schema_version, campaign and investigation IDs.
- Status: DIAGNOSED, INCONCLUSIVE, or ERROR (distinct from gate decisions).
- Optional root-cause category and evidence-supported explanation.
- A list of causal claims, each with resolvable evidence IDs.
- Limitations/uncertainties, model ID, prompt digest, tool contract version.
- Token usage, duration, estimated cost, and execution/fixture identifiers.
Citations must point to actual evidence objects, not invented URLs or raw unsanitized log text. Structured schema validity alone does not prove that a citation supports a claim.
5.4 Evaluation case and report
Each case identifies a versioned model-visible evidence fixture and separately stored ground truth: expected root-cause category or expected abstention, allowed alternatives if justified, and supporting evidence mappings. Reports include corpus version, model/prompt/configuration, grader version, individual trials, aggregate metrics, and comparison to baseline.
6. Deterministic release policy
The gate is a pure, deterministic function of a validated evidence bundle and versioned policy. No network calls, model calls, random behavior, or wall-clock-dependent decisions are allowed in the decision function.
- BLOCKED: at least one mandatory policy/test failure is independently verified against trusted source evidence, even if other evidence is incomplete.
A partial failure or a self-reported failure without independent verification contributes an insufficient-evidence reason. The mandatory execution matrix comes from trusted policy or contract configuration.
- INCONCLUSIVE: no confirmed blocking failure exists, but required evidence is missing, partial, unavailable, erroneous, untrusted, or otherwise insufficient to establish eligibility.
- ELIGIBLE: every required policy/test passes and all required evidence is complete, valid, and trustworthy.
Invalid schema or failed integrity checks must fail closed at ingestion; they must never be represented as ELIGIBLE. The CLI may report an ingestion error rather than emit a valid gate decision for untrusted input. Do not conflate this with an AI ERROR status.

Decision ordering is BLOCKED > INCONCLUSIVE > ELIGIBLE, but preserve every applicable reason code. A reproducibility check compares canonical decision content, excluding nonsemantic timestamps and presentation metadata.
7. Evidence ingestion and integrity
- Validate schema version and all required fields.
- Verify SHA-256 against artifact bytes and reject tampering.
- Preserve source revision, artifact identity, and evidence lineage.
- Support idempotent re-import of an identical bundle; reject conflicting content under the same immutable identifier.
- Avoid partial published bundles: validate and stage before atomically publishing a manifest/reference.
- Treat missing and partial observations as first-class states.
- Sanitize before sending data to Bedrock or publishing to the dashboard.
Required acceptance fixtures
Provide at least:
1. Valid complete passing campaign → ELIGIBLE.
2. Valid complete campaign with confirmed required failure → BLOCKED.
3. Missing required execution or partial observation, without confirmed failure → INCONCLUSIVE.
4. Confirmed failure plus missing evidence → BLOCKED, with both reasons retained.
5. Tampered artifact or invalid digest → ingestion rejection, never ELIGIBLE.
6. Duplicate import with identical bytes → idempotent; conflicting duplicate → rejection.
The existing sample containing only Gherkin is a requirements/provenance fixture, not proof of an executed passing campaign.
8. Read-only AI investigator
Use raw Bedrock Converse; no Strands dependency in MVP. The investigator may be invoked locally or through a protected workflow/Lambda role. Do not expose unauthenticated public inference.

Approved conceptual tools:
- list_failures(campaign_id)
- read_test_assertion(evidence_id)
- read_evidence(evidence_id)
- read_requirement(requirement_id)
- read_sanitized_trace(evidence_id)
Implement only the tools needed by the actual fixtures. Enforce allowlisted identifiers, least privilege, bounded output, timeouts, and redaction. Model instructions embedded in evidence have no authority.

The investigator must:
- Return INCONCLUSIVE when evidence is insufficient for a supported root-cause claim.
- Return ERROR for operational failures (such as unavailable Bedrock) without altering the release decision.
- Cite each causal claim with evidence IDs that resolve within the authorized evidence bundle.
- Never see ground-truth labels during investigation.
- Never change release policies, gate decisions, or source evidence.
- Record model/prompt version, usage, latency, and estimated cost.
9. Evaluation design
Corpus
Target 20 versioned scenarios:
- 15 known seeded defects with ground-truth root-cause categories.
- 3 insufficient/missing-evidence scenarios that require abstention.
- 2 intermittent/flaky-evidence scenarios requiring calibrated uncertainty rather than a fabricated definitive cause.
Reuse existing mutant/fault artifacts when they match the investigator's evidence format. Do not claim 20 cases are complete until they exist and are validated. Keep held-out ground truth separate from model-visible fixtures.
Metrics
- Diagnosis accuracy: correct root-cause category on diagnosable trials / all diagnosable trials.
- Citation validity: resolvable cited evidence IDs / all emitted citations.
- Claim support: supported causal claims / all evaluated causal claims, using explicit evidence mappings and documented review for ambiguous cases.
- Correct abstention: correct INCONCLUSIVE results / all required-abstention trials.
- Invalid-output rate: schema/tool-protocol-invalid trials / all attempted trials.
- Safety violations: unauthorized tool operations, leakage, or prompt-injection compliance.
- Cost and latency: per-investigation estimated USD cost, tokens, duration, and aggregate p50/p95.
Report denominators and zero-denominator cases explicitly. Do not equate a valid citation identifier with evidentiary support.
Protocol
- Run three independent trials per scenario for an initial live benchmark (60 trials/configuration).
- Pin corpus version, fixture hashes, model ID, region, prompt digest, inference settings, tool contract, and grader version.
- Keep offline recorded-response replay distinct from live nondeterministic model evaluation.
- Compare baseline and candidate on identical case sets and grading rules.
- Treat missing or incomplete trials as an invalid comparison, not a pass.
Initial candidate promotion thresholds
- Diagnosis accuracy at least 80% on diagnosable trials.
- Citation validity 100%.
- Unsupported causal claims 0 on the evaluated corpus.
- Correct abstention 100% on required-abstention trials.
- Unauthorized operations 0.
- Invalid structured outputs 0.
- Estimated cost per investigation no more than US$0.10.
- Initial p95 latency target under 20 seconds, measured and reported.
- No regression against the accepted baseline on diagnosis accuracy, claim support, or abstention.
These are proposed targets, not achieved results. A failed model benchmark is a legitimate showcase outcome; it blocks promotion of that candidate, not completion of the evaluation framework.
CI
- On normal PRs: offline schema checks, unit/integration/security tests, deterministic grading, and recorded-response replay; no paid inference.
- On explicitly authorized model/prompt changes: protected live evaluation and comparison to accepted baseline. The protected result must be required for candidate promotion.
- Do not permit an untrusted PR to obtain model credentials or invoke privileged workflows.
10. Security and safety
Threats include prompt injection through logs, unauthorized evidence access, secret/PII leakage, fabricated citations, malicious artifact references, unbounded model/tool usage, and AI contamination of release decisions.

Controls:
- Evidence is always untrusted data; no instruction execution from traces/logs.
- Private canonical evidence and separately sanitized public export.
- Read-only evidence tools, IAM least privilege, explicit allowlists, and bounded retrieval.
- Reject path traversal, symlink escape, arbitrary URLs, and unapproved S3 keys.
- Test redaction with synthetic secret canaries; never log raw credentials, tokens, or sensitive personal data.
- Validate tool inputs and model outputs against schemas.
- Enforce timeouts, token budgets, invocation limits, and estimated-cost caps.
- Require independent deterministic tests showing model output cannot alter the release gate.
- Use GitHub OIDC rather than stored long-lived AWS keys where AWS access is necessary.
11. Dashboard and publication
The static dashboard displays recorded campaign evidence, gate decisions, investigation findings, and evaluation comparisons. All displayed counts, percentages, and costs must come from validated published artifacts. Show incomplete/missing data explicitly. Provide evidence links using sanitized stable identifiers.

Publishing must be a distinct controlled step from ingestion. Never publish private raw evidence, ground truth meant to remain held out, or credentials. The dashboard must function without a live API or database.
12. Milestones and definition of done
Phase 1 — Contracts, ingestion, and gate (3–4 developer days)
Deliver: schemas, positive/negative fixtures, importer, integrity checks, pure policy engine, deterministic tests.
Done when two actual recorded campaigns can be imported, fixture decisions match expected outcomes, tampering is rejected, and decisions replay identically offline.
Phase 2 — Ground truth and evaluation engine (4–6 developer days)
Deliver: 20-case target corpus, separate ground truth, graders, recorded-response replay, report schema, comparison command.
Done when offline grading correctly distinguishes correct, wrong, unsupported, invalid, and abstaining responses; report generation is reproducible. If the corpus is not yet complete, report the exact count and keep the milestone open.
Phase 3 — Investigator and live evaluation (4–6 developer days)
Deliver: Bedrock Converse investigator, bounded tools, structured output, protected invocation, measured live evaluation, model/prompt promotion check.
Done when an authorized live benchmark completes and the promotion check correctly accepts/rejects candidates under the declared policy; investigator failures never affect the release gate.
Phase 4 — Dashboard and showcase (3–5 developer days)
Deliver: static dashboard, sanitized publication pipeline, recorded demonstrations, architecture and threat-model documentation.
Done when a visitor can inspect a real campaign, replayable gate decision, cited investigation, and baseline/candidate evaluation report without AWS credentials.

Effort is an estimate, not a commitment. Prioritize one complete vertical slice before extending the corpus or polishing the UI.
13. Repository layout
qualityops-ai/
├── AGENTS.md
├── SPEC.md
├── PLAN.md
├── .agents/skills/
├── contracts/v2/
├── samples/
├── backend/
│   ├── ingestion/
│   ├── gate/
│   └── investigator/
├── evaluators/
│   ├── fixtures/
│   ├── ground_truth/
│   ├── graders/
│   └── prompts/
├── frontend/
├── tests/
├── infrastructure/
├── .github/workflows/
├── docs/
└── README.md
14. Engineering execution and approval boundaries
SPEC.md defines product requirements; contracts/v2/ defines machine-readable interfaces; PLAN.md defines task breakdown; AGENTS.md defines agent operating rules. If they conflict, stop and request human reconciliation. Do not silently rewrite approved scope or schemas.

Contract freeze requires:
1. Reconciliation of all three schemas with this specification.
2. Passing schema and fixture validation.
3. Explicit gate-policy examples including negative cases.
4. Confirmation of ground-truth isolation and read-only investigator boundary.
5. Approved agent file ownership and integration order.
6. Human approval of the contract-freeze report.
Until then, do not delegate implementation, create worktrees, deploy infrastructure, run paid Bedrock evaluations, push changes, or merge PRs without explicit authorization.
Appendix — Public project description
QualityOps AI — Evidence-Driven Release Gates and AI Failure Investigation. An engineering showcase integrating versioned automated test evidence, reproducible release decisions, read-only AI failure investigation, and ground-truth evaluation using Python, TypeScript, React, GitHub Actions, AWS Lambda, and Amazon Bedrock. Features are described as proposed until verified by executable results.