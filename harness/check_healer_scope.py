"""Revision-only Healer scope check. No working-tree file is overlaid implicitly."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPECS = {
    "frontend/tests/seed.spec.ts", "frontend/tests/mixed-campaign.spec.ts",
    "frontend/tests/dashboard-flows.spec.ts",
}


def git(root, *args):
    return subprocess.check_output(
        ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", *args],
        cwd=root, stderr=subprocess.DEVNULL, timeout=30,
    )


def revision(root, value):
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("a full immutable commit SHA is required")
    resolved = git(root, "rev-parse", "--verify", value + "^{commit}").decode().strip()
    if resolved != value:
        raise ValueError("revision does not name the exact commit")
    return resolved


def check_scope(root, verifier, candidate):
    revision(root, verifier)
    revision(root, candidate)
    # No rename detection: both sides of a rename become a forbidden add/delete.
    raw = git(root, "diff", "--raw", "-z", "--no-renames", "--no-ext-diff",
              "--no-textconv", verifier, candidate).split(b"\0")
    changed = []
    for offset in range(0, len(raw) - 1, 2):
        header, name = raw[offset:offset + 2]
        fields = header.decode("ascii").split()
        path = name.decode("utf-8", errors="strict")
        if path not in SPECS or fields[0] != ":100644" or fields[1] != "100644" or fields[4] != "M":
            raise ValueError("outside approved ordinary-spec modification scope: " + repr(path))
        content = git(root, "show", candidate + ":" + path)
        if len(content) > 256 * 1024:
            raise ValueError("spec exceeds bounded source size")
        changed.append({"path": path, "sha256": hashlib.sha256(content).hexdigest()})
    return {"result": "PASS", "verifier_revision": verifier,
            "candidate_revision": candidate, "changes": changed,
            "working_tree": "excluded; only immutable commit objects are inputs"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verifier-revision", required=True)
    parser.add_argument("--candidate-revision", required=True)
    args = parser.parse_args()
    try:
        report = check_scope(ROOT, args.verifier_revision, args.candidate_revision)
    except (ValueError, OSError, subprocess.SubprocessError, UnicodeError) as exc:
        report = {"result": "FAIL", "reason": str(exc)}
    print(json.dumps(report, indent=2))
    return report["result"] != "PASS"


if __name__ == "__main__":
    raise SystemExit(main())
