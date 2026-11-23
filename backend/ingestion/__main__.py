"""Command-line entry point for local campaign import."""
import argparse
import sys

from .importer import ImportError, import_campaign, load_config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="local campaign directory")
    parser.add_argument("store", help="private local evidence store")
    parser.add_argument("--config", required=True, help="independently trusted receipt and matrix JSON")
    args = parser.parse_args()
    try:
        result = import_campaign(args.source, args.store, load_config(args.config))
    except ImportError as exc:
        print(f"Import rejected: {exc}", file=sys.stderr)
        return 1
    except OSError:
        print("Import rejected: cannot open trusted configuration", file=sys.stderr)
        return 1
    print("Created" if result.created else "Already imported", result.evidence_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
