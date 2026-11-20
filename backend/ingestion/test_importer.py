"""A1 offline integration and failure-path tests."""
import concurrent.futures
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.ingestion.importer import (
    ARTIFACT_LIMIT, ImportError, digest, import_campaign, load_config,
)
from harness.checks import bundle

MODULE = Path(__file__).resolve().parent
UPSTREAM = Path(os.environ.get(
    "QUALITYOPS_QA_FEATURES_ROOT", MODULE.parents[2] / "qa-workspace/qa-features"
)).resolve()
BASELINE = UPSTREAM / "tools/release/baseline-evidence"
ARCHIVE = UPSTREAM / "harness/evidence/readme-runs/failure"


class ImporterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for source in (BASELINE, ARCHIVE):
            if not (source / "campaign.json").is_file():
                raise FileNotFoundError(
                    f"Required campaign is unavailable at {source}. Check QUALITYOPS_QA_FEATURES_ROOT."
                )

    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.scratch = Path(scratch.name)
        self.store = self.scratch / "private"
        self.config = load_config(MODULE / "receipts/baseline.json")

    def clone(self, name="source"):
        source = self.scratch / name
        shutil.copytree(BASELINE, source)
        return source

    def edit_manifest(self, source, edit):
        path = source / "campaign.json"
        document = json.loads(path.read_bytes())
        edit(document)
        raw = json.dumps(document).encode()
        path.write_bytes(raw)
        # Simulate an independent receipt for an authored test variation.
        return dict(self.config, manifest_sha256=digest(raw))

    def edit_diagnostic(self, source, slot, scenario, name, edit):
        relative = f"{scenario['id']}/{name}"
        path = source / "artifacts" / self.config["slots"][slot["slot_id"]] / relative
        payload = json.loads(path.read_bytes())
        edit(payload)
        raw = json.dumps(payload).encode()
        path.write_bytes(raw)
        artifact = next(item for item in scenario["artifacts"] if item["path"] == relative)
        artifact["sha256"] = digest(raw)

    def test_two_recorded_campaigns(self):
        cases = (
            (BASELINE, "baseline", "tracked", "success"),
            (ARCHIVE, "archive-failure", "local-archive", "failure"),
        )
        for source, name, capture, conclusion in cases:
            with self.subTest(capture=capture):
                receipt = load_config(MODULE / f"receipts/{name}.json")
                result = import_campaign(source, self.store, receipt)
                self.assertTrue(result.created)
                published = result.evidence_path.parent
                evidence = bundle(published)
                self.assertEqual(receipt["capture"], capture)
                self.assertEqual(receipt["workflow_conclusion"], conclusion)
                self.assertEqual(evidence["source"]["revision"], receipt["run_revision"])
                self.assertEqual(evidence["source"]["run_id"], receipt["run_id"])
                self.assertEqual(evidence["completeness"], "complete")
                self.assertEqual(len(evidence["expected"]), 18)
                self.assertEqual(len(evidence["observed"]), 18)
                self.assertEqual({row["outcome"] for row in evidence["observed"]}, {"passed"})
                self.assertEqual(len(evidence["artifacts"]), 38)
                receipt_artifacts = []
                for artifact in evidence["artifacts"]:
                    payload = (published / artifact["path"]).read_bytes()
                    self.assertEqual(digest(payload), artifact["sha256"])
                    if artifact["source_path"] == "adapter/receipt.json":
                        self.assertEqual(artifact["kind"], "diagnostic")
                        self.assertEqual(json.loads(payload), receipt)
                        receipt_artifacts.append(artifact["id"])
                        continue
                    self.assertEqual(payload, (source / artifact["source_path"]).read_bytes())
                    if artifact["kind"] == "execution-report":
                        self.assertEqual(json.loads(payload)["status"], "passed")
                self.assertEqual(len(receipt_artifacts), 1)
                for row in evidence["observed"]:
                    self.assertNotIn(receipt_artifacts[0], row["artifact_ids"])

    def test_non_success_statuses_cannot_produce_complete_observations(self):
        source = self.clone()

        def edit(doc):
            doc["status"] = "error"
            slots = doc["slots"]
            slots[0]["result"]["status"] = "not_run"
            for scenario in slots[0]["result"]["scenarios"]:
                scenario.update(status="not_run", artifacts=[],
                                observer=dict(state="unavailable", events=[], detail=None))
            slots[1]["result"]["status"] = "error"
            scenario = slots[1]["result"]["scenarios"][0]
            scenario["status"] = "error"
            self.edit_diagnostic(source, slots[1], scenario, "checks.json",
                                 lambda payload: payload.update(outcome="error"))
            slots[2]["state"] = "error"
            slots[2]["result"]["status"] = "error"
            slots[3]["result"]["status"] = "error"

        receipt = self.edit_manifest(source, edit)
        result = import_campaign(source, self.store, receipt)
        evidence = bundle(result.evidence_path.parent)
        self.assertEqual(evidence["completeness"], "partial")
        rows = {row["execution_id"]: row for row in evidence["observed"]}
        expected = {
            "sut-python-playwright.AC-1": ("missing", "unavailable"),
            "sut-python-playwright.AC-2": ("missing", "unavailable"),
            "sut-python-playwright.AC-3": ("missing", "unavailable"),
            "sut-python-selenium.AC-1": ("error", "error"),
        }
        for slot in ("sut-python-selenium", "sut-python-cypress", "sut-node-playwright"):
            for criterion in ("AC-1", "AC-2", "AC-3"):
                expected.setdefault(f"{slot}.{criterion}", ("passed", "error"))
        self.assertEqual(
            {key: (row["outcome"], row["observation"]) for key, row in rows.items()
             if row["observation"] != "complete"},
            expected,
        )

    def test_missing_slot_and_partial_failure_keep_matrix_and_facts(self):
        source = self.clone()

        def edit(doc):
            doc["status"] = "incomplete"
            doc["slots"].pop()
            slot = doc["slots"][0]
            slot["result"]["status"] = "failed"
            scenario = slot["result"]["scenarios"][0]
            scenario["observer"]["state"] = "partial"
            scenario["status"] = "failed"
            self.edit_diagnostic(source, slot, scenario, "network.json",
                                 lambda payload: payload.update(state="partial"))
            scenario["artifacts"] = [item for item in scenario["artifacts"]
                                     if item["kind"] == "network"]

        receipt = self.edit_manifest(source, edit)
        result = import_campaign(source, self.store, receipt)
        evidence = json.loads(result.evidence_path.read_bytes())
        self.assertEqual(evidence["completeness"], "partial")
        self.assertEqual(len(evidence["expected"]), 18)
        self.assertEqual(len(evidence["observed"]), 15)
        observed = {row["execution_id"]: row for row in evidence["observed"]}
        self.assertEqual(observed["sut-python-playwright.AC-1"]["outcome"], "failed")
        self.assertEqual(observed["sut-python-playwright.AC-1"]["observation"], "partial")
        self.assertNotIn("sut-node-cypress.AC-1", observed)

    def test_empty_campaign_remains_unavailable(self):
        source = self.clone()
        receipt = self.edit_manifest(source, lambda doc: doc.update(status="incomplete", slots=[]))
        result = import_campaign(source, self.store, receipt)
        evidence = json.loads(result.evidence_path.read_bytes())
        self.assertEqual(evidence["completeness"], "unavailable")
        self.assertEqual(evidence["observed"], [])
        self.assertEqual(len(evidence["expected"]), 18)

    def test_omitted_diagnostic_downgrades_complete_observation(self):
        source = self.clone()
        receipt = self.edit_manifest(
            source, lambda doc: doc["slots"][0]["result"]["scenarios"][0]["artifacts"].pop()
        )
        result = import_campaign(source, self.store, receipt)
        evidence = json.loads(result.evidence_path.read_bytes())
        self.assertEqual(evidence["completeness"], "partial")
        partial = [row for row in evidence["observed"] if row["observation"] == "partial"]
        self.assertEqual([row["execution_id"] for row in partial], ["sut-python-playwright.AC-1"])

    def test_rejects_complete_result_contradicting_verified_checks_outcome(self):
        source = self.clone()

        def edit(doc):
            doc["status"] = "failed"
            result = doc["slots"][0]["result"]
            result["status"] = "failed"
            result["scenarios"][0]["status"] = "failed"

        receipt = self.edit_manifest(source, edit)
        with self.assertRaisesRegex(ImportError, "checks report contradicts"):
            import_campaign(source, self.store, receipt)
        self.assertFalse(self.store.exists())

        def corroborate(doc):
            slot = doc["slots"][0]
            self.edit_diagnostic(source, slot, slot["result"]["scenarios"][0], "checks.json",
                                 lambda payload: payload.update(outcome="failed"))

        receipt = self.edit_manifest(source, corroborate)
        result = import_campaign(source, self.store, receipt)
        evidence = bundle(result.evidence_path.parent)
        failed, = (row for row in evidence["observed"] if row["outcome"] == "failed")
        self.assertEqual(failed["execution_id"], "sut-python-playwright.AC-1")
        self.assertEqual(failed["observation"], "complete")

    def test_rejects_digest_verified_diagnostic_contradictions_and_malformed_fields(self):
        variants = (
            ("checks.json", lambda p: p.update(execution_id="different"), "checks report contradicts"),
            ("checks.json", lambda p: p.pop("scenario"), "checks report contradicts"),
            ("checks.json", lambda p: p.update(checks={}), "invalid checks report"),
            ("network.json", lambda p: p.update(state="partial"), "network report contradicts"),
            ("network.json", lambda p: p["events"][0].update(status=202), "network report contradicts"),
            ("network.json", lambda p: p["events"][0].update(authorization_present=0),
             "invalid observer event"),
        )
        for index, (name, mutate, error) in enumerate(variants):
            with self.subTest(index=index, name=name):
                source = self.clone(f"diagnostic-{index}")

                def edit(doc):
                    slot = doc["slots"][0]
                    self.edit_diagnostic(source, slot, slot["result"]["scenarios"][0], name, mutate)

                receipt = self.edit_manifest(source, edit)
                with self.assertRaisesRegex(ImportError, error):
                    import_campaign(source, self.store, receipt)
                self.assertFalse(self.store.exists())

    def test_rejects_invalid_or_missing_upstream_status_at_each_level(self):
        targets = (
            ("campaign", lambda doc: doc),
            ("slot result", lambda doc: doc["slots"][0]["result"]),
            ("scenario", lambda doc: doc["slots"][0]["result"]["scenarios"][0]),
        )
        for level, select in targets:
            for label, value in (("bogus", "bogus"), ("missing", None), ("malformed", [])):
                with self.subTest(level=level, case=label):
                    source = self.clone(f"{level}-{label}")

                    def edit(doc):
                        record = select(doc)
                        if label == "missing":
                            record.pop("status")
                        else:
                            record["status"] = value

                    receipt = self.edit_manifest(source, edit)
                    with self.assertRaisesRegex(ImportError, f"invalid {level} status"):
                        import_campaign(source, self.store, receipt)
                    self.assertFalse(self.store.exists())

    def test_rejects_digest_verified_invalid_scenario_error_before_publication(self):
        variants = (
            ("missing scenario error", lambda row: row.pop("error")),
            ("invalid scenario error", lambda row: row.update(error={"message": "invalid type"})),
            ("passing scenario has non-null error", lambda row: row.update(error="contradiction")),
        )
        for index, (message, mutate) in enumerate(variants):
            with self.subTest(message=message):
                source = self.clone(f"source-{index}")
                receipt = self.edit_manifest(
                    source, lambda doc: mutate(doc["slots"][0]["result"]["scenarios"][0])
                )
                with self.assertRaisesRegex(ImportError, message):
                    import_campaign(source, self.store, receipt)
                self.assertFalse(self.store.exists())

    def test_rejects_manifest_and_artifact_tampering(self):
        source = self.clone()
        path = source / "artifacts/sut-python-playwright/AC-1/checks.json"
        path.write_bytes(b"tampered")
        with self.assertRaisesRegex(ImportError, "artifact digest mismatch"):
            import_campaign(source, self.store, self.config)
        self.assertFalse(self.store.exists())
        receipt = self.edit_manifest(source, lambda doc: None)
        with self.assertRaisesRegex(ImportError, "source manifest digest mismatch"):
            import_campaign(source, self.store, self.config)
        with self.assertRaisesRegex(ImportError, "artifact digest mismatch"):
            import_campaign(source, self.store, receipt)

    def test_rejects_missing_declared_artifact_symlink_and_oversize(self):
        source = self.clone()
        relative = "artifacts/sut-python-playwright/AC-1/checks.json"
        path = source / relative
        path.unlink()
        with self.assertRaisesRegex(ImportError, "cannot safely read"):
            import_campaign(source, self.store, self.config)
        path.symlink_to(BASELINE / relative)
        with self.assertRaisesRegex(ImportError, "cannot safely read"):
            import_campaign(source, self.store, self.config)
        path.unlink()
        with path.open("wb") as stream:
            stream.truncate(ARTIFACT_LIMIT + 1)
        with self.assertRaisesRegex(ImportError, "byte limit"):
            import_campaign(source, self.store, self.config)
        self.assertFalse(self.store.exists())

    def test_rejects_traversal_and_mismatched_provenance(self):
        source = self.clone()
        receipt = self.edit_manifest(source, lambda doc: doc["slots"][0]["result"].update(tooling_ref="0" * 40))
        with self.assertRaisesRegex(ImportError, "provenance"):
            import_campaign(source, self.store, receipt)
        shutil.copyfile(BASELINE / "campaign.json", source / "campaign.json")
        receipt = self.edit_manifest(
            source, lambda doc: doc["slots"][0]["result"]["scenarios"][0]["artifacts"][0].update(
                path="AC-1/../../outside"
            )
        )
        with self.assertRaisesRegex(ImportError, "unsafe scenario artifact path"):
            import_campaign(source, self.store, receipt)
        self.assertFalse(self.store.exists())

    def test_rejects_unexpected_slots_and_duplicate_scenarios(self):
        source = self.clone()
        bad_matrix = dict(self.config, slots=dict(self.config["slots"]))
        del bad_matrix["slots"]["sut-node:cypress"]
        with self.assertRaisesRegex(ImportError, "unexpected source slot"):
            import_campaign(source, self.store, bad_matrix)

        def duplicate(doc):
            scenarios = doc["slots"][0]["result"]["scenarios"]
            scenarios.append(scenarios[0])

        receipt = self.edit_manifest(source, duplicate)
        with self.assertRaisesRegex(ImportError, "duplicate record identity"):
            import_campaign(source, self.store, receipt)
        self.assertFalse(self.store.exists())

    def test_frozen_schema_rejects_invalid_collection_timestamp(self):
        with self.assertRaisesRegex(ImportError, "frozen v2 schema"):
            import_campaign(BASELINE, self.store, dict(self.config, collected_at="bad-date"))
        self.assertFalse(self.store.exists())

    def test_retry_conflict_and_existing_artifact_damage(self):
        first = import_campaign(BASELINE, self.store, self.config)
        original = first.evidence_path.read_bytes()
        self.assertFalse(import_campaign(BASELINE, self.store, self.config).created)
        with self.assertRaisesRegex(ImportError, "conflicting"):
            import_campaign(BASELINE, self.store, dict(self.config, workflow_conclusion="failure"))
        source = self.clone()
        receipt = self.edit_manifest(source, lambda doc: None)
        with self.assertRaisesRegex(ImportError, "conflicting"):
            import_campaign(source, self.store, receipt)
        self.assertEqual(first.evidence_path.read_bytes(), original)
        artifact = json.loads(original)["artifacts"][0]
        (first.evidence_path.parent / artifact["path"]).write_bytes(b"damaged")
        with self.assertRaisesRegex(ImportError, "damaged"):
            import_campaign(BASELINE, self.store, self.config)

    def test_concurrent_retries_publish_one_bundle(self):
        def run(_):
            return import_campaign(BASELINE, self.store, self.config)

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as workers:
            results = list(workers.map(run, range(3)))
        self.assertEqual(sum(result.created for result in results), 1)
        self.assertEqual(len(set(result.evidence_path for result in results)), 1)
        self.assertEqual([entry.name for entry in self.store.iterdir()], [self.config["campaign_id"]])

    def test_failed_staging_write_does_not_leave_published_or_staged_bundle(self):
        write = Path.write_bytes

        def fail_on_manifest(path, data):
            if path.name == "evidence.json":
                raise OSError("simulated staging write failure")
            return write(path, data)

        with patch.object(Path, "write_bytes", fail_on_manifest):
            with self.assertRaises(ImportError):
                import_campaign(BASELINE, self.store, self.config)
        self.assertEqual(list(self.store.iterdir()), [])
        self.assertTrue(import_campaign(BASELINE, self.store, self.config).created)

    def test_cli_reports_success_and_rejection(self):
        command = [sys.executable, "-B", "-m", "backend.ingestion", str(BASELINE), str(self.store),
                   "--config", str(MODULE / "receipts/baseline.json")]
        result = subprocess.run(command, cwd=MODULE.parents[1], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Created", result.stdout)
        command[-1] = str(MODULE / "receipts/archive-failure.json")
        result = subprocess.run(command, cwd=MODULE.parents[1], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("source manifest digest mismatch", result.stderr)
