# QualityOps AI MVP proposal

## Approval boundary

Stage 0 covers contract reconciliation. Freeze requires separate human approval. The active draft and its compatibility history are documented in contracts/CHANGES.md.

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
| 5. Presentation | C | Build against approved sanitized recorded exports. Verify all three gate outcomes and all investigation statuses, including absent records. |
| 6. Integration and independent review | Lead then reviewer | Assemble locally verified revisions only. Replay recorded evidence through the vertical slice. Review private data isolation, missing evidence and pure gate dependencies. Human decides promotion. |

After approval, independent fixture-based tasks may proceed in isolated worktrees while producer integration follows the dependencies above. Every handoff includes its tested revision, exact commands and captured outcomes.
