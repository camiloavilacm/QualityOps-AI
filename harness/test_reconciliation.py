"""Assertions about authored examples. No importer, decision service or model client."""
import hashlib
import json
import unittest

from jsonschema import ValidationError
from checks import ROOT, bundle, load, validator

CASES = ROOT / "samples/reconciliation"
VERSION = "2.0.0-draft.1"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def index(rows):
    indexed = {row["execution_id"]: row for row in rows}
    if len(indexed) != len(rows):
        raise ValueError("duplicate execution")
    return indexed


def fixture_facts(directory, evidence):
    """Check the fixture adapter's simple report format, independently of policy."""
    expected = index(evidence["expected"])
    observed = index(evidence["observed"])
    artifacts = {a["id"]: a for a in evidence["artifacts"]}
    if observed.keys() - expected.keys():
        raise ValueError("unexpected execution")
    for row in observed.values():
        refs = row["artifact_ids"]
        if row["outcome"] != "missing" and not refs:
            raise ValueError("observation lacks evidence")
        for ref in refs:
            artifact = artifacts.get(ref)
            if not artifact or artifact["kind"] != "execution-report":
                raise ValueError("unresolved execution report")
            report = load(directory / artifact["path"])
            if report != {k: row[k] for k in ("execution_id", "outcome", "observation")}:
                raise ValueError("report contradicts observation")
    complete = observed.keys() == expected.keys() and all(
        r["observation"] == "complete" and r["outcome"] != "missing" for r in observed.values())
    if complete != (evidence["completeness"] == "complete"):
        raise ValueError("inconsistent completeness")
    return observed


def required_matrix(policy, evidence):
    required = index(policy["required"])
    if index(evidence["expected"]) != required:
        raise ValueError("mandatory matrix differs from trusted policy")
    return required


class ReconciliationTests(unittest.TestCase):
    def test_policy_examples(self):
        cases = load(CASES / "expectations.json")
        policy = load(CASES / "policy.json")
        expected = {"pass": "ELIGIBLE", "fail": "BLOCKED", "partial": "INCONCLUSIVE",
                    "missing": "INCONCLUSIVE", "mixed": "BLOCKED", "tamper": None,
                    "unverified-failure": "INCONCLUSIVE", "partial-failure": "INCONCLUSIVE"}
        self.assertEqual(set(cases), set(expected))
        for name, outcome in expected.items():
            with self.subTest(case=name):
                directory = CASES / name
                case = cases[name]
                if outcome is None:
                    self.assertEqual(case, {"ingestion": "reject", "gate": None})
                    with self.assertRaisesRegex(ValueError, "digest mismatch"):
                        bundle(directory)
                    continue
                evidence = bundle(directory)
                rows = fixture_facts(directory, evidence)
                self.assertEqual(case["ingestion"], "accept")
                gate = case["gate"]
                validator("gate-decision").validate(gate)
                self.assertEqual(gate["decision"], outcome)
                self.assertEqual(gate["policy_sha256"], digest(CASES / "policy.json"))
                self.assertEqual(gate["policy_version"], policy["version"])
                self.assertEqual(gate["campaign_id"], evidence["campaign_id"])
                self.assertEqual(gate["evidence_sha256"], digest(directory / "evidence.json"))
                required = required_matrix(policy, evidence)
                receipts = load(ROOT / "harness/source-receipts.json")[evidence["campaign_id"]]
                artifacts = {a["id"]: a for a in evidence["artifacts"]}
                reasons = []
                for ident in sorted(required):
                    row = rows.get(ident, {})
                    refs = row.get("artifact_ids", [])
                    corroborated = len(refs) == 1 and receipts.get(ident) == artifacts[refs[0]]["sha256"]
                    if row.get("observation") != "complete" or not corroborated:
                        code = "INSUFFICIENT_EVIDENCE"
                    elif row["outcome"] == "failed":
                        code = "REQUIRED_FAILURE"
                    else:
                        self.assertEqual(row["outcome"], "passed")
                        code = "ALL_REQUIRED_PASSED"
                    reasons.append(dict(code=code, execution_id=ident, artifact_ids=row.get("artifact_ids", [])))
                codes = {r["code"] for r in reasons}
                inferred = "ELIGIBLE"
                if "REQUIRED_FAILURE" in codes:
                    inferred = "BLOCKED"
                elif "INSUFFICIENT_EVIDENCE" in codes:
                    inferred = "INCONCLUSIVE"
                if inferred != "ELIGIBLE":
                    reasons = [r for r in reasons if r["code"] != "ALL_REQUIRED_PASSED"]
                self.assertEqual(gate["decision"], inferred)
                self.assertEqual(gate["reasons"], reasons)

    def test_schema_valid_eligible_mutation_conflicts_with_policy_fixture(self):
        for name in ("missing", "partial", "partial-failure", "unverified-failure", "mixed"):
            expected = load(CASES / "expectations.json")[name]["gate"]
            altered = dict(expected, decision="ELIGIBLE")
            validator("gate-decision").validate(altered)
            self.assertNotEqual(altered["decision"], expected["decision"])
            self.assertIn("INSUFFICIENT_EVIDENCE", {r["code"] for r in expected["reasons"]})

    def test_semantic_rejections_after_schema_success(self):
        folder = CASES / "pass"
        for field, value, message in [("execution_id", "unknown", "unexpected execution"),
                                      ("artifact_ids", ["absent"], "unresolved"),
                                      ("outcome", "failed", "contradicts")]:
            with self.subTest(field=field):
                data = bundle(folder)
                data["observed"][0][field] = value
                validator("evidence").validate(data)
                with self.assertRaisesRegex(ValueError, message):
                    fixture_facts(folder, data)
        data = bundle(CASES / "missing")
        data["completeness"] = "complete"
        with self.assertRaisesRegex(ValueError, "completeness"):
            fixture_facts(CASES / "missing", data)

    def test_immutable_identity_examples(self):
        for case in load(CASES / "identity-examples.json"):
            existing = CASES / case["existing"] / "evidence.json"
            incoming = CASES / case["incoming"] / "evidence.json"
            data = load(incoming)
            if data["campaign_id"] != case["incoming_campaign_id"]:
                data["campaign_id"] = case["incoming_campaign_id"]
                candidate = (json.dumps(data, indent=2) + "\n").encode()
            else:
                candidate = incoming.read_bytes()
            self.assertEqual(load(existing)["campaign_id"], data["campaign_id"])
            self.assertEqual("idempotent" if existing.read_bytes() == candidate else "reject-conflict",
                             case["expected"])

    def test_bundle_cannot_shrink_or_redefine_mandatory_matrix(self):
        policy = load(CASES / "policy.json")
        data = bundle(CASES / "missing")
        data["expected"].pop()
        data["completeness"] = "complete"
        validator("evidence").validate(data)
        fixture_facts(CASES / "missing", data)
        with self.assertRaisesRegex(ValueError, "trusted policy"):
            required_matrix(policy, data)
        data = bundle(CASES / "pass")
        data["expected"][0]["test_id"] = "substitute"
        with self.assertRaisesRegex(ValueError, "trusted policy"):
            required_matrix(policy, data)

    def test_private_label_absent_from_source_fixtures(self):
        label = load(ROOT / "evaluators/ground_truth/reconciliation.json")["seeded_label"].encode()
        for path in (ROOT / "samples").rglob("*"):
            self.assertFalse(path.is_symlink())
            if path.is_file():
                self.assertNotIn(label, path.read_bytes(), path)

    def test_investigation(self):
        example = dict(schema_version=VERSION, campaign_id="fixture-fail", investigation_id="shape",
                       fixture_or_run_id="fixture-fail", evidence_sha256=digest(CASES/"fail/evidence.json"),
                       status="ERROR", claims=[], uncertainties=["Synthetic offline example"], category=None,
                       model_id="fixture-model", prompt_sha256="0"*64, tool_contract_version="v1",
                       parameters=dict(temperature=0, max_tokens=128), usage=None, estimated_cost_usd=None,
                       latency_ms=0)
        check = validator("investigation")
        for status in ("ERROR", "INCONCLUSIVE", "DIAGNOSED"):
            example["status"] = status
            if status == "DIAGNOSED":
                with self.assertRaises(ValidationError):
                    check.validate(example)
                example.update(category="fixture-category", claims=[dict(statement="Synthetic claim", evidence_ids=["x"])])
            check.validate(example)
        authorized_ids = {a["id"] for a in bundle(CASES / "fail")["artifacts"]}
        def resolve(document):
            for claim in document["claims"]:
                if set(claim["evidence_ids"]) - authorized_ids:
                    raise ValueError("citation outside bound evidence")
        resolve(example)
        dangling = dict(example, claims=[dict(statement="Synthetic claim", evidence_ids=["absent"])])
        check.validate(dangling)
        with self.assertRaisesRegex(ValueError, "citation outside"):
            resolve(dangling)
        with self.assertRaises(ValidationError):
            check.validate(dict(example, action="write"))

    def test_visible_inputs_are_exact_projection(self):
        directory = ROOT / "samples/model-visible"
        path = directory / "fixture-fail.json"
        self.assertFalse(directory.is_symlink())
        self.assertEqual(list(directory.iterdir()), [path])
        evidence = bundle(CASES / "fail")
        rows = fixture_facts(CASES / "fail", evidence)
        projected = dict(campaign_id=evidence["campaign_id"], observations=[
            dict(execution_id=i, outcome=row["outcome"], evidence_id=row["artifact_ids"][0])
            for i, row in rows.items()])
        label = load(ROOT / "evaluators/ground_truth/reconciliation.json")["seeded_label"]
        def verify(data):
            self.assertNotIn(label, json.dumps(data))
            self.assertEqual(data, projected)
        verify(load(path))
        for leaked in (dict(projected, diagnosis=label), dict(projected, grading_key="secret")):
            with self.assertRaises(AssertionError):
                verify(leaked)
