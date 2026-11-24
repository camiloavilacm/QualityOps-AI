"""Offline component checks; these do NOT prove Docker runtime enforcement."""
import copy
import json
import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from unittest.mock import MagicMock
from pathlib import Path

# Script entry points intentionally have no third-party dependencies.
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_healer_scope import check_scope, revision
from pr_verification import (Blocked, bounded_command, cleanup_container, collect_publication,
                             docker_arguments, evidence_files, export_files, read_json,
                             reap_command_group, require_preparation_space, verify_inspection)

POLICY = json.loads((Path(__file__).parent / "container/runtime-policy.json").read_bytes())


def inspection(tests, evidence):
    return {"Config": {"User": "pwuser"}, "HostConfig": {
        "NetworkMode": "none", "ReadonlyRootfs": True, "Privileged": False, "Memory": 4294967296,
        "MemorySwap": 4294967296, "NanoCpus": 2000000000, "PidsLimit": 512, "ShmSize": 1073741824,
        "IpcMode": "private", "CapAdd": ["SYS_CHROOT"], "CapDrop": ["ALL"],
        "SecurityOpt": ["no-new-privileges=true", "seccomp={reviewed-profile}"]},
        "Mounts": [{"Type": "bind", "Source": str(tests), "Destination": "/opt/qualityops/frontend/tests", "RW": False},
                   {"Type": "bind", "Source": str(evidence), "Destination": "/evidence", "RW": True}]}


class IsolationConfigurationTests(unittest.TestCase):
    def test_signal_denial_reaps_exited_child_but_blocks_unproven_live_group_cleanup(self):
        for status in (0, None):
            child = MagicMock(); child.pid = 123; child.poll.return_value = status
            with patch('pr_verification.os.killpg', side_effect=PermissionError):
                if status is None:
                    with self.assertRaisesRegex(Blocked, 'live child'): reap_command_group(child)
                    child.kill.assert_called_once()
                else:
                    reap_command_group(child)
                    child.kill.assert_not_called()
                child.wait.assert_called_once_with(timeout=5)

    def test_prevalidation_scans_container_only_while_host_report_reserve_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root/'container/e2e').mkdir(parents=True)
            (root/'.report-reserve').write_bytes(b'reserved report capacity')
            file = root/'container/e2e/report.json'; file.write_text('{}')
            self.assertEqual(evidence_files(root/'container', name_prefix='container/'),
                             [(file, 'container/e2e/report.json')])
            with self.assertRaises(Blocked): evidence_files(root)

    def test_image_preparation_blocks_before_low_disk_can_exhaust_reports(self):
        with patch('pr_verification.shutil.disk_usage') as usage:
            usage.return_value.free = 2 * 1024**3
            with self.assertRaisesRegex(Blocked, '10 GiB'): require_preparation_space(Path('/tmp'))
            usage.return_value.free = 10 * 1024**3
            require_preparation_space(Path('/tmp'))

    def test_live_monitor_tolerates_vanished_temporary_file_but_final_scan_is_strict(self):
        with tempfile.TemporaryDirectory() as tmp:
            entry = MagicMock()
            entry.stat.side_effect = FileNotFoundError('temporary trace file disappeared')
            for tolerant in (True, False):
                entries = MagicMock()
                entries.__enter__.return_value = [entry]
                with patch('pr_verification.os.scandir', return_value=entries):
                    if tolerant:
                        self.assertEqual(evidence_files(Path(tmp), enforce_names=False, tolerate_vanished=True), [])
                    else:
                        with self.assertRaises(FileNotFoundError): evidence_files(Path(tmp))

    def test_publication_copies_only_bounded_regular_allowlisted_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'output'; (root/'container/guard').mkdir(parents=True)
            (root/'container/guard/report.json').write_text('{"fixture":"safe"}')
            (root/'summary.json').write_text('{}')
            report = {'result': 'PASS'}
            collect_publication(root, report)
            self.assertEqual(report['artifact_collection'], 'PASS')
            self.assertEqual((root/'publication/container/guard/report.json').read_text(), '{"fixture":"safe"}')

    def test_external_symlinks_parent_links_fifo_and_unknown_files_never_publish(self):
        for kind in ('symlink', 'parent-link', 'fifo', 'unknown', 'oversized', 'deep-tree'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp) / 'output'; (root/'container').mkdir(parents=True)
                canary = Path(tmp)/'outside-canary'; canary.write_text('SYNTHETIC_HOST_CANARY')
                target = root/'container/probe.json'
                if kind == 'symlink': target.symlink_to(canary)
                elif kind == 'parent-link': (root/'container/e2e').symlink_to(Path(tmp), target_is_directory=True)
                elif kind == 'fifo': os.mkfifo(target)
                elif kind == 'unknown': (root/'container/arbitrary.txt').write_text('unapproved')
                elif kind == 'deep-tree':
                    deep = root/'container'
                    for _ in range(18): deep /= 'nested'
                    deep.mkdir(parents=True)
                else:
                    with target.open('wb') as stream: stream.truncate(16*1024*1024+1)
                with self.assertRaises(Blocked): evidence_files(root)
                report = {'result':'PASS'}
                collect_publication(root, report)
                self.assertEqual(report['result'], 'BLOCKED')
                for file in (root/'publication').rglob('*'):
                    self.assertFalse(file.is_symlink())
                    if file.is_file(): self.assertNotIn('SYNTHETIC_HOST_CANARY', file.read_text())
                self.assertEqual({file.name for file in (root/'publication').iterdir()}, {'summary.json','collection-error.json'})

    def test_cleanup_after_ambiguous_create_requires_proven_absence(self):
        success = subprocess.CompletedProcess([], 0, stdout=b'')
        failed = subprocess.CompletedProcess([], 1, stdout=b'')
        present = subprocess.CompletedProcess([], 0, stdout=b'container-id')
        for responses, expected in [([success], 'PASS'), ([failed, success], 'PASS'),
                                    ([failed, failed], 'FAIL'), ([failed, present], 'FAIL')]:
            with self.subTest(expected=expected), patch('pr_verification.subprocess.run', side_effect=responses) as run:
                self.assertEqual(cleanup_container('docker', 'fixture', {}), expected)
                self.assertEqual(run.call_args_list[0].args[0], ['docker', 'rm', '--force', 'fixture'])

    def test_child_timeout_output_limit_and_exit_are_recorded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cases = [("import time; time.sleep(60)", 0.05, 8192, 'timeout'),
                     ("print('x'*100000)", 3, 1024, 'output_limit')]
            for code, timeout, limit, reason in cases:
                row = {}
                with self.subTest(reason=reason), self.assertRaises(Blocked):
                    bounded_command([sys.executable, '-c', code], root, {}, root/'log', timeout, row, limit)
                self.assertTrue(row[reason])
            row = {}
            bounded_command([sys.executable, '-c', 'raise SystemExit(7)'], root, {}, root/'log', 3, row)
            self.assertEqual(row['exit_code'], 7)

    def test_declared_configuration_and_mutations(self):
        tests, evidence = Path('/tmp/prepared-tests'), Path('/tmp/output')
        info = inspection(tests, evidence)
        verify_inspection(info, POLICY, tests, evidence)
        for key, value in [("NetworkMode", "host"), ("ReadonlyRootfs", False), ("Privileged", True),
                           ("Memory", 0), ("MemorySwap", -1), ("NanoCpus", 0), ("PidsLimit", 0),
                           ("ShmSize", 0), ("IpcMode", "host"), ("CapAdd", ["SYS_ADMIN"]), ("CapAdd", []),
                           ("CapDrop", []), ("SecurityOpt", ["seccomp=unconfined"])]:
            with self.subTest(key=key):
                altered = copy.deepcopy(info); altered["HostConfig"][key] = value
                with self.assertRaises(Blocked):
                    verify_inspection(altered, POLICY, tests, evidence)
        for change in ("writeable-source", "socket", "root"):
            altered = copy.deepcopy(info)
            if change == "writeable-source": altered["Mounts"][0]["RW"] = True
            if change == "socket": altered["Mounts"].append({"Type": "bind", "Destination": "/var/run/docker.sock"})
            if change == "root": altered["Config"]["User"] = "root"
            with self.subTest(change=change), self.assertRaises(Blocked):
                verify_inspection(altered, POLICY, tests, evidence)

    def test_launcher_flags_do_not_forward_credentials_or_host_access(self):
        argv = docker_arguments('fixture', 'sha256:' + 'a' * 64, Path('/tmp/tests'), Path('/tmp/evidence'), Path('/tmp/seccomp'), POLICY)
        self.assertIn('none', argv)
        self.assertIn('--read-only', argv)
        self.assertNotIn('--privileged', argv)
        self.assertFalse(any(value.startswith(('AWS_', 'GITHUB_', '--env-file')) for value in argv))
        self.assertIn('type=bind,src=/tmp/tests,dst=/opt/qualityops/frontend/tests,readonly', argv)

    def test_missing_report_and_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'report'
            with self.assertRaises(Blocked): read_json(file)
            file.symlink_to('/etc/passwd')
            with self.assertRaises(Blocked): read_json(file)


class ScopeTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.git('init', '-q')
        self.path = self.root / 'frontend/tests/mixed-campaign.spec.ts'
        self.path.parent.mkdir(parents=True)
        self.path.write_text('reviewed assertion')
        self.base = self.commit()

    def git(self, *args):
        return subprocess.check_output(['git', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid',
                                        *args], cwd=self.root, stderr=subprocess.DEVNULL).decode().strip()

    def commit(self):
        self.git('add', '-A'); self.git('commit', '-qm', 'test fixture')
        return self.git('rev-parse', 'HEAD')

    def test_modified_ordinary_spec_allowed_but_untracked_not_overlaid(self):
        self.path.write_text('locator repair; same assertions')
        candidate = self.commit()
        (self.root / 'untracked.test.ts').write_text('excluded')
        self.assertEqual(check_scope(self.root, self.base, candidate)['changes'][0]['path'], str(self.path.relative_to(self.root)))
        self.assertEqual(check_scope(self.root, self.base, self.base)['changes'], [])

    def test_only_full_existing_commit_revisions(self):
        for value in ('HEAD', self.base[:8], 'a' * 40):
            with self.subTest(value=value), self.assertRaises((ValueError, subprocess.SubprocessError)):
                revision(self.root, value)

    def test_infrastructure_add_delete_rename_and_symlink_rejected(self):
        for change in ('infrastructure', 'new-spec', 'delete', 'rename', 'symlink'):
            self.git('reset', '--hard', self.base)
            if change == 'infrastructure':
                (self.root / 'frontend/playwright.config.ts').write_text('retries:2')
            elif change == 'new-spec':
                (self.path.parent / 'unapproved.spec.ts').write_text('test()')
            elif change == 'delete': self.path.unlink()
            elif change == 'rename': self.path.rename(self.path.with_name('renamed.spec.ts'))
            else:
                self.path.unlink(); self.path.symlink_to('/etc/passwd')
            candidate = self.commit()
            with self.subTest(change=change), self.assertRaises(ValueError):
                check_scope(self.root, self.base, candidate)

    def test_export_has_no_private_files_or_dot_config(self):
        for name in ('evaluators/ground_truth/answer', 'frontend/.env', 'frontend/src/main.tsx'):
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('fixture')
        commit = self.commit()
        export = self.root / 'export'; export.mkdir()
        export_files(self.root, commit, export)
        self.assertTrue((export / 'frontend/src/main.tsx').exists())
        self.assertFalse((export / 'frontend/.env').exists())
        self.assertFalse((export / 'evaluators').exists())

    def test_export_rejects_symlinks(self):
        self.path.unlink(); self.path.symlink_to('/etc/passwd')
        commit = self.commit()
        with self.assertRaises(Blocked): export_files(self.root, commit, self.root / 'export')


if __name__ == '__main__':
    unittest.main()
