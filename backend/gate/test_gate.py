"""Offline replay checks for synthetic examples and both A1 recorded inputs."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from ..ingestion import importer as a1
from .replay import replay

ROOT = Path(__file__).resolve().parents[2]
CASES = ROOT / "samples/reconciliation"
POLICY = CASES / "policy.json"
RECEIPTS = ROOT / "harness/source-receipts.json"
LOCAL_POLICY = ROOT / "backend/gate/local-recorded-policy.json"


def load(path):
    return a1.decode(path.read_bytes())


def save(path, value):
    path.write_bytes(a1.encode(value))


def cli(bundle, policy=POLICY, receipt=RECEIPTS, *options):
    return subprocess.run(
        [sys.executable, "-B", "-m", "backend.gate", str(bundle),
         "--policy", str(policy), "--receipt", str(receipt), *options],
        cwd=ROOT, capture_output=True, text=True, check=False,
    )


def check_inventory_cases(test, bundle, policy, receipt):
    def evaluate():
        return replay(bundle, policy, receipt, scratch=test.scratch)

    original = evaluate()
    for parent, inside in ((bundle.parent, False), (bundle, True), (bundle / "artifacts", True)):
        for kind in ("file", "directory", "symlink"):
            with test.subTest(inside=inside, directory=parent.name, kind=kind):
                extra = parent / "investigation.json"
                if kind == "file":
                    extra.write_bytes(b"unlisted content")
                elif kind == "directory":
                    extra.mkdir()
                else:
                    extra.symlink_to(parent / "absent")
                try:
                    if inside:
                        with test.assertRaisesRegex(a1.ImportError, "unexpected publication entry"):
                            evaluate()
                    else:
                        test.assertEqual(original, evaluate())
                finally:
                    extra.rmdir() if kind == "directory" else extra.unlink()


class FixtureTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.scratch = Path(temporary.name)

    def copy_fixture(self, name):
        return shutil.copytree(CASES / name, self.scratch / name)

    def test_golden_cli_outputs_and_tamper_rejection(self):
        for name, case in load(CASES / "expectations.json").items():
            with self.subTest(name=name):
                gate = case["gate"]
                timestamp = gate["evaluated_at"] if gate else "2026-11-19T00:00:00Z"
                result = cli(CASES / name, POLICY, RECEIPTS, "--evaluated-at", timestamp)
                if gate is None:
                    self.assertEqual(result.returncode, 1)
                    self.assertIn("artifact digest mismatch", result.stderr)
                    self.assertEqual(result.stdout, "")
                else:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(json.loads(result.stdout), gate)

    def test_malformed_schema_and_semantic_references(self):
        folder = self.copy_fixture("pass")
        manifest = folder / "evidence.json"
        corruptions = (
            ("schema", lambda d: d.update(schema_version="1.0.0")),
            ("duplicate", lambda d: d["observed"].append(dict(d["observed"][0], outcome="failed"))),
            ("dangling", lambda d: d["observed"][0].update(artifact_ids=["absent"])),
            ("unexpected", lambda d: d["observed"][0].update(execution_id="absent")),
            ("forged", lambda d: d["observed"][0].update(outcome="failed")),
            ("path", lambda d: d["artifacts"][0].update(path="artifacts/../evidence.json")),
            ("completeness", lambda d: d.update(completeness="partial")),
            ("matrix", lambda d: d["expected"][0].update(test_id="other")),
            ("ai field", lambda d: d.update(investigation={"decision": "BLOCKED"})),
        )
        for label, corrupt in corruptions:
            with self.subTest(label=label):
                evidence = load(CASES / "pass/evidence.json")
                corrupt(evidence)
                save(manifest, evidence)
                with self.assertRaises(a1.ImportError):
                    replay(folder, POLICY, RECEIPTS)
        manifest.write_bytes(b'{"campaign_id":"x","campaign_id":"y"}')
        with self.assertRaisesRegex(a1.ImportError, "duplicate JSON field"):
            replay(folder, POLICY, RECEIPTS)

    def test_missing_and_symlinked_artifacts_reject(self):
        folder = self.copy_fixture("pass")
        artifact = folder / "artifacts/x.json"
        artifact.unlink()
        with self.assertRaisesRegex(a1.ImportError, "missing publication entry"):
            replay(folder, POLICY, RECEIPTS)
        artifact.symlink_to(CASES / "pass/artifacts/x.json")
        with self.assertRaisesRegex(a1.ImportError, "cannot safely read"):
            replay(folder, POLICY, RECEIPTS)

    def test_strict_policy_grammar(self):
        candidate = self.scratch / "policy.json"
        mutations = (
            {"allow_unverified": True},
            {"confirmed_failure": "Any failed observation"},
            {"precedence": ["ELIGIBLE", "INCONCLUSIVE", "BLOCKED"]},
            {"required": []},
            {"required": [load(POLICY)["required"][0]] * 2},
            {"version": "foo\n"},
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                save(candidate, dict(load(POLICY), **mutation))
                with self.assertRaises(a1.ImportError):
                    replay(CASES / "pass", candidate, RECEIPTS)

    def test_complete_skipped_and_errored_outcomes_remain_insufficient(self):
        folder = self.copy_fixture("mixed")
        original = load(CASES / "mixed/evidence.json")
        manifest = folder / "evidence.json"
        receipt = self.scratch / "receipt.json"
        for outcome in ("skipped", "error", "missing"):
            with self.subTest(outcome=outcome):
                evidence = load(CASES / "mixed/evidence.json")
                evidence["observed"][0]["outcome"] = outcome
                if outcome == "missing":
                    evidence["observed"][0]["observation"] = "unavailable"
                row = evidence["observed"][0]
                report = folder / "artifacts/x.json"
                save(report, {field: row[field] for field in ("execution_id", "outcome", "observation")})
                digest = a1.digest(report.read_bytes())
                evidence["artifacts"][0]["sha256"] = digest
                save(manifest, evidence)
                save(receipt, {original["campaign_id"]: {"x": digest}})
                result = replay(folder, POLICY, receipt)
                self.assertEqual(result["decision"], "INCONCLUSIVE")
                self.assertEqual([r["code"] for r in result["reasons"]], ["INSUFFICIENT_EVIDENCE"] * 2)

    def test_missing_source_corroboration_is_insufficient(self):
        receipt = self.scratch / "receipt.json"
        save(receipt, {})
        for name in ("pass", "fail"):
            result = replay(CASES / name, POLICY, receipt)
            self.assertEqual(result["decision"], "INCONCLUSIVE")
            self.assertEqual([r["code"] for r in result["reasons"]], ["INSUFFICIENT_EVIDENCE"] * 2)

    def test_reproducibility_and_independence_from_adjacent_ai_output(self):
        folder = self.copy_fixture("mixed")
        first = cli(folder, POLICY, RECEIPTS, "--evaluated-at", "2026-11-19T00:00:00Z")
        save(folder.parent / "investigation.json", {"decision": "ELIGIBLE", "reasons": []})
        second = cli(folder, POLICY, RECEIPTS, "--evaluated-at", "2026-11-20T00:00:00Z")
        for result in (first, second):
            self.assertEqual(result.returncode, 0, result.stderr)
        left, right = json.loads(first.stdout), json.loads(second.stdout)
        self.assertNotEqual(left.pop("evaluated_at"), right.pop("evaluated_at"))
        self.assertEqual(left, right)

    def test_exact_bundle_inventory(self):
        check_inventory_cases(self, self.copy_fixture("pass"), POLICY, RECEIPTS)

    def test_original_policy_and_manifest_bytes_are_hashed(self):
        folder = self.copy_fixture("pass")
        manifest = folder / "evidence.json"
        policy = self.scratch / "policy.json"
        policy.write_bytes(POLICY.read_bytes() + b"\n")
        manifest.write_bytes(manifest.read_bytes() + b"\n")
        result = replay(folder, policy, RECEIPTS)
        self.assertEqual(result["decision"], "ELIGIBLE")
        for field, path in (("policy_sha256", policy), ("evidence_sha256", manifest)):
            self.assertEqual(result[field], a1.digest(path.read_bytes()))


class RecordedTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.scratch = Path(temporary.name)
        default_checkout = ROOT.parent / "qa-workspace/qa-features"
        self.qa = Path(os.environ.get("QUALITYOPS_QA_FEATURES_ROOT", default_checkout))

    def import_recorded(self, name):
        receipt_path = ROOT / f"backend/ingestion/receipts/{name}.json"
        receipt = a1.load_config(receipt_path)
        result = a1.import_campaign(self.qa / receipt["source_location"], self.scratch / "store", receipt)
        return result.evidence_path.parent, receipt_path

    def test_both_recorded_imports_pass_local_matrix_and_replay_canonically(self):
        for name in ("baseline", "archive-failure"):
            with self.subTest(name=name):
                bundle, receipt = self.import_recorded(name)
                result = replay(bundle, LOCAL_POLICY, receipt, scratch=self.scratch)
                self.assertEqual(result["decision"], "ELIGIBLE")
                self.assertEqual([r["code"] for r in result["reasons"]], ["ALL_REQUIRED_PASSED"] * 18)
                self.assertEqual(result, replay(bundle, LOCAL_POLICY, receipt, scratch=self.scratch))

    def test_exact_bundle_inventory(self):
        bundle, receipt = self.import_recorded("baseline")
        check_inventory_cases(self, bundle, LOCAL_POLICY, receipt)

    def test_replay_rejects_digest_verified_passing_scenario_with_error(self):
        bundle, receipt_path = self.import_recorded("baseline")
        manifest = bundle / "evidence.json"
        evidence = load(manifest)
        artifacts = {item["source_path"]: item for item in evidence["artifacts"]}
        report = artifacts["campaign.json"]
        campaign = load(bundle / report["path"])
        campaign["slots"][0]["result"]["scenarios"][0]["error"] = "contradictory error"
        save(bundle / report["path"], campaign)
        report["sha256"] = a1.digest((bundle / report["path"]).read_bytes())

        receipt = dict(load(receipt_path), manifest_sha256=report["sha256"])
        external = self.scratch / "receipt.json"
        save(external, receipt)
        embedded = artifacts["adapter/receipt.json"]
        save(bundle / embedded["path"], receipt)
        embedded["sha256"] = a1.digest(external.read_bytes())
        save(manifest, evidence)
        with self.assertRaisesRegex(a1.ImportError, "passing scenario has non-null error"):
            replay(bundle, LOCAL_POLICY, external, scratch=self.scratch)

    def test_authentic_shared_report_cannot_confirm_forged_normalized_outcome(self):
        bundle, receipt = self.import_recorded("baseline")
        manifest = bundle / "evidence.json"
        evidence = load(manifest)
        evidence["observed"][0]["outcome"] = "failed"
        save(manifest, evidence)
        result = cli(bundle, LOCAL_POLICY, receipt, "--scratch", str(self.scratch))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("differs from A1 normalization", result.stderr)

    def test_embedded_and_wrong_external_receipts_cannot_authenticate(self):
        bundle, receipt = self.import_recorded("baseline")
        evidence = load(bundle / "evidence.json")
        embedded = next(a for a in evidence["artifacts"] if a["source_path"] == "adapter/receipt.json")
        with self.assertRaisesRegex(a1.ImportError, "outside the bundle"):
            replay(bundle, LOCAL_POLICY, bundle / embedded["path"], scratch=self.scratch)
        wrong = receipt.with_name("archive-failure.json")
        with self.assertRaisesRegex(a1.ImportError, "embedded receipt differs"):
            replay(bundle, LOCAL_POLICY, wrong, scratch=self.scratch)
