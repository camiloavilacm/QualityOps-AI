# Threat Model & Security Controls

QualityOps AI enforces five explicit trust boundaries defined in [SPEC.md](../SPEC.md) §4 and §10:

1. **Untrusted Evidence Data:** Test logs, traces, application outputs, and model responses are untrusted data—never instructions.
2. **Private vs. Public Data Boundary:** Canonical raw evidence, source receipts, and held-out evaluation ground truth stay private; public dashboard exports are separately generated and allowlisted.
3. **Pure Gate Isolation:** The deterministic release gate consumes only validated evidence and versioned policy—never model output, prompts, or AI evaluation results.
4. **Read-Only Advisory Investigator:** The investigator can read allowlisted observations for one campaign; it cannot mutate evidence, policies, gate decisions, code, or deployments.
5. **Ground-Truth Isolation:** Held-out labels, expected categories, and grading rubrics are inaccessible to the model and its tools.

## OWASP 2025 Top 10 for LLM Applications Mapping

Independent offline verification is recorded in [harness/offline-review.md](../harness/offline-review.md).

| OWASP 2025 Entry | Threat | Implemented Controls | Verification |
|---|---|---|---|
| **LLM01 Prompt Injection** | Direct selector injection or malicious instructions embedded in evidence | Strict regex selector allowlist; known embedded instruction sanitized in pinned projection; evidence passed as data only; tool arguments and IDs rebuilt by host. | `backend/investigator/test_investigator.py`, `test_retrieval.py` |
| **LLM02 Sensitive Information Disclosure** | Secret/PII leakage or cross-campaign data exfiltration | Canary redaction checks (`PRIVATE_TERMS`, `PUBLIC_WORDS`); campaign-scoped allowlisted reads; sanitized dashboard exports exclude raw paths and ground truth. | `test_investigator.py`, `test_retrieval.py`, `tests/test_vertical_slice.py` |
| **LLM03 Supply Chain** | Tampered fixtures or unpinned dependencies | SHA-256 pinning for manifests, artifacts, model-visible projections, ground truth, and schemas; pinned `harness/requirements.txt` and `frontend/package-lock.json`. | `test_importer.py`, `test_evaluate.py`, `export_* --check` |
| **LLM04 Data and Model Poisoning** | Stale manifests, tampered artifacts, or contradictory observations | Digest verification before inference; contradictory observations force `INCONCLUSIVE`; modified held-out truth fails before grading. | `test_importer.py`, `test_retrieval.py`, `test_evaluate.py` |
| **LLM05 Improper Output Handling** | Malformed JSON, fabricated citations, or altered claims | Strict JSON schema validation; allowlisted citation resolution against retrieved IDs; verbatim observation match required for `DIAGNOSED`; unchanged v2 record passed to grader. | `test_investigator.py`, `test_evaluate.py` |
| **LLM06 Excessive Agency** | Unauthorized writes, arbitrary file/URL reads, or gate tampering | Single read-only `read_evidence` tool; `O_NOFOLLOW` descriptor reads; static AST + runtime tests proving gate output is identical during investigator outage. | `test_investigator.py`, `tests/test_vertical_slice.py` |
| **LLM07 System Prompt Leakage** | Disclosure of internal prompt or held-out rubric | Held-out truth excluded from investigator imports and inputs; strict structured output fields disallow free-form prose export. | `test_investigator.py`, `tests/test_vertical_slice.py` |
| **LLM08 Vector and Embedding Weaknesses** | Embedding poisoning or retrieval drift | **Not applicable:** Retrieval uses an explicit campaign evidence ID allowlist with no vector index or embedding search. | Verified in `backend/investigator/evidence.py` |
| **LLM09 Misinformation** | Plausible but unsupported claims or overconfident guesses on partial/flaky evidence | Citation validity and claim support graded separately; irrelevant resolvable citations earn zero support credit; ambiguity patterns trigger `INCONCLUSIVE`. | `test_evaluate.py`, `test_retrieval.py` |
| **LLM10 Unbounded Consumption** | Runaway tool loops, token spikes, or cost overruns | Hard caps: `MAX_CALLS = 4`, `MAX_OUTPUT = 256`, `MAX_WIRE = 8192`, `COST_LIMIT = $0.10` pre-call reservation, `total_max_attempts = 1`, `<= 20s` deadline. | `test_investigator.py`, live benchmark (`max $0.0031`, `p95 2.38s`) |

## CI & Operational Safeguards

- **Least-Privilege CI:** [.github/workflows/ci.yml](../.github/workflows/ci.yml) runs offline with `permissions: contents: read`, zero cloud credentials, and no `pull_request_target` execution.
- **No Unauthenticated Public Inference:** The static dashboard contains no Bedrock endpoint or AWS keys; live evaluations are run only by explicitly authorized operators.
- **Residual Risks:** Provider-side billing enforcement and remote cancellation of in-flight Bedrock requests remain outside client-side timeout guarantees; general adversarial resistance to novel prompt-injection phrasing requires ongoing evaluation.
