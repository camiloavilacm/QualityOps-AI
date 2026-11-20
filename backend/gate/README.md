# Offline release gate

Run from the QualityOps worktree root using Python 3.11+ and the jsonschema dependency pinned in `harness/requirements.txt`.

```sh
python -B -m backend.gate samples/reconciliation/mixed \
  --policy samples/reconciliation/policy.json \
  --receipt harness/source-receipts.json \
  --evaluated-at 2026-11-19T00:00:00Z
```

The CLI writes one frozen v2 decision to stdout and exits zero for every valid decision. A rejected input produces a diagnostic on stderr, an empty stdout, and a nonzero exit. Compare canonical decisions after removing `evaluated_at`. The `backend.gate.replay.replay` function returns this canonical content directly and hashes the original evidence manifest and policy bytes.

Supply operator-approved policy and receipts from outside the bundle. The policy uses the four fields in the reconciliation example. The precedence and confirmation text are fixed to the implemented v2 rules. The required rows must match the validated expected matrix by execution ID. Synthetic fixtures require the independently supplied campaign/execution-to-report-digest index.

Recorded bundles require a matching A1 receipt from a trusted source. The gate reconstructs the source layout in a private temporary directory using bounded, hash-verified artifact bytes. It runs A1 normalization again with the external receipt and compares the normalized manifest with the supplied bundle, including the outcomes, observation states, and report references. The temporary directory is removed on exit. Use `--scratch` to choose a writable, operator-controlled parent. The gate trusts the operator to select authentic policy and receipt contents.

## Recorded local example

`local-recorded-policy.json` is a local example for both A1 receipts. Its `required` array is `list(expected_matrix(receipt).values())` from A1, which is identical for the two receipts. It requires all 18 SEED-1 runner/SUT/scenario combinations. Workflow conclusions are recorded provenance. Scenario evidence determines the gate result under this policy.

```sh
QA="${QUALITYOPS_QA_FEATURES_ROOT:-../qa-workspace/qa-features}"
scratch="$(mktemp -d)"
store="$(mktemp -d "$scratch/a2-store.XXXXXX")"
"$QA/.venv/bin/python" -B -m backend.ingestion "$QA/tools/release/baseline-evidence" "$store" \
  --config backend/ingestion/receipts/baseline.json
"$QA/.venv/bin/python" -B -m backend.ingestion "$QA/harness/evidence/readme-runs/failure" "$store" \
  --config backend/ingestion/receipts/archive-failure.json
"$QA/.venv/bin/python" -B -m backend.gate "$store/gh-1461074056-44051378117" \
  --policy backend/gate/local-recorded-policy.json --receipt backend/ingestion/receipts/baseline.json \
  --scratch "$scratch" --evaluated-at 2026-11-19T00:00:00Z
"$QA/.venv/bin/python" -B -m backend.gate "$store/smoke-gh-1461074056-44088601282" \
  --policy backend/gate/local-recorded-policy.json --receipt backend/ingestion/receipts/archive-failure.json \
  --scratch "$scratch" --evaluated-at 2026-11-19T00:00:00Z
TMPDIR="$scratch" "$QA/.venv/bin/python" -B -m unittest -v backend.gate.test_gate
```

The recorded tests require both source directories. Set `QUALITYOPS_QA_FEATURES_ROOT` to point the tests at a different local checkout. The A1 README and receipts document the source revisions and capture provenance.
