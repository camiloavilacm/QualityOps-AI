import json
import shutil
import subprocess
import socket
import tempfile
import unittest
from pathlib import Path

from jsonschema import ValidationError
from checks import ROOT, bundle, load, scope, validator


class BundleTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name) / "bundle"
        shutil.copytree(ROOT / "samples/minimal", self.root)
        self.file = self.root / "evidence.json"
        self.manifest = load(self.file)

    def reject_manifest(self, error):
        self.file.write_text(json.dumps(self.manifest))
        with self.assertRaises(error):
            bundle(self.root, legacy=True)

    def test_valid_requirement(self):
        bundle(self.root, legacy=True)

    def test_missing_revision(self):
        del self.manifest["revision"]
        self.reject_manifest(ValidationError)

    def test_path_traversal(self):
        self.manifest["artifacts"][0]["path"] = "../outside"
        self.reject_manifest(ValidationError)

    def test_duplicate_id_with_distinct_path(self):
        item = self.manifest["artifacts"][0]
        self.manifest["artifacts"].append(dict(item, path="artifacts/other"))
        self.reject_manifest(ValueError)

    def test_duplicate_key(self):
        self.file.write_text(self.file.read_text().replace('"revision":', '"revision":"bad","revision":'))
        with self.assertRaisesRegex(ValueError, "duplicate JSON key"):
            bundle(self.root, legacy=True)

    def test_tamper(self):
        (self.root / "artifacts/login.feature").write_bytes(b"altered")
        with self.assertRaisesRegex(ValueError, "digest mismatch"):
            bundle(self.root, legacy=True)

    def test_symlink_directory(self):
        source = self.root / "artifacts"
        moved = self.root.parent / "elsewhere"
        source.rename(moved)
        source.symlink_to(moved)
        with self.assertRaisesRegex(ValueError, "unsafe artifact directory"):
            bundle(self.root, legacy=True)


class DraftOutputTests(unittest.TestCase):
    def test_synthetic_output_shapes(self):
        binding = dict(schema_version="1.0.0", bundle_id="shape-only", manifest_sha256="0" * 64)
        examples = [
            ("gate-decision", dict(binding, outcome="block", policy_sha256="0" * 64,
             checks=[dict(rule_id="required", status="missing", artifact_ids=[])]), "outcome"),
            ("investigation", dict(binding, status="unavailable", findings=[],
             limitations=["Synthetic shape example"]), "status"),
        ]
        for name, example, field in examples:
            with self.subTest(schema=name):
                check = validator(name, legacy=True)
                check.validate(example)
                example[field] = "unknown"
                with self.assertRaises(ValidationError):
                    check.validate(example)


class ExecutionTests(unittest.TestCase):
    def test_local_network_bind_denied(self):
        with socket.socket() as sock, self.assertRaises(PermissionError):
            sock.bind(("127.0.0.1", 0))

    def test_repo_write_denied(self):
        with self.assertRaises(PermissionError):
            with tempfile.TemporaryFile(dir=ROOT):
                pass

    def test_owner_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root)
            git("init", "-q")
            git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
                "commit", "-qm", "fixture", "--allow-empty")
            base = git("rev-parse", "HEAD").decode().strip()
            # Rehearse the clean post-baseline review with local checkout noise.
            (root / ".DS_Store").touch()
            git("init", "-q", "QualityOps-AI")
            scope(root, "reviewer", base)
            for role, directory in [("A", "backend/gate"), ("B", "evaluators"), ("C", "frontend")]:
                folder = root / directory
                folder.mkdir(parents=True)
                path = folder / "fixture"
                path.touch()
                scope(root, role, base)
                with self.assertRaisesRegex(ValueError, "outside"):
                    scope(root, "reviewer", base)
                path.unlink()
            (root / "SPEC.md").touch()
            git("add", "SPEC.md")
            with self.assertRaisesRegex(ValueError, "outside"):
                scope(root, "A", base)
