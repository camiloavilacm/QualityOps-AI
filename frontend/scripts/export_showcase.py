"""Reproduce the sanitized multi-campaign and offline evaluation showcase export.

Consumes only validated local gate replays, offline authored investigator examples,
and deterministic evaluator comparison summaries. Never exports raw artifact paths,
source receipts, credentials, or held-out ground truth.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "samples/reconciliation"
DESTINATION = ROOT / "frontend/src/showcase-export.json"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "evaluators") not in sys.path:
    sys.path.insert(0, str(ROOT / "evaluators"))

from backend.investigator.examples import CASE, FINDING, Script, answer, backend, read  # noqa: E402
from backend.investigator.investigator import invoke  # noqa: E402
from authored_examples import example  # noqa: E402
import evaluate as ev  # noqa: E402
import projection  # noqa: E402


def run_gate(bundle_name):
    bundle = FIXTURES / bundle_name
    manifest_bytes = (bundle / "evidence.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    result = subprocess.run(
        [
            sys.executable, "-B", "-m", "backend.gate", str(bundle),
            "--policy", str(FIXTURES / "policy.json"),
            "--receipt", str(ROOT / "harness/source-receipts.json"),
            "--evaluated-at", "2026-11-19T00:00:00Z",
        ],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    gate = json.loads(result.stdout)
    if gate["evidence_sha256"] != hashlib.sha256(manifest_bytes).hexdigest():
        raise ValueError(f"Gate digest mismatch for {bundle_name}")
    evidence = [{"id": item["id"], "kind": item["kind"]} for item in manifest["artifacts"]]
    return manifest, gate, evidence


def sanitize_investigation(result, source_note):
    return {
        "run_id": result["fixture_or_run_id"],
        "status": result["status"],
        "category": result["category"],
        "claims": [
            {"statement": c["statement"], "evidence_ids": list(c["evidence_ids"])}
            for c in result["claims"]
        ],
        "uncertainties": list(result["uncertainties"]),
        "model_id": result["model_id"],
        "tool_contract_version": result["tool_contract_version"],
        "offline": True,
        "source_note": source_note,
    }


def build_showcase():
    # 1. Mixed campaign (BLOCKED, REQUIRED_FAILURE + INSUFFICIENT_EVIDENCE, absent investigation)
    mixed_manifest, mixed_gate, mixed_evidence = run_gate("mixed")

    # 2. Passing campaign (ELIGIBLE, absent investigation)
    pass_manifest, pass_gate, pass_evidence = run_gate("pass")

    # 3. Partial evidence campaign (INCONCLUSIVE gate + INCONCLUSIVE offline investigation)
    partial_manifest, partial_gate, partial_evidence = run_gate("partial")
    partial_inv, _ = invoke(
        {"fixture_id": "fixture-partial"},
        backend=backend(Script(read("y"), answer(status="INCONCLUSIVE"))),
        run_id="showcase-partial",
    )

    # 4. Failing campaign (BLOCKED gate + ERROR offline investigation outage)
    fail_manifest, fail_gate, fail_evidence = run_gate("fail")
    fail_inv, _ = invoke(
        {"fixture_id": "fixture-fail"},
        backend=backend(Script(RuntimeError("simulated Bedrock outage"))),
        run_id="showcase-outage",
    )

    # 5. Projected defect case (cited DIAGNOSED offline investigation)
    diag_fixture = projection.model_input(CASE)
    diag_inv, _ = invoke(
        {"fixture_id": CASE},
        backend=backend(Script(read("a1", "a2"), answer(**FINDING))),
        run_id="showcase-diagnosed",
    )
    diag_evidence = [
        {"id": obs["evidence_id"], "kind": "sanitized-observation"}
        for obs in diag_fixture["observations"]
    ]

    campaigns = [
        {
            "id": mixed_gate["campaign_id"],
            "title": "Mixed campaign",
            "summary": "Confirmed required failure on x plus missing evidence on y.",
            "source_kind": "synthetic",
            "completeness": mixed_manifest["completeness"],
            "gate": mixed_gate,
            "evidence": mixed_evidence,
            "investigation": None,
        },
        {
            "id": pass_gate["campaign_id"],
            "title": "Passing campaign",
            "summary": "All required executions passed with complete verified evidence.",
            "source_kind": "synthetic",
            "completeness": pass_manifest["completeness"],
            "gate": pass_gate,
            "evidence": pass_evidence,
            "investigation": None,
        },
        {
            "id": partial_gate["campaign_id"],
            "title": "Partial evidence campaign",
            "summary": "No confirmed failure, but missing execution evidence prevents eligibility.",
            "source_kind": "synthetic",
            "completeness": partial_manifest["completeness"],
            "gate": partial_gate,
            "evidence": partial_evidence,
            "investigation": sanitize_investigation(
                partial_inv,
                "Offline authored replay demonstrating calibrated abstention on partial evidence.",
            ),
        },
        {
            "id": fail_gate["campaign_id"],
            "title": "Failing campaign (investigator outage)",
            "summary": "Confirmed required failure blocks release even when the AI investigator errors.",
            "source_kind": "synthetic",
            "completeness": fail_manifest["completeness"],
            "gate": fail_gate,
            "evidence": fail_evidence,
            "investigation": sanitize_investigation(
                fail_inv,
                "Offline simulated outage showing ERROR status does not alter the BLOCKED gate.",
            ),
        },
        {
            "id": CASE,
            "title": "Projected defect investigation",
            "summary": "Read-only offline investigator producing cited claims against sanitized observations.",
            "source_kind": "model-visible-projection",
            "completeness": "complete",
            "gate": None,
            "evidence": diag_evidence,
            "investigation": sanitize_investigation(
                diag_inv,
                "Offline authored Converse exchange citing allowlisted evidence IDs a1 and a2.",
            ),
        },
    ]

    # Deterministic offline evaluation comparison (authored baseline vs candidate, 0 live trials)
    base_raw = ev.encode(example(False))
    cand_raw = ev.encode(example(True))
    base_sha = ev.digest(base_raw)
    cand_sha = ev.digest(cand_raw)
    base_report = ev.replay(base_raw, base_sha)
    cand_report = ev.replay(cand_raw, cand_sha)
    comparison = ev.compare(
        base_raw, cand_raw, ev.encode(base_report), ev.encode(cand_report), base_sha, cand_sha
    )

    def pick_metrics(report):
        m = report["metrics"]
        return {
            "diagnosis_accuracy": m["diagnosis_accuracy"],
            "citation_validity": m["citation_validity"],
            "claim_support": m["claim_support"],
            "correct_abstention": m["correct_abstention"],
            "invalid_output": m["invalid_output"],
            "safety_violation": m["safety_violation"],
            "pass@3": m["pass@3"],
            "pass^3": m["pass^3"],
        }

    evaluation = {
        "source": "authored",
        "live_trials": 0,
        "corpus_version": cand_report["corpus_version"],
        "grader_version": cand_report["grader_version"],
        "case_count": len(cand_report["trials"]),
        "promotion_allowed": comparison["promotion_allowed"],
        "threshold_status": comparison["threshold_status"],
        "baseline_run_id": base_report["run_id"],
        "candidate_run_id": cand_report["run_id"],
        "baseline_metrics": pick_metrics(base_report),
        "candidate_metrics": pick_metrics(cand_report),
        "checks": comparison["threshold_checks"],
    }

    return {
        "export_version": "1.0.0",
        "campaigns": campaigns,
        "evaluation": evaluation,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare without writing")
    args = parser.parse_args()
    data = (json.dumps(build_showcase(), indent=2, sort_keys=True) + "\n").encode()
    if args.check:
        if not DESTINATION.exists() or DESTINATION.read_bytes() != data:
            raise SystemExit("Showcase export differs from validated replay")
        print(hashlib.sha256(data).hexdigest())
    else:
        DESTINATION.write_bytes(data)
        print(hashlib.sha256(data).hexdigest())


if __name__ == "__main__":
    main()
