"""Local Stage 0 fixture and Git scope checks."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry

ROOT = Path(__file__).resolve().parents[1]
def unique_object(pairs):
    obj = dict(pairs)
    if len(obj) != len(pairs):
        raise ValueError("duplicate JSON key")
    return obj


def load(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("expected regular file")
    return json.loads(path.read_bytes(), object_pairs_hook=unique_object)


def validator(name, legacy=False):
    folder = ROOT / "contracts" / ("v1" if legacy else "v2")
    schema = load(folder / f"{name}.schema.json")
    version = schema["properties"]["schema_version"]["const"]
    if folder.name != "v" + version.split(".")[0] or schema["$id"] != f"urn:qualityops:{name}:{version}":
        raise ValueError("schema location or identifier conflicts with wire version")
    if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
        raise ValueError("unexpected schema dialect")
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, registry=Registry(), format_checker=FormatChecker())


def bundle(directory, legacy=False):
    manifest = load(directory / "evidence.json")
    validator("evidence", legacy).validate(manifest)
    ids, paths = set(), set()
    for item in manifest["artifacts"]:
        path = directory / item["path"]
        if item["id"] in ids or path in paths:
            raise ValueError("duplicate artifact identity")
        if path.parent != directory / "artifacts" or path.parent.is_symlink():
            raise ValueError("unsafe artifact directory")
        if path.is_symlink() or not path.is_file():
            raise ValueError("expected regular artifact")
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("artifact digest mismatch")
        ids.add(item["id"])
        paths.add(path)
    expected = paths | {directory / "evidence.json"}
    if paths:
        expected.add(directory / "artifacts")
    if directory.is_symlink() or set(directory.rglob("*")) != expected:
        raise ValueError("unexpected bundle entry")
    return manifest


def scope(root, role, base):
    allowed = load(ROOT / "harness/ownership.json")[role]
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root)

    # A supplied full commit anchors committed changes as well as local edits.
    if len(base) != 40 or any(c not in "0123456789abcdef" for c in base):
        raise ValueError("supply the full approved baseline SHA")
    git("merge-base", "--is-ancestor", base, "HEAD")
    names = set()
    for args in [
        ("diff", "--name-only", "-z", "--no-renames", base, "HEAD"),
        ("diff", "--cached", "--name-only", "-z", "--no-renames", "HEAD"),
        ("diff", "--name-only", "-z", "--no-renames"),
        ("ls-files", "--others", "--exclude=/.DS_Store", "--exclude=/QualityOps-AI/", "-z"),
    ]:
        names.update(os.fsdecode(n) for n in git(*args).split(b"\0") if n)
    for name in sorted(names):
        path = root / name
        if not any(name.startswith(p) if p.endswith("/") else name == p for p in allowed):
            raise ValueError(f"outside {role} scope: {name!r}")
        if any(p.is_symlink() for p in (path, *path.parents)):
            raise ValueError("symlink in changed path")
        if path.is_dir() or git("ls-files", "--stage", "--", name).startswith(b"160000 "):
            raise ValueError("nested repository")


if __name__ == "__main__":
    if sys.argv[1] == "contracts":
        for contract in ("evidence", "gate-decision", "investigation"):
            validator(contract)
        bundle(ROOT / "samples/minimal", legacy=True)
        print("Three schemas and the requirement bundle validated.")
    elif sys.argv[1] == "scope":
        scope(ROOT, *sys.argv[2:])
    else:
        sys.exit(2)
