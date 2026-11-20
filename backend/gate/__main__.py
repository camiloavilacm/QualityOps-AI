"""Replay a local v2 release decision."""
import argparse
from datetime import datetime, timezone
import sys

from ..ingestion import importer as a1
from .replay import replay, schema, validate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", help="local bundle directory containing evidence.json")
    parser.add_argument("--policy", required=True, help="operator-approved policy JSON outside the bundle")
    parser.add_argument("--receipt", required=True, help="operator-approved source receipt JSON outside the bundle")
    parser.add_argument("--scratch", help="private scratch parent for A1 source replay")
    parser.add_argument("--evaluated-at", help="optional RFC 3339 replay timestamp")
    args = parser.parse_args()
    try:
        result = replay(args.bundle, args.policy, args.receipt, scratch=args.scratch)
        result["evaluated_at"] = args.evaluated_at
        if result["evaluated_at"] is None:
            result["evaluated_at"] = datetime.now(timezone.utc).isoformat()
        validate(result, schema("gate-decision"), "invalid decision metadata or content")
    except a1.ImportError as exc:
        print(f"Gate rejected: {exc}", file=sys.stderr)
        return 1
    except (OSError, RuntimeError):
        print("Gate rejected: unavailable or unsafe local input", file=sys.stderr)
        return 1
    sys.stdout.write(a1.encode(result).decode())
    return 0


if __name__ == "__main__":
    sys.exit(main())
