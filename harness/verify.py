"""Run offline verification in a write-restricted macOS child process."""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROFILE = """(version 1)
(allow default)
(deny network*)
(deny file-write*)
(allow file-write* (subpath (param "SCRATCH")) (literal "/dev/null"))
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--owner", choices=list(json.loads((HERE / "ownership.json").read_text())))
    parser.add_argument("--base")
    args = parser.parse_args()
    if bool(args.owner) != bool(args.base):
        parser.error("--owner and --base are required together")
    checks = {"contracts": ["checks.py", "contracts"], "tests": ["-m", "unittest", "discover", "-v"]}
    skipped = {"application and live checks": "outside Stage 0"}
    if args.owner:
        checks["file scope"] = ["checks.py", "scope", args.owner, args.base]
    else:
        skipped["candidate file scope"] = "no owner and approved baseline supplied"
    records = []
    with tempfile.TemporaryDirectory() as tmp:
        scratch = str(Path(tmp).resolve())
        env = dict(PATH="/usr/bin:/bin", HOME=scratch, TMPDIR=scratch, GIT_CONFIG_NOSYSTEM="1",
                   GIT_OPTIONAL_LOCKS="0", PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1")
        for name, command in checks.items():
            argv = ["/usr/bin/sandbox-exec", "-D", "SCRATCH=" + scratch, "-p", PROFILE,
                    sys.executable, "-B", *command]
            try:
                run = subprocess.run(argv, cwd=HERE, env=env, capture_output=True, text=True, timeout=60)
                code, output = run.returncode, run.stdout + run.stderr
            except (OSError, subprocess.TimeoutExpired) as exc:
                code, output = None, type(exc).__name__
            records.append(dict(check=name, command=argv, exit_code=code,
                                result="PASS" if code == 0 else "FAIL", output=output))
            print(name, records[-1]["result"])
    for name, reason in skipped.items():
        records.append(dict(check=name, command=None, exit_code=None, result="NOT RUN", reason=reason))
    report = {"checks": records, "contract_freeze": "Pending human review; harness success cannot authorize freeze"}
    # Replace atomically so an interrupted write cannot publish half a report.
    with tempfile.NamedTemporaryFile(mode="w", dir=None if args.owner else HERE, delete=False) as dest:
        json.dump(report, dest, indent=2)
        dest.write("\n")
    if args.owner:
        print("Candidate verification report", dest.name)
    else:
        os.replace(dest.name, HERE / "verification.json")
    return int(any(r["result"] == "FAIL" for r in records))


if __name__ == "__main__":
    sys.exit(main())
