# Shared browser verification container

This is the first implementation slice of the approved v7 plan. Product contracts and the deterministic campaign gate are unchanged. Gate 1 is implemented; requests for cumulative Gates 2–4 return BLOCKED until their checks exist. A successful bootstrap is infrastructure evidence, never verifier acceptance.

Docker must be running with Linux/amd64 execution available. The host needs Git, Python 3.11+ (standard library only for the launcher) and Node; the container supplies Node 26 and Chromium. Dependency preparation may access the package registry, using only the trusted verifier's package and lock files. Execution has no network except container loopback and installs nothing. A local Unix Docker daemon is required; no host home, registry configuration, credentials or Docker socket enters the container.

At least 10 GiB host free space is required before image preparation. The launcher reserves 256 KiB for failure reporting and releases it during cleanup. This preflight is conservative and does not impose a quota on Docker's storage. It must not prune existing Docker images or containers to obtain space.

After recording an immutable infrastructure revision, run the same bootstrap command locally or in CI:

```sh
node harness/run_pr_verification.mjs --bootstrap --stage 1 --verifier-revision FULL_SHA --candidate-revision FULL_SHA --output /tmp/new-bootstrap-evidence
```

The launcher rejects dirty executable/policy files that differ from the requested verifier objects. Worktree source changes and untracked files are never implicit overlay inputs. Record and review the final revision before bootstrap execution; no commit is created by the launcher. CI checks the committed snapshot and uses this same bootstrap command. Candidate-controlled workflow feedback does not establish an accepted trust boundary.

After independent review and explicit human acceptance, invoke the launcher **from the accepted verifier checkout**, using the four established arguments. Set `QUALITYOPS_VERIFIER_ACCEPTANCE` to a maintainer-controlled JSON file outside candidate inputs:

```json
{
  "verifier_revision": "FULL_ACCEPTED_SHA",
  "runtime_policy_sha256": "SHA256_OF_ACCEPTED_RUNTIME_POLICY_BYTES",
  "independent_review": "review identity and evidence reference",
  "human_acceptance": "maintainer acceptance reference",
  "candidate_revision": "FULL_CANDIDATE_SHA",
  "approved_changes": [
    {"path": "frontend/tests/mixed-campaign.spec.ts", "sha256": "SHA256_OF_EXACT_APPROVED_SPEC_BYTES"}
  ]
}
```

`approved_changes` must equal the sorted scope-check result, including exact content digests; use an empty array for identical revisions. The three existing ordinary specs are the only possible overlay paths. Adds, deletes, renames, symlinks, config/helper/workflow changes, unknown commits and unapproved blobs fail closed. The acceptance record is an operational maintainer attestation, not a signature system; an actor controlling the verifier or host can bypass it. Candidate code is isolated for execution; human semantic review remains required.

```sh
node harness/run_pr_verification.mjs --stage 1 --verifier-revision FULL_ACCEPTED_SHA --candidate-revision FULL_CANDIDATE_SHA --output /tmp/new-candidate-evidence
```

Evidence includes the immutable base reference, built image ID, lockfile/source/spec digests, revisions, Docker inspection, runtime versions, commands with working directories and exit codes, in-container isolation checks, exact discovery/execution reports and cleanup outcome. Output must be a new directory; the final path cannot be a symlink. Maintainer-selected parent aliases such as macOS `/tmp` are resolved canonically before use. Missing or failed reports cannot pass. The validator requires eight ordinary passes, exactly two passing guard controls/six guard-attributed failures, and four lifecycle passes, one attempt each. Probe and isolation must pass first. Root filesystem, prepared sources/tests/bundle remain read-only; writes are confined to `/tmp`, private shared memory and disposable evidence. Docker limits the container, while child commands and the overall gate have time limits.

Run offline component checks without Docker:

```sh
python3 -B -m unittest -v harness.test_pr_verification
node --test harness/test_pr_reports.mjs
```

These tests deliberately mutate scope, report and Docker-inspection fixtures and exercise child timeout/output limits. They do not prove actual resource, filesystem or network enforcement. `isolation-probe.mjs` performs those checks inside the restricted container before test code. The container starts as non-root `pwuser`, drops all effective, permitted and ambient capabilities, and retains only `CAP_SYS_CHROOT` in the bounding set for Chromium's child user namespace sandbox. Chromium sandboxing stays enabled. Fresh pinned-image execution and isolation passed; the initial bootstrap was blocked at browser launch until this narrowly scoped capability was approved. The Stage 1 bootstrap now passes, including the sandboxed browser and all three report validators; independent review and exact-SHA human acceptance remain pending. Evidence is under `harness/artifacts/container-chroot-capability-bootstrap-4/`. No seccomp, network, filesystem, or browser sandbox restriction was weakened. Full Stage 0 verification still uses the macOS sandbox workflow in `harness/README.md`.

Raw container output is quarantined. After the container stops, every entry is checked without following links; symlinks, special files, unknown artifacts and oversized/deep trees reject collection. Limits are 16 MiB per file, 128 MiB total, 1,024 files, 4,096 entries and 16 directory levels, monitored during execution as well. The host copies approved regular files to a separate `publication/` directory only after cleanup; CI uploads only that directory. A collection or cleanup failure publishes a host-owned failure summary, with no candidate files. Synthetic external-canary, parent-link and FIFO tests cover this boundary. Collection limits protect this artifact path; they are not a filesystem quota on the host.

Upstream provenance: [Playwright Dockerfile](https://github.com/microsoft/playwright/blob/bbd948344ea9a60bf1e6f125c02ca99b2b51593b/utils/docker/Dockerfile.noble), [unmodified seccomp profile](https://github.com/microsoft/playwright/blob/bbd948344ea9a60bf1e6f125c02ca99b2b51593b/utils/docker/seccomp_profile.json), [Docker none network documentation](https://docs.docker.com/engine/network/drivers/none/). Exact upstream revision, profile digest and runtime limits are in `runtime-policy.json`.
