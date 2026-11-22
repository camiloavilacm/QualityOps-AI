"""B1 module tests. All trial payloads in these tests are authored."""

from copy import deepcopy
import json
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from jsonschema import Draft202012Validator

from authored_examples import example
import evaluate as ev
import projection


class ReplayTests(unittest.TestCase):
    def replay(self, run):
        return ev.replay(ev.encode(run))

    def test_metrics_and_schema(self):
        Draft202012Validator.check_schema(json.loads((ev.ROOT / "report-v1.schema.json").read_bytes()))
        report = self.replay(example())
        self.assertEqual(report["case_counts"], dict(defect=15, insufficient=3, intermittent=2))
        self.assertEqual(report["evidence_source_counts"],
                         {"recorded-capture": 5, "frozen-synthetic": 1, "authored": 14})
        metrics = report["metrics"]
        for name, count, denominator in (
            ("diagnosis_accuracy", 13, 15), ("citation_validity", 24, 24),
            ("claim_support", 13, 14), ("correct_abstention", 4, 5), ("invalid_output", 1, 20),
        ):
            self.assertEqual(metrics[name], dict(count=count, denominator=denominator, rate=count/denominator))
        self.assertEqual(metrics["attempted"], 20)
        for key in ev.TELEMETRY:
            self.assertEqual(metrics[key], dict(count=0, denominator=20, p50=None, p95=None))
        self.assertEqual(ev.rate([]), dict(count=0, denominator=0, rate=None))

    def test_claims_and_safety_are_independent(self):
        run = example(True)
        run["trials"][0]["response"]["claims"][0]["evidence_ids"] = ["c-90291263278212ae", "a1"]
        run["trials"][1]["response"]["claims"][0]["statement"] = "An unknown paraphrase"
        run["trials"][2]["protocol_valid"] = False
        run["trials"][16]["safety"] = dict.fromkeys(ev.SAFETY, True)
        report = self.replay(run)
        rows = report["trials"]
        self.assertEqual(rows[0]["claims"], [dict(citation_exists=[False, True], support="unsupported")])
        self.assertEqual(rows[1]["claims"][0]["support"], "review_required")
        self.assertFalse(rows[2]["diagnosis_correct"])
        for value in report["metrics"]["safety_by_type"].values():
            self.assertEqual(value["count"], 1)
        self.assertEqual(report["metrics"]["safety_violation"]["count"], 1)
        self.assertEqual(report["metrics"]["claims_requiring_review"], 1)

    def test_reject_coverage_safety_and_binding_changes(self):
        sample = example(True)
        for key, value, message in (
            ("case_id", "q21", "invalid trial key"),
            ("trial", 2, "unexpected or duplicate trial"),
            ("evidence_sha256", "0"*64, "trial provenance mismatch"),
            ("fixture_or_run_id", "another-run", "trial provenance mismatch"),
            ("safety", {}, "missing or unknown safety"),
            ("telemetry", {}, "invalid telemetry fields"),
        ):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, message):
                updated = deepcopy(sample)
                updated["trials"][0][key] = value
                self.replay(updated)
        updated = deepcopy(sample)
        updated["trials"].pop()
        with self.assertRaisesRegex(ValueError, "missing trials"):
            self.replay(updated)
        updated["trials"].append(deepcopy(updated["trials"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate trial"):
            self.replay(updated)
        updated = deepcopy(sample)
        updated["trials"][0]["response"]["prompt_sha256"] = "c"*64
        with self.assertRaisesRegex(ValueError, "response provenance mismatch"):
            self.replay(updated)

    def test_raw_manifest_binding(self):
        runs = example(True)
        trial = next(row for row in runs["trials"] if row["case_id"] == ev.PARTIAL_CASE)
        raw = (ev.ROOT.parent / "samples/reconciliation/partial/evidence.json").read_bytes()
        self.assertEqual(trial["campaign_id"], "fixture-partial")
        self.assertEqual(trial["evidence_sha256"], ev.digest(raw))
        for other in runs["trials"]:
            if other is not trial:
                fixture = projection.model_input(other["case_id"])
                self.assertEqual(other["campaign_id"], fixture["campaign_id"])
                self.assertEqual(other["evidence_sha256"], ev.digest(ev.encode(fixture)))
        trial["response"]["evidence_sha256"] = ev.digest(ev.encode(ev.decode(raw)))
        with self.assertRaisesRegex(ValueError, "response provenance mismatch"):
            self.replay(runs)

    def recorded_fixture(self, run_id="test-recorded"):
        run = example(True)
        run.update(source="recorded", trials_per_case=3, run_id=run_id)
        run["configuration"]["region"] = "test-region"
        authored = run["trials"]
        run["trials"] = []
        for slot in (1, 2, 3):
            for original in authored:
                row = deepcopy(original)
                row.update(trial=slot, investigation_id=f"{run_id}-{row['case_id']}-{slot}",
                           fixture_or_run_id=run_id)
                row["response"].update(investigation_id=row["investigation_id"], fixture_or_run_id=run_id,
                                       latency_ms=slot,
                                       estimated_cost_usd=0, usage=dict(input_tokens=slot, output_tokens=1))
                row["telemetry"] = dict(latency_ms=slot, estimated_cost_usd=0,
                                        input_tokens=slot, output_tokens=1)
                run["trials"].append(row)
        return run

    def test_recorded_protocol_validation_with_authored_test_values(self):
        run = self.recorded_fixture()
        raw = ev.encode(run)
        with self.assertRaisesRegex(ValueError, "trusted digest"):
            ev.replay(raw)
        with self.assertRaisesRegex(ValueError, "digest mismatch"):
            ev.replay(raw + b" ", ev.digest(raw))
        report = ev.replay(raw, ev.digest(raw))
        self.assertEqual(report["metrics"]["latency_ms"], dict(count=60, denominator=60, p50=2, p95=3))
        self.assertFalse(report["promotion_allowed"])
        run["trials"][0]["telemetry"]["input_tokens"] = 2
        changed = ev.encode(run)
        with self.assertRaisesRegex(ValueError, "response telemetry mismatch"):
            ev.replay(changed, ev.digest(changed))
        run["trials"][0]["telemetry"]["input_tokens"] = None
        changed = ev.encode(run)
        with self.assertRaisesRegex(ValueError, "missing telemetry"):
            ev.replay(changed, ev.digest(changed))
        run["trials"][0]["telemetry"]["input_tokens"] = 1
        run["trials"][0]["response"] = "{malformed"
        invalid_raw = ev.encode(run)
        self.assertEqual(ev.replay(invalid_raw, ev.digest(invalid_raw))["metrics"]["invalid_output"]["count"], 1)
        run["trials"][0]["telemetry"]["input_tokens"] = None
        raw = ev.encode(run)
        with self.assertRaisesRegex(ValueError, "missing telemetry"):
            ev.replay(raw, ev.digest(raw))

    def compare_runs(self, baseline, candidate):
        a, b = ev.encode(baseline), ev.encode(candidate)
        left, right = ev.digest(a), ev.digest(b)
        return ev.compare(a, b, ev.encode(ev.replay(a, left)), ev.encode(ev.replay(b, right)), left, right)

    def test_operational_error_counts_with_unknown_usage_and_cost(self):
        baseline = self.recorded_fixture("baseline")
        candidate = self.recorded_fixture("candidate")
        row = baseline["trials"][0]
        row["response"].update(status="ERROR", category=None, claims=[],
                               uncertainties=["The service was unavailable."], usage=None,
                               estimated_cost_usd=None)
        row["telemetry"].update(input_tokens=None, output_tokens=None, estimated_cost_usd=None)
        result = self.compare_runs(baseline, candidate)
        metrics = result["baseline_metrics"]
        self.assertEqual(metrics["diagnosis_accuracy"], ev.rate([True] * 44 + [False]))
        self.assertEqual(metrics["invalid_output"]["count"], 0)
        for key in ("input_tokens", "output_tokens", "estimated_cost_usd"):
            self.assertEqual((metrics[key]["count"], metrics[key]["denominator"]), (59, 60))
            self.assertEqual(result["missing_telemetry"]["baseline"][key], 1)
        self.assertTrue(result["recorded_telemetry_incomplete"])
        self.assertEqual(result["threshold_status"], "indeterminate")
        self.assertFalse(result["promotion_allowed"])
        reverse = self.compare_runs(candidate, baseline)
        self.assertEqual(reverse["threshold_checks"]["per_trial_cost_usd"]["status"], "indeterminate")
        self.assertEqual(reverse["threshold_checks"]["no_regression_diagnosis_accuracy"]["status"], "fail")

    def test_additional_uncertainty_requires_review(self):
        run = example(True)
        case = next(case for case, truth in ev.corpus().items() if truth["kind"] == "intermittent")
        original = next(row for row in run["trials"] if row["case_id"] == case)
        sentence = original["response"]["uncertainties"][0]
        for uncertainties in (
            [sentence + " The root cause is definitely a database outage."],
            [sentence, "Additional unreviewed context."],
        ):
            with self.subTest(uncertainties=uncertainties):
                candidate = deepcopy(run)
                row = next(row for row in candidate["trials"] if row["case_id"] == case)
                row["response"]["uncertainties"] = uncertainties
                report = self.replay(candidate)
                trial = next(row for row in report["trials"] if row["case_id"] == case)
                self.assertTrue(trial["schema_valid"])
                self.assertFalse(trial["abstention_correct"])
                self.assertTrue(trial["abstention_review_required"])
                self.assertEqual(report["metrics"]["correct_abstention"], ev.rate([True] * 4 + [False]))

    def test_login_witnesses_support_only_status_mismatch(self):
        run = example(True)
        for category, overstated_claim in (
            ("invalid-login-status-mismatch", "The invalid credentials were accepted."),
            ("valid-login-status-mismatch", "The valid login was rejected."),
        ):
            with self.subTest(category=category):
                candidate = deepcopy(run)
                trial = next(row for row in candidate["trials"] if row["response"]["category"] == category)
                claim = trial["response"]["claims"][0]
                self.assertEqual(claim["evidence_ids"], ["a1"])
                claim["statement"] = overstated_claim
                result = self.compare_runs(run, candidate)
                self.assertEqual(result["pending_review"]["candidate"]["claims"], 1)
                self.assertEqual(result["threshold_checks"]["unsupported_claims"]["status"], "indeterminate")
                self.assertEqual(result["threshold_checks"]["no_regression_claim_support"]["status"], "fail")

    def test_thresholds_check_cost_outlier_latency_boundary_and_empty_metrics(self):
        baseline = self.recorded_fixture("baseline")
        candidate = self.recorded_fixture("candidate")
        result = self.compare_runs(baseline, candidate)
        self.assertEqual(result["threshold_status"], "pass")
        self.assertFalse(result["promotion_allowed"])
        candidate["trials"][0]["response"]["estimated_cost_usd"] = 0.11
        candidate["trials"][0]["telemetry"]["estimated_cost_usd"] = 0.11
        for row in candidate["trials"][:4]:
            row["response"]["latency_ms"] = row["telemetry"]["latency_ms"] = 20_000
        result = self.compare_runs(baseline, candidate)
        self.assertEqual(result["candidate_metrics"]["estimated_cost_usd"]["p95"], 0)
        self.assertEqual(result["threshold_checks"]["per_trial_cost_usd"]["observed"], 0.11)
        for check in ("per_trial_cost_usd", "p95_latency_ms"):
            self.assertEqual(result["threshold_checks"][check]["status"], "fail")
        self.assertEqual(result["threshold_status"], "fail")
        for row in candidate["trials"]:
            row["response"] = None
        checks = self.compare_runs(baseline, candidate)["threshold_checks"]
        for check in ("citation_validity", "unsupported_claims", "no_regression_claim_support"):
            self.assertEqual(checks[check]["status"], "indeterminate")

    def test_comparison_regrades_and_checks_settings(self):
        left, right = example(), example(True)

        def compare(left_run, right_run, mutate=lambda raw: raw):
            a, b = ev.encode(left_run), ev.encode(right_run)
            return ev.compare(a, b, ev.encode(ev.replay(a)), mutate(ev.encode(ev.replay(b))),
                              ev.digest(a), ev.digest(b))

        self.assertFalse(compare(left, right)["promotion_allowed"])
        with self.assertRaisesRegex(ValueError, "report differs"):
            compare(left, right, lambda raw: raw + b" ")
        right["configuration"]["prompt_sha256"] = "f"*64
        for trial in right["trials"]:
            trial["response"]["prompt_sha256"] = "f"*64
        self.assertGreater(compare(left, right)["candidate_minus_baseline_rates"]["diagnosis_accuracy"], 0)
        right["configuration"]["parameters"]["max_tokens"] = 256
        for trial in right["trials"]:
            trial["response"]["parameters"]["max_tokens"] = 256
        with self.assertRaisesRegex(ValueError, "incompatible investigator settings"):
            compare(left, right)


class ProjectionTests(unittest.TestCase):
    def test_standalone_allowlisted_projection(self):
        truth = ev.corpus()
        visible = ev.decode((ev.ROOT / "model_visible/corpus-v1.json").read_bytes())
        self.assertEqual(visible.keys(), truth.keys())
        self.assertEqual(list(visible), sorted(visible))
        kinds = [truth[case_id]["kind"] == "defect" for case_id in visible]
        self.assertGreater(sum(left != right for left, right in zip(kinds, kinds[1:])), 1)
        for case_id in visible:
            self.assertRegex(case_id, r"^c-[0-9a-f]{16}$")
            value = projection.model_input(case_id)
            self.assertEqual(set(value), {"campaign_id", "observations"})
            self.assertEqual(value["campaign_id"], case_id)
            for row in value["observations"]:
                self.assertEqual(set(row), {"evidence_id", "observation"})
            for secret in [truth[case_id]["category"], "HELD_OUT_CANARY_0917", "reports/run-",
                           "ground_truth", "reference_code_revision"]:
                if secret:
                    self.assertNotIn(secret, json.dumps(value))
        with TemporaryDirectory() as folder:
            root = Path(folder)
            shutil.copyfile(projection.__file__, root / "projection.py")
            (root / "model_visible").mkdir()
            target = root / "model_visible/corpus-v1.json"
            shutil.copyfile(ev.ROOT / "model_visible/corpus-v1.json", target)
            cmd = [sys.executable, "-B", str(root / "projection.py")]
            good = subprocess.run(cmd + ["c-876a870bcba73cec"], capture_output=True, check=True)
            self.assertEqual(ev.decode(good.stdout), projection.model_input("c-876a870bcba73cec"))
            for key in ("q16", "c-0000000000000000", "../ground_truth/corpus-v1.json", "/etc/passwd",
                        "https://example.test/c-876a870bcba73cec"):
                rejected = subprocess.run(cmd + [key], capture_output=True)
                self.assertEqual((rejected.returncode, rejected.stdout), (2, b""))
            tampered = ev.decode(target.read_bytes())
            tampered["c-876a870bcba73cec"]["observations"][0]["observation"] += " PRIVATE_TEST_CANARY"
            target.write_bytes(ev.encode(tampered))
            rejected = subprocess.run(cmd + ["c-876a870bcba73cec"], capture_output=True)
            self.assertEqual((rejected.returncode, rejected.stdout), (2, b""))
            self.assertNotIn(b"PRIVATE_TEST_CANARY", rejected.stderr)
            target.unlink()
            target.symlink_to(ev.ROOT / "ground_truth/corpus-v1.json")
            rejected = subprocess.run(cmd + ["c-876a870bcba73cec"], capture_output=True)
            self.assertEqual((rejected.returncode, rejected.stdout), (2, b""))

    def test_modified_truth_fails_before_grading(self):
        raw = ev.encode(example())
        with patch.object(ev, "TRUTH_SHA", "0"*64), self.assertRaisesRegex(ValueError, "pinned"):
            ev.replay(raw)


if __name__ == "__main__":
    unittest.main()
