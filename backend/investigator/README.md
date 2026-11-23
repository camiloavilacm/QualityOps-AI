# B2 offline failure investigator

Use the operator CLI from the repository root with Python 3.11+ and the existing ingestion dependency on `jsonschema`. The examples replay authored Converse replies with synthetic IDs and usage. Their output is labeled `authored-offline-example`.

```sh
python -B -m backend.investigator.examples failed
python -B -m backend.investigator.examples partial
python -B -m backend.investigator.examples projected
python -B -m backend.investigator.examples outage
python -B -m unittest -v backend.investigator.test_investigator backend.investigator.test_retrieval
```

The frozen failed and partial reports exercise verified reads and abstention. The projected example exercises a cited proposed mechanism. The outage example exercises an operational `ERROR`. Each command emits a v2 investigation record under `result` and a linked `audit` sidecar. The sidecar holds request IDs, region, effective budgets, rate inputs and the tool schema digest. It is operator data. The investigation schema stays frozen.

## Private callable

`backend.investigator.investigator.invoke({"fixture_id": ...}, backend=...)` returns `(result, audit)`. Call it from an authenticated operator process that is authorized for the fixture catalog. It accepts only a fixture selector. Configure the injected raw Converse client, model, region, transport and prices in trusted code. This module installs no endpoint, constructs no AWS client and contains no live invocation command.

The catalog allows the frozen `fixture-fail`, `fixture-mixed`, and `fixture-partial` and the 20 IDs in the pinned B1 model-visible corpus. Frozen manifest hashes are anchored to the lead-approved B1 checkout. The loader checks each report digest and matches the report to the manifest before constructing an execution summary. B1 uses the existing hash-pinned projection. The B1 partial alias `c-b3235f20f6d8d0a0` retains `fixture-partial` and its original manifest digest. Other B1 evidence hashes cover the original projected JSON serialized with two-space indentation, sorted keys and a final newline. Selection or integrity failure raises a fixed `ValueError` before inference.

The model initially receives a completeness indicator and the authorized evidence IDs. The sole tool reads one scoped, bounded observation. It has no access to paths, URLs, raw logs, policies, credentials or evaluation truth. B1 summaries come from the reviewed pinned projection. The single embedded instruction in that snapshot is removed by exact replacement. Updating the projection requires renewed review of its text before approving a new digest. The investigator rebuilds tool messages from validated arguments and assigns its own conversation IDs.

A final diagnosis supplies a bounded category, statement, exact observation excerpt and one to four retrieved citation IDs. The statement must reproduce one complete cited observation verbatim and contain its quoted mechanism. This preserves qualifiers and polarity. Paraphrases require abstention. Ambiguous and execution-only evidence yields `INCONCLUSIVE`. B1 independently grades claim support against held-out truth. Invalid protocol, unauthorized reads and exhausted budgets yield `ERROR`. A caller can supply a trusted run ID to bind the result to its recorded trial.

A private operator can also supply a registry of selectors mapped to `evidence.Publication` entries. Each binds the campaign, bundle location, expected manifest digest, independent receipt location and expected receipt digest. A1 normalization is replayed before any tool response. Only bounded derived execution summaries and artifact identifiers enter the conversation. The audit includes the projection digest, fixture selector and offline mode.

## Budgets and backend requirements

The core allows at most four Converse requests, 256 requested output tokens per call, four reads per tool response and 8 KiB per reconstructed request. Offline scripts use an explicit input token ceiling. The live configuration requires the supported model ID and fixed input reservation in investigator.py. This bound and the output ceiling limit the total reservation to four calls. Each call first reserves its full input and output ceiling at the trusted USD-per-token rates. The next reservation uses the prior reported costs. If a reservation would exceed $0.10 or rates are missing, the call is denied. Only use rates covering every enabled billable token class. Prompt caching and additional inference modes are excluded. The stub examples explicitly price the scripted backend at zero. The repository supplies no actual model rates.

An injected SDK client must use `total_max_attempts=1` with positive connect and read timeouts whose sum fits the configured request deadline. The caller owns the client configuration and must avoid retry wrappers. The operator callable waits at most the remaining investigation deadline or the per-request deadline, whichever is shorter. Defaults are three seconds per request and 12 seconds per investigation, with a hard configuration ceiling of 20 seconds. An already running transport or remote inference can outlive the caller deadline. The investigator issues no further requests after timing out and reports usage and cost as unknown when their totals cannot be established. A client that exceeds its trusted token bounds is treated as a protocol error. Offline verification cannot establish provider billing behavior or remote cancellation.

This slice uses the synthetic frozen v2 fixtures and B1's model-visible corpus. Registered publications require the A1 recorded adapter and an independently supplied receipt. The tests use an authored local gate policy and receipt for the frozen failure because the shared policy and receipt paths are outside the B2 sandbox.
