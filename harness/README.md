# Stage 0 development verification

Run from the repository root on macOS using a trusted Python 3.11+ environment with the dependency in harness/requirements.txt. The runner itself installs nothing. A fresh environment can be prepared outside the worktree with python3 -m venv and pip install -r harness/requirements.txt.

    python -B harness/verify.py

The fixed checks validate the three draft schemas, verify samples/minimal against the evidence schema, compare artifact bytes and inventory, and exercise positive and deliberately invalid fixtures using unittest. Tests mutate temporary copies of the real requirements fixture. Synthetic decision and investigation examples exercise wire shapes only. Successful verification exits zero and writes harness/verification.json. A failed or unavailable check exits nonzero. Check the current command exit code before using its report.

## Developer workflow

1. Read the stage instructions, specification, plan and accepted contracts. Confirm owner, approved baseline SHA and paths before editing. Module tests live under the owning module.
2. After worktree authorization, configure the agent executor with filesystem write access restricted to its assigned directories and scratch, read-only project inputs and Git metadata, disabled network, and no credentials. Test an allowed write and a denied sibling write in a disposable workspace before granting a task. If the executor cannot restrict writes, keep the assignment pending.
3. Develop locally, then run the single entry point with both scope arguments. The reviewer uses the approved SHA independently. Review the actual diff along with the report.

       python -B harness/verify.py --owner A --base FULL_APPROVED_COMMIT_SHA

Scope mode additionally checks committed, staged, unstaged and untracked paths including ignored outputs. It inspects both sides of renames. The checker reads the authoritative role allowlists from harness/ownership.json. Scope-mode reports are written to a unique temporary file outside the checkout.

## Trust and coverage

The trusted launcher runs checks under macOS sandbox-exec with a fresh environment, denied network operations and filesystem writes limited to a temporary directory and /dev/null. The tests exercise the repository write denial. An unavailable sandbox fails the run. The parent can write the report. This profile protects ordinary local verification and still permits reading local files. Run untrusted candidate code in a separately isolated credential-free executor, with the verifier and approved baseline supplied by the reviewer. A Git diff check alone cannot prevent transient writes, detect edits outside the checkout or establish the trustworthiness of Git configuration.

The legacy sample establishes requirement provenance only. Discovery runs legacy regression tests and the active reconciliation suite. The latter checks synthetic report bytes, expected policy examples and a closed projection of the entire model-visible fixture directory. The seeded canary stays under evaluators/ground_truth. See contracts/CHANGES.md for compatibility and limits. Real adapter authentication, runtime access control and benchmark performance remain unverified.

## First trusted baseline

Review the initial inventory with git status --short --untracked-files=all. The local Finder metadata and pre-existing nested checkout at the repository root are excluded from untracked scope enumeration. Tracked changes still count everywhere. Scope mode includes all other untracked files, even ignored build outputs. After the human-approved initial commit, obtain its full SHA with git rev-parse HEAD and run the documented scope command with owner reviewer on the clean checkout. Scope-mode output is written outside the checkout.

The fixture policy supplies the mandatory matrix. The reviewed synthetic receipt table in harness/source-receipts.json stands in for separately authenticated source records. It is keyed by campaign and execution and binds exact artifact bytes. A digest supplied only by the evidence producer establishes internal consistency. Real source authentication and replay are implementation acceptance criteria.
