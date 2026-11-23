# B1/B2 offline acceptance review

The human approved contract revision `a33bc9dba103e321b4513ccf6b57ccf0b61c5106`. The evaluator and investigator changes were exercised in the B1 worktree based on `910e216ebff0aba9720ddaeabbad03944237208a`. All model responses used here are authored offline. The corpus contains 20 cases. The measured live trial count is zero.

## Review history

The independent reviewer rejected B2 snapshot `e2be1fea200c30796be67967fb11d4fd5d91572dd984aebf293df6e1f5cc6a73` because valid requests failed at the evidence loader. Snapshot `c1bfacbcf044cbb13c7241ad7cac394e33837b0c44166d9ac90a4e72d42a1e02` restored scoped reads and verified two registered A1 publications. Its 11 focused tests passed, but an independent probe reversed the polarity of a retrieved observation and obtained a diagnosis. That snapshot also received FAIL.

## Independent OWASP review

The mapping covers the offline reader, investigator and grader against the [2025 OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/?cat=253).

| 2025 risk | Observed coverage or applicability |
|---|---|
| 01 Prompt injection | The direct instruction was rejected at the selector boundary. A known embedded instruction in the pinned projection was removed before retrieval. Coverage is specific to those input paths. |
| 02 Sensitive information disclosure | Canary checks inspect exported output and tool messages. The cross-campaign case returns zero protected observations. |
| 03 Supply chain | Evidence and projection digest checks cover input provenance. Dependency builds and model supply chains are outside this replay. |
| 04 Data and model poisoning | A stale manifest is rejected before inference. Contradictory observations trigger abstention. Modified held-out truth fails before grading. Training is outside this system. |
| 05 Improper output handling | The suite checks structured output, unauthorized citations, rejected model text and v2 result validation. |
| 06 Excessive agency | Only scoped evidence reads are available. Gate replay verifies identical canonical content during investigator failure. |
| 07 System prompt leakage | The suite checks held-out isolation and output restrictions. It does not establish general resistance to system prompt extraction. |
| 08 Vector and embedding weaknesses | Retrieval uses an allowlist of campaign evidence identifiers. There is no vector index or embedding search in this path. |
| 09 Misinformation | B1 gives zero support credit to a plausible claim with an irrelevant but resolvable citation. Independent review also tested a contradiction against the actual retrieved text. |
| 10 Unbounded consumption | The suite exercises excessive calls, token and cost reservations, timeouts and transport configuration. Provider billing and remote cancellation require separate evidence. |

## Reproduce locally

From the B1 worktree with the pinned harness dependency installed, run:

```sh
python -B -m unittest -q backend.ingestion.test_importer backend.gate.test_gate
python -B -m unittest -q backend.investigator.test_investigator backend.investigator.test_retrieval
python -B -m unittest discover -s evaluators -p test_evaluate.py
shasum -a 256 backend/investigator/* | shasum -a 256
```

The review used the interpreter at `../qa-workspace/qa-features/.venv/bin/python`. The B1 tests cover complete three-trial grouping with authored test values, one-turn grading and full tool-transcript replay into the unchanged grader input. Task and safety scores use the same case denominator. A repeated replay supplies reproducibility evidence only.

## Final verdict

**PASS for the offline regression suite.** The independent reviewer tested B2 snapshot `2d0b77c16b5494827d1a7dc81ad252dc6b2dcc973b0e7a63df789b3ca66e4cb6`. Identical evidence reads produced a diagnosis for the verbatim mechanism and `INCONCLUSIVE` with no claims for the reversed predicate. All 12 B2 tests and 15 B1 tests passed. The lead also replayed the 32 ingestion and gate tests successfully. B1 graded the unchanged positive B2 example as having two resolvable citations, an incorrect category, and a claim requiring review under the pinned rubric. The review closes the observed contradiction defect. Live performance and promotion are unmeasured.
