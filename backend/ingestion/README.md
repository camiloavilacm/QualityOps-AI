# Offline campaign ingestion

Run from the QualityOps worktree root with Python 3.11+ and the jsonschema dependency pinned in `harness/requirements.txt`.

```sh
python -B -m backend.ingestion SOURCE_DIRECTORY PRIVATE_STORE --config TRUSTED_RECEIPT.json
python -B -m unittest -v backend.ingestion.test_importer
```

The receipt must come from trusted operator configuration outside the campaign directory. The two supplied receipts use the independently configured SEED-1 matrix of six runner/SUT slots and three acceptance criteria per slot. They pin the original `campaign.json` bytes, which bind the expected digest of each declared diagnostic. Obtain or verify a receipt independently before importing more campaigns. A digest copied from an untrusted delivery gives no source authentication.

A successful import creates `PRIVATE_STORE/<campaign_id>/evidence.json` and `artifacts/`. Find the trusted receipt in the manifest's diagnostic artifacts by `source_path: adapter/receipt.json`. Its digest covers the normalized receipt bytes, which preserve the source capture location, capture revision where applicable, upstream workflow run ID, run attempt, revision and conclusion. The normalized evidence uses the upstream workflow revision and the recorded workflow update time. The unchanged upstream campaign manifest is the shared execution report and preserves the original slot execution IDs, feature revision, observer states and campaign status. Each scenario execution ID is derived from the configured slot and acceptance criterion. Artifact IDs are derived from their source paths and scoped to the campaign. Upstream payloads remain byte-identical.

An absent slot or scenario leaves its expected execution in the matrix. A scenario reported as `not_run` becomes `missing` with an `unavailable` observation. Scenario, slot, and slot-result errors prevent complete observations. The adapter validates campaign, slot-result, and scenario statuses against the upstream format. After verifying declared file digests, it matches `checks.json` to the manifest's execution identity and scenario outcome and matches `network.json` to the observer for that slot and scenario. Malformed or contradictory diagnostics reject the import. A missing required diagnostic declaration downgrades an otherwise complete observation. The campaign status stays in the execution report and the workflow conclusion stays in the receipt.

The store and its parent directories are operator-controlled. Treat all published contents as private. Input references are resolved below an opened source directory with no symlink following. The importer bounds manifest size, individual artifact size, artifact count and total payload bytes. It stages on the store filesystem and atomically renames a validated bundle into place. A retry compares the published inventory and bytes. Conflicting or damaged publications require operator investigation. Atomic visibility covers cooperating importers on a local filesystem. Power-loss durability and recovery of temporary directories after abrupt termination are outside this adapter.

## Recorded inputs

| Receipt | Source directory relative to the qa-features checkout | Capture |
| --- | --- | --- |
| `receipts/baseline.json` | `tools/release/baseline-evidence` | Tracked at `e7c566ff831139889195643a1b906b7edab76f48`. Workflow `44051378117` recorded `success`. |
| `receipts/archive-failure.json` | `harness/evidence/readme-runs/failure` | Local archive of workflow `44088601282`, attempt 2. GitHub recorded `failure` and the campaign recorded `passed`. |

From the worktree root, run both recorded imports and the focused suite with the following commands. Set `QUALITYOPS_QA_FEATURES_ROOT` to override the default checkout at `../qa-workspace/qa-features`. Both campaigns are required and the suite fails if either is unavailable. Use a fresh private store for verification. Bundles written by the earlier layout will conflict under the same immutable ID.

```sh
export QUALITYOPS_QA_FEATURES_ROOT="${QUALITYOPS_QA_FEATURES_ROOT:-$(cd ../qa-workspace/qa-features && pwd)}"
store="$(mktemp -d)"
python -B -m backend.ingestion "$QUALITYOPS_QA_FEATURES_ROOT/tools/release/baseline-evidence" "$store" --config backend/ingestion/receipts/baseline.json
python -B -m backend.ingestion "$QUALITYOPS_QA_FEATURES_ROOT/harness/evidence/readme-runs/failure" "$store" --config backend/ingestion/receipts/archive-failure.json
python -B -m unittest -v backend.ingestion.test_importer
```
