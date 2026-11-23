"""Stage 2 vertical-slice integration tests across A1, B1/B2, and C1.

Exercises the offline vertical slice without paid Bedrock calls:
  verified evidence -> pure deterministic gate -> read-only offline investigator
  -> independent held-out grader -> sanitized static dashboard export.
"""
import ast
import json
from pathlib import Path
import subprocess
import sys
import unittest

from backend.investigator.examples import CASE, FINDING, Script, answer, backend, read
from backend.investigator.investigator import invoke

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "evaluators") not in sys.path:
    sys.path.insert(0, str(ROOT / "evaluators"))

import evaluate as ev  # noqa: E402
import projection  # noqa: E402
FORBIDDEN_GATE_IMPORTS = {
    "backend.investigator",
    "evaluators",
    "boto3",
    "botocore",
    "urllib",
    "http",
    "socket",
    "requests",
}


class VerticalSliceIntegrationTests(unittest.TestCase):
    def test_gate_has_no_ai_evaluator_or_network_dependencies(self):
        gate_files = sorted((ROOT / "backend/gate").glob("*.py"))
        self.assertTrue(gate_files, "expected Python modules in backend/gate/")
        for path in gate_files:
            if path.name.startswith("test_"):
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        top = alias.name.split(".")[0]
                        self.assertNotIn(alias.name, FORBIDDEN_GATE_IMPORTS, f"{path}: {alias.name}")
                        self.assertNotIn(top, FORBIDDEN_GATE_IMPORTS, f"{path}: {alias.name}")
                elif isinstance(node, ast.ImportFrom) and node.module:
                    top = node.module.split(".")[0]
                    self.assertNotIn(node.module, FORBIDDEN_GATE_IMPORTS, f"{path}: {node.module}")
                    self.assertNotIn(top, FORBIDDEN_GATE_IMPORTS, f"{path}: {node.module}")

    def test_mixed_campaign_gate_and_sanitized_dashboard_export(self):
        gate_proc = subprocess.run(
            [
                sys.executable, "-B", "-m", "backend.gate",
                str(ROOT / "samples/reconciliation/mixed"),
                "--policy", str(ROOT / "samples/reconciliation/policy.json"),
                "--receipt", str(ROOT / "harness/source-receipts.json"),
                "--evaluated-at", "2026-11-19T00:00:00Z",
            ],
            cwd=ROOT, check=True, capture_output=True, text=True,
        )
        gate_decision = json.loads(gate_proc.stdout)
        self.assertEqual(gate_decision["decision"], "BLOCKED")
        reason_codes = {r["code"]: r["execution_id"] for r in gate_decision["reasons"]}
        self.assertEqual(reason_codes, {"REQUIRED_FAILURE": "x", "INSUFFICIENT_EVIDENCE": "y"})

        # Verify investigator operational failure cannot alter the canonical gate decision.
        class FailingClient:
            def converse(self, **_kwargs):
                raise RuntimeError("simulated Bedrock outage")

        inv_result, _audit = invoke({"fixture_id": CASE}, backend=backend(FailingClient()), run_id="stage2-outage")
        self.assertEqual(inv_result["status"], "ERROR")

        gate_after_proc = subprocess.run(
            [
                sys.executable, "-B", "-m", "backend.gate",
                str(ROOT / "samples/reconciliation/mixed"),
                "--policy", str(ROOT / "samples/reconciliation/policy.json"),
                "--receipt", str(ROOT / "harness/source-receipts.json"),
                "--evaluated-at", "2026-11-19T00:00:00Z",
            ],
            cwd=ROOT, check=True, capture_output=True, text=True,
        )
        self.assertEqual(gate_proc.stdout, gate_after_proc.stdout)

        # Verify C1 sanitized export matches gate replay and leaks no held-out ground truth.
        export_proc = subprocess.run(
            [sys.executable, "-B", str(ROOT / "frontend/scripts/export_mixed.py"), "--check"],
            cwd=ROOT, check=True, capture_output=True, text=True,
        )
        self.assertEqual(
            export_proc.stdout.strip(),
            "1bdda5cadd7c835f08123d29af8c56eb51c7356cdd9153bd34c865c0c84f0662",
        )
        exported_text = (ROOT / "frontend/src/mixed-campaign.json").read_text(encoding="utf-8")
        exported = json.loads(exported_text)
        self.assertEqual(exported["gate"], gate_decision)
        self.assertEqual(exported["completeness"], "partial")
        self.assertEqual(exported["evidence"], [{"id": "x", "kind": "execution-report"}])
        self.assertNotIn("artifacts/", exported_text)
        self.assertNotIn("ground_truth", exported_text)

    def test_offline_investigator_to_independent_grader_and_ground_truth_isolation(self):
        script = Script(read("a1", "a2"), answer(**FINDING))
        result, audit = invoke({"fixture_id": CASE}, backend=backend(script), run_id="stage2-slice")
        self.assertTrue(audit["offline"])
        self.assertEqual(result["status"], "DIAGNOSED")

        fixture = projection.model_input(CASE)
        truth = ev.corpus()[CASE]
        # Ensure held-out ground-truth root-cause category is absent from model-visible fixture.
        fixture_text = json.dumps(fixture, sort_keys=True)
        self.assertNotIn("expected_category", fixture_text)
        self.assertNotIn("ground_truth", fixture_text)

        row = {
            key: result[key]
            for key in ("campaign_id", "investigation_id", "fixture_or_run_id", "evidence_sha256")
        }
        row.update(
            case_id=CASE,
            trial=1,
            response=result,
            protocol_valid=True,
            safety=dict.fromkeys(ev.SAFETY, False),
            telemetry=dict(
                result["usage"],
                latency_ms=result["latency_ms"],
                estimated_cost_usd=result["estimated_cost_usd"],
            ),
        )
        config = {
            key: result[key]
            for key in ("model_id", "prompt_sha256", "tool_contract_version", "parameters")
        }
        grade = ev.grade(row, {"source": "recorded", "run_id": "stage2-slice"}, config,
                         truth, fixture, ev.validators()[0])
        self.assertEqual(grade["claims"], [{"citation_exists": [True, True], "support": "review_required"}])

    def test_showcase_export_covers_all_gate_and_investigation_states_without_leakage(self):
        proc = subprocess.run(
            [sys.executable, "-B", str(ROOT / "frontend/scripts/export_showcase.py"), "--check"],
            cwd=ROOT, check=True, capture_output=True, text=True,
        )
        self.assertEqual(len(proc.stdout.strip()), 64)
        raw = (ROOT / "frontend/src/showcase-export.json").read_text(encoding="utf-8")
        self.assertNotIn("artifacts/", raw)
        self.assertNotIn("ground_truth", raw)
        self.assertNotIn("expected_category", raw)
        data = json.loads(raw)
        gate_decisions = {c["gate"]["decision"] for c in data["campaigns"] if c["gate"]}
        self.assertEqual(gate_decisions, {"ELIGIBLE", "BLOCKED", "INCONCLUSIVE"})
        inv_statuses = {c["investigation"]["status"] if c["investigation"] else None for c in data["campaigns"]}
        self.assertEqual(inv_statuses, {"DIAGNOSED", "INCONCLUSIVE", "ERROR", None})
        self.assertFalse(data["evaluation"]["promotion_allowed"])
        self.assertEqual(data["evaluation"]["live_trials"], 0)


if __name__ == "__main__":
    unittest.main()
