"""Read-only model input boundary. This module has no grader or truth dependency."""

from hashlib import sha256
import json
from pathlib import Path
import re

VISIBLE_SHA256 = "47ecb24515dc1d8d4230095742c4a7ddd1c16272fe2fa42095ca3feb3ad7c5e4"


def model_input(case_id):
    if not isinstance(case_id, str) or not re.fullmatch(r"c-[0-9a-f]{16}", case_id):
        raise ValueError("unknown case ID")
    directory = Path(__file__).resolve().parent / "model_visible"
    path = directory / "corpus-v1.json"
    if directory.is_symlink() or path.is_symlink():
        raise ValueError("symlink in model input path")
    with path.open("rb") as stream:
        raw = stream.read(32769)
    if sha256(raw).hexdigest() != VISIBLE_SHA256:
        raise ValueError("model input digest mismatch")
    fixtures = json.loads(raw)
    if case_id not in fixtures:
        raise ValueError("unknown case ID")
    return fixtures[case_id]


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case_id")
    args = parser.parse_args()
    try:
        print(json.dumps(model_input(args.case_id), indent=2, sort_keys=True))
    except (ValueError, OSError):
        parser.exit(2, "model input unavailable\n")
