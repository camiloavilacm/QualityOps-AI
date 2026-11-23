"""Reproduce the allowlisted local dashboard fixture from the validated gate CLI."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "samples/reconciliation"
BUNDLE = FIXTURES / "mixed"
DESTINATION = ROOT / "frontend/src/mixed-campaign.json"


def export():
    manifest_bytes = (BUNDLE / "evidence.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    result = subprocess.run(
        [sys.executable, "-B", "-m", "backend.gate", str(BUNDLE),
         "--policy", str(FIXTURES / "policy.json"),
         "--receipt", str(ROOT / "harness/source-receipts.json"),
         "--evaluated-at", "2026-11-19T00:00:00Z"],
        cwd=ROOT, check=True, capture_output=True,
    )
    gate = json.loads(result.stdout)
    if (manifest["source"]["kind"] != "synthetic"
            or gate["campaign_id"] != "fixture-mixed"
            or gate["evidence_sha256"] != hashlib.sha256(manifest_bytes).hexdigest()):
        raise ValueError("Gate decision does not match the synthetic fixture")
    expected = json.loads((FIXTURES / "expectations.json").read_bytes())["mixed"]["gate"]
    if gate != expected:
        raise ValueError("Gate replay differs from the frozen mixed fixture expectation")

    # The gate CLI validates this closed v2 record. Export its approved fields
    # and two fields per evidence descriptor. The source manifest and report stay private.
    return {
        "export_version": "1.0.0",
        "source_kind": "synthetic",
        "completeness": manifest["completeness"],
        "gate": gate,
        "evidence": [{key: item[key] for key in ("id", "kind")}
                     for item in manifest["artifacts"]],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare without writing")
    args = parser.parse_args()
    data = (json.dumps(export(), indent=2, sort_keys=True) + "\n").encode()
    if args.check:
        if DESTINATION.read_bytes() != data:
            raise SystemExit("Dashboard export differs from validated replay")
        print(hashlib.sha256(data).hexdigest())
    else:
        DESTINATION.write_bytes(data)


if __name__ == "__main__":
    main()
