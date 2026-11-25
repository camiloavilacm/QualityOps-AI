"""Trusted Docker launcher. Candidate input is three explicitly approved spec blobs."""
import argparse
import hashlib
import json
import os
import shutil
import signal
import stat
import re
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

from check_healer_scope import check_scope, git, revision

ROOT = Path(__file__).resolve().parents[1]


class Blocked(Exception):
    pass


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require_preparation_space(output):
    # Initial browser image preparation expands several GiB in the local daemon.
    # This conservative host check is a prerequisite, not a Docker storage quota.
    if shutil.disk_usage(output).free < 10 * 1024 * 1024 * 1024:
        raise Blocked('insufficient host free space: require at least 10 GiB before image preparation')


def reap_command_group(child):
    """Reap even when macOS denies signaling a group that has already exited."""
    denied = False
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except PermissionError:
        # A just-exited child may still have a process-group identifier that cannot
        # be signaled. Confirm exit before treating this as harmless. A live child
        # is terminated directly, but the unproven group cleanup still fails closed.
        if child.poll() is None:
            denied = True
            try:
                child.kill()
            except OSError:
                pass
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        raise Blocked('child cleanup could not be established') from None
    if denied:
        raise Blocked('process-group cleanup denied for a live child')


def bounded_command(argv, cwd, env, log, timeout, row, max_bytes=8 * 1024 * 1024, monitor=None):
    """Bound wall time and output while the process runs; kill its process group."""
    deadline = time.monotonic() + timeout
    with log.open("wb") as stream:
        try:
            child = subprocess.Popen(argv, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT,
                                     start_new_session=True)
        except OSError:
            raise Blocked("required command unavailable") from None
        try:
            while child.poll() is None:
                if monitor:
                    monitor()
                if time.monotonic() >= deadline:
                    row.update(timeout=True, exit_code=None)
                    raise Blocked("child command timeout")
                if log.stat().st_size > max_bytes:
                    row.update(output_limit=True, exit_code=None)
                    raise Blocked("command output exceeds evidence bound")
                time.sleep(0.02)
            row["exit_code"] = child.returncode
            if log.stat().st_size > max_bytes:
                row["output_limit"] = True
                raise Blocked("command output exceeds evidence bound")
        finally:
            reap_command_group(child)
    return log.read_bytes()


def read_json(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 8 * 1024 * 1024:
        raise Blocked("missing, unsafe, or oversized report")
    return json.loads(path.read_bytes())


def allowed_evidence(name):
    if name == 'summary.json' or re.fullmatch(r'command-[0-9]+[.]log', name):
        return True
    if not name.startswith('container/'):
        return False
    relative = name.removeprefix('container/')
    if relative in {'foundation.json', 'commands.json', 'versions.json', 'isolation.json',
                    'blocker.json', 'probe.json', 'probe.log', 'typecheck.log',
                    'e2e.log', 'guard.log', 'lifecycle.log', 'canary.log',
                    'hygiene-unit.log',
                    'hygiene-chromium.log', 'hygiene-chromium-guard-meta.log',
                    'hygiene-chromium-webmcp-lifecycle.log', 'red-team.log', 'ci-workflow.log',
                    'red-team-unit.log', 'ci-workflow-unit.log'}:
        return True
    if relative == 'red-team/publication/red-team-summary.json' or re.fullmatch(
            r'red-team/publication/cases/R(?:1a|1b|[2-9]|1[0-1]|13)[.]json', relative):
        return True
    if re.fullmatch(r'red-team/publication/cases/R7/(?:baseline|renamed_control)-(?:report|failure)[.]json|'
                    r'red-team/publication/cases/R7/(?:baseline|renamed_control)-trace[.]zip', relative):
        return True
    if re.fullmatch(r'(e2e|guard|lifecycle)/(report|discovery|orchestrator)[.]json', relative):
        return True
    parts = Path(relative).parts
    if len(parts) == 3 and parts[0] == 'hygiene' and parts[1] in {
            'chromium', 'chromium-guard-meta', 'chromium-webmcp-lifecycle'} and parts[2] in {
                f'{parts[1]}-hygiene.json', f'{parts[1]}-discovery.json', f'{parts[1]}-report.json'}:
        return True
    if relative in {'canary/summary.json', 'canary/mutation/mutated-export.json'} or re.fullmatch(
            r'canary/(positive|mutated)/(discovery|report)[.]json', relative):
        return True
    if len(parts) >= 4 and parts[0] == 'canary' and parts[1] in {'positive', 'mutated'} and parts[2] == 'test-results':
        return (parts[-1] in {'trace.zip', 'error-context.md', '.last-run.json'} or
                re.fullmatch(r'[A-Za-z0-9_.-]+[.](png|webm)', parts[-1]) is not None)
    if len(parts) >= 4 and parts[0] == 'hygiene' and parts[1] in {
            'chromium', 'chromium-guard-meta', 'chromium-webmcp-lifecycle'} and parts[2] == 'test-results':
        return (parts[-1] in {'trace.zip', 'error-context.md', '.last-run.json'} or
                re.fullmatch(r'[A-Za-z0-9_.-]+[.](png|webm)', parts[-1]) is not None)
    return (len(parts) >= 3 and parts[0] in {'e2e', 'guard', 'lifecycle'} and parts[1] == 'test-results'
            and (parts[-1] in {'trace.zip', 'error-context.md', '.last-run.json'} or
                 re.fullmatch(r'[A-Za-z0-9_.-]+[.](png|webm)', parts[-1]) is not None))


def validate_red_team_scenario_ids(rows, expected_ids):
    ids = [row.get('id') for row in rows]
    if (any(not isinstance(value, str) for value in ids) or len(rows) != len(expected_ids) or
            len(set(ids)) != len(rows) or set(ids) != expected_ids):
        raise Blocked('red-team scenario IDs are missing, duplicated, or unexpected')


def evidence_files(root, *, enforce_names=True, tolerate_vanished=False, name_prefix=''):
    """Inspect all entries without following links; never permit uploader traversal."""
    files, total, count = [], 0, 0
    def scan(descriptor, directory, depth=0):
        nonlocal total, count
        if depth > 16:
            raise Blocked('artifact directory depth bound exceeded')
        with os.scandir(descriptor) as entries:
            for entry in entries:
                count += 1
                if count > 4096:
                    raise Blocked('artifact entry count bound exceeded')
                try:
                    info = entry.stat(follow_symlinks=False)
                except FileNotFoundError:
                    if tolerate_vanished:
                        continue
                    raise
                path = directory / entry.name
                if stat.S_ISDIR(info.st_mode):
                    try:
                        nested = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
                    except FileNotFoundError:
                        if tolerate_vanished:
                            continue
                        raise
                    try:
                        scan(nested, path, depth+1)
                    finally:
                        os.close(nested)
                elif stat.S_ISREG(info.st_mode):
                    name = name_prefix + path.relative_to(root).as_posix()
                    if enforce_names and not allowed_evidence(name):
                        raise Blocked('unknown artifact path; collection rejected')
                    total += info.st_size
                    if info.st_size > 16 * 1024 * 1024 or total > 128 * 1024 * 1024 or len(files) >= 1024:
                        raise Blocked('artifact size or count bound exceeded')
                    files.append((path, name))
                else:
                    raise Blocked('symlink or special artifact; collection rejected')
    descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        scan(descriptor, root)
    finally:
        os.close(descriptor)
    return files


def collect_publication(output, report):
    """Called only after container cleanup; raw bind output is NEVER uploaded."""
    with tempfile.TemporaryDirectory(prefix='qualityops-publication-', dir=output.parent) as tmp:
        staged = Path(tmp) / 'publication'
        staged.mkdir()
        try:
            files = evidence_files(output)
            for source, name in files:
                target = staged / name
                target.parent.mkdir(parents=True, exist_ok=True)
                # NOFOLLOW also closes the final-component race if a local actor changes an entry.
                descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(descriptor, 'rb') as stream:
                    if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                        raise Blocked('artifact changed during collection')
                    data = stream.read(16 * 1024 * 1024 + 1)
                    if len(data) > 16 * 1024 * 1024:
                        raise Blocked('artifact changed during collection')
                target.write_bytes(data)
            result = 'PASS'
        except (Blocked, OSError) as exc:
            shutil.rmtree(staged)
            staged.mkdir()
            report['result'] = 'BLOCKED'
            report['collection_error'] = str(exc) if isinstance(exc, Blocked) else 'artifact collection failed'
            (staged / 'collection-error.json').write_text(json.dumps({'result': 'BLOCKED', 'reason': report['collection_error']}) + '\n')
            result = 'FAIL'
        report['artifact_collection'] = result
        # This summary is created by the host, including on rejected collection.
        (staged / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
        os.replace(staged, output / 'publication')


def export_files(root, commit, target):
    """No archive extraction, Git checkout hooks, symlinks, or private directories."""
    files = git(root, "ls-tree", "-rz", commit, "--", "frontend", "harness/container",
                "harness/pr-verification-policy.json", "harness/verify_red_team_matrix.mjs",
                "harness/red_team_cases.mjs", "harness/check_ci_workflow.mjs", "harness/check_healer_scope.py",
                "harness/test_red_team_matrix.mjs", "harness/test_ci_workflow.mjs",
                "harness/prepare_r7_variant.mjs", "harness/test_r7_variant.mjs",
                ".github/workflows/ci.yml", ".github/dependabot.yml").split(b"\0")
    for row in filter(None, files):
        header, raw_name = row.split(b"\t", 1)
        mode, kind, blob = header.split()
        name = raw_name.decode("utf8")
        if mode not in (b"100644", b"100755") or kind != b"blob" or ".." in Path(name).parts:
            raise Blocked("source export requires ordinary files")
        # .npmrc, .env and other hidden configuration are never build inputs.
        if any(part.startswith(".") for part in Path(name).parts) and name not in {
                ".github/workflows/ci.yml", ".github/dependabot.yml"}:
            continue
        if any(part in {"node_modules", "dist", "artifacts", "test-results", "playwright-report"}
               for part in Path(name).parts):
            raise Blocked("generated or dependency directory in trusted source")
        payload = git(root, "cat-file", "blob", blob.decode())
        if len(payload) > 8 * 1024 * 1024:
            raise Blocked("source file exceeds preparation bound")
        output = target / name
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(payload)


def docker_arguments(name, image, tests, evidence, seccomp, policy, verifier_revision, candidate_revision, stage):
    # No candidate/environment-controlled flags, mounts, host networking or secrets.
    return ["create", "--name", name, "--platform", policy["platform"],
            "--user", "pwuser", "--network", "none", "--read-only", "--cap-drop", "ALL",
            "--cap-add", policy["capabilities"][0],
            "--security-opt", "no-new-privileges", "--security-opt", "seccomp=" + str(seccomp),
            "--env", "PW_VERIFIER_REVISION=" + verifier_revision,
            "--env", "PW_CANDIDATE_REVISION=" + candidate_revision,
            "--env", "PW_STAGE=" + str(stage),
            "--cpus", "2", "--memory", "4294967296", "--memory-swap", "4294967296",
            "--pids-limit", "512", "--ipc", "private", "--shm-size", "1073741824",
            "--tmpfs", "/tmp:rw,nosuid,nodev,size=1073741824,mode=1777",
            "--mount", f"type=bind,src={tests},dst=/opt/qualityops/frontend/tests,readonly",
            "--mount", f"type=bind,src={evidence},dst=/evidence",
            image]


def verify_inspection(info, policy, tests, evidence, stage):
    host, config = info["HostConfig"], info["Config"]
    expected = {"NetworkMode": "none", "ReadonlyRootfs": True, "Privileged": False,
                "Memory": policy["memory_bytes"], "MemorySwap": policy["memory_bytes"],
                "NanoCpus": 2000000000, "PidsLimit": 512, "ShmSize": 1073741824, "IpcMode": "private"}
    if any(host.get(key) != value for key, value in expected.items()):
        raise Blocked("Docker did not establish required isolation/resource configuration")
    if (config.get("User") != "pwuser" or host.get("CapAdd") != ["CAP_SYS_CHROOT"]
            or host.get("CapDrop") != ["ALL"]):
        raise Blocked("unexpected user or capabilities")
    configured = dict(item.split("=", 1) for item in config.get("Env", []) if "=" in item)
    if configured.get("PW_STAGE") != str(stage):
        raise Blocked("container stage does not match requested cumulative gate")
    security = host.get("SecurityOpt", [])
    if not any(value in {"no-new-privileges", "no-new-privileges=true"} for value in security) or not any(
            value.startswith("seccomp=") and value != "seccomp=unconfined" for value in security):
        raise Blocked("missing security options")
    mounts = {item["Destination"]: item for item in info["Mounts"] if item["Type"] == "bind"}
    if set(mounts) != {"/opt/qualityops/frontend/tests", "/evidence"}:
        raise Blocked("unexpected host bind mounts")
    for dest, source, writable in [("/opt/qualityops/frontend/tests", tests, False), ("/evidence", evidence, True)]:
        if Path(mounts[dest]["Source"]).resolve() != source.resolve() or mounts[dest]["RW"] != writable:
            raise Blocked("mount source or permissions differ")


def cleanup_container(docker, name, env):
    """An ambiguous create failure still needs cleanup; prove absence afterward."""
    try:
        removed = subprocess.run([docker, "rm", "--force", name], env=env, capture_output=True, timeout=30)
        if removed.returncode == 0:
            return "PASS"
        listed = subprocess.run([docker, "ps", "--all", "--filter", "name=^/" + name + "$", "--format", "{{.ID}}"],
                                env=env, capture_output=True, timeout=30)
        return "PASS" if listed.returncode == 0 and not listed.stdout.strip() else "FAIL"
    except (OSError, subprocess.SubprocessError):
        return "FAIL"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", required=True, type=int, choices=range(1, 5))
    parser.add_argument("--verifier-revision", required=True)
    parser.add_argument("--candidate-revision", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--bootstrap", action="store_true",
                        help="infrastructure evidence only; identical verifier/candidate required; never promotes trust")
    args = parser.parse_args()
    requested_output = args.output.absolute()
    if requested_output.is_symlink():
        parser.error("output cannot be a symlink")
    # Resolve maintainer-selected parent aliases (macOS /tmp and /var are symlinks).
    # Candidate data never chooses this path; the final directory must not exist.
    output = requested_output.resolve()
    if output.exists():
        parser.error("output must be a new path")
    output.mkdir(parents=True)
    reserve = output / '.report-reserve'
    started = time.monotonic()
    records = []
    report = {"result": "BLOCKED", "stage": args.stage,
              "verifier_revision": args.verifier_revision, "candidate_revision": args.candidate_revision,
              "commands": records, "remote": {"R12": "NOT RUN", "R14": "NOT RUN"},
              "trust": "No candidate result authorizes verifier acceptance or merge."}
    name = "qualityops-verify-" + uuid.uuid4().hex
    docker = shutil.which("docker")
    created = False
    scratch_manager = None
    env = {"PATH": os.environ.get("PATH", os.defpath), "LANG": "C.UTF-8",
           "PW_VERIFIER_REVISION": args.verifier_revision, "PW_CANDIDATE_REVISION": args.candidate_revision}
    if os.environ.get("QUALITYOPS_QA_FEATURES_ROOT"):
        env["QUALITYOPS_QA_FEATURES_ROOT"] = os.environ["QUALITYOPS_QA_FEATURES_ROOT"]

    def run(argv, *, timeout=300, cwd=ROOT, monitor=None):
        remaining = 1800 - (time.monotonic() - started)
        if remaining <= 0:
            raise Blocked("overall gate timeout")
        log = output / f"command-{len(records):02d}.log"
        row = {"command": argv, "cwd": str(cwd), "log": log.name, "result": "FAIL"}
        records.append(row)
        content = bounded_command(argv, cwd, env, log, min(timeout, remaining), row, monitor=monitor)
        row["result"] = "PASS" if row["exit_code"] == 0 else "FAIL"
        if row["exit_code"]:
            raise Blocked("command failed; see bounded command log")
        return content

    try:
        # Release in finally so resource exhaustion still leaves room for bounded reports.
        reserve.write_bytes(b'\0' * (256 * 1024))
        revision(ROOT, args.verifier_revision)
        revision(ROOT, args.candidate_revision)
        policy_path = ROOT / "harness/container/runtime-policy.json"
        policy_raw = policy_path.read_bytes()
        policy = json.loads(policy_raw)
        report["runtime_policy_sha256"] = sha(policy_raw)
        report["base_image_digest"] = policy["base_image"]
        if args.stage not in policy["implemented_stages"]:
            raise Blocked("requested cumulative stage is not implemented; no empty gate success")
        # Verify all executable host code and policies against the chosen immutable verifier.
        for file in ["harness/pr_verification.py", "harness/run_pr_verification.mjs",
                     "harness/check_healer_scope.py", "harness/check_pr_reports.mjs",
                     "harness/check_hygiene_report.mjs", "harness/check_canary_report.mjs",
                     "harness/test_pr_verification.py", "harness/test_pr_reports.mjs",
                     "harness/test_stage2_report_validation.mjs",
                     "harness/check_ci_workflow.mjs", "harness/test_ci_workflow.mjs",
                     "harness/verify_red_team_matrix.mjs", "harness/red_team_cases.mjs",
                     "harness/test_red_team_matrix.mjs", "harness/prepare_r7_variant.mjs",
                     "harness/test_r7_variant.mjs",
                     "harness/pr-verification-policy.json", "harness/container/runtime-policy.json"]:
            try:
                recorded = git(ROOT, "show", args.verifier_revision + ":" + file)
            except subprocess.SubprocessError:
                raise Blocked("verifier revision does not contain implementation: " + file) from None
            if recorded != (ROOT / file).read_bytes():
                raise Blocked("launcher or policy differs from requested verifier revision")
        scope = check_scope(ROOT, args.verifier_revision, args.candidate_revision)
        report["scope"] = scope
        if args.stage >= 2:
            run(["python3", "-B", "-m", "unittest", "harness.test_pr_verification", "-q"])
            run(["node", "--test", str(ROOT / "harness/test_pr_reports.mjs")])
            run(["node", "--test", str(ROOT / "harness/test_stage2_report_validation.mjs")])
        if args.stage >= 3:
            stage3_commands = [
                ["python3", "-B", "harness/checks.py", "contracts"],
                ["python3", "-B", "-m", "unittest", "-v", "backend.ingestion.test_importer", "backend.gate.test_gate"],
                ["python3", "-B", "-m", "unittest", "-v", "backend.investigator.test_investigator", "backend.investigator.test_retrieval"],
                ["python3", "-B", "-m", "unittest", "discover", "-s", "evaluators", "-p", "test_evaluate.py", "-v"],
                ["python3", "-B", "-m", "unittest", "-v", "tests/test_vertical_slice.py"],
                ["python3", "-B", "frontend/scripts/export_mixed.py", "--check"],
                ["python3", "-B", "frontend/scripts/export_showcase.py", "--check"],
                ["ruby", "-e", "require 'yaml'; YAML.parse_file('.github/workflows/ci.yml'); YAML.parse_file('.github/dependabot.yml')"],
            ]
            for command in stage3_commands:
                run(command)
        # External maintainer record is never loaded from candidate inputs or mounted into Docker.
        if args.bootstrap:
            if args.candidate_revision != args.verifier_revision:
                raise Blocked("bootstrap cannot execute candidate overlays")
            report["trust"] = "BOOTSTRAP ONLY; independent review and human SHA acceptance still required"
        else:
            acceptance_path = os.environ.get("QUALITYOPS_VERIFIER_ACCEPTANCE")
            if not acceptance_path:
                raise Blocked("independent review and human verifier acceptance record required")
            acceptance = read_json(Path(acceptance_path))
            if acceptance.get("verifier_revision") != args.verifier_revision or acceptance.get("runtime_policy_sha256") != sha(policy_raw) or \
                    not acceptance.get("human_acceptance") or not acceptance.get("independent_review"):
                raise Blocked("acceptance must bind exact verifier SHA, runtime policy and review")
            if acceptance.get("candidate_revision") != args.candidate_revision or acceptance.get("approved_changes") != scope["changes"]:
                raise Blocked("per-change human approval does not match candidate blobs")
            report["acceptance_record_sha256"] = sha(Path(acceptance_path).read_bytes())
        if not docker:
            raise Blocked("Docker unavailable; unrestricted fallback forbidden")
        require_preparation_space(output)
        scratch_manager = tempfile.TemporaryDirectory(prefix="qualityops-container-")
        # Cleanup below removes the container before deleting any mounted sources.
        if scratch_manager:
            tmp = scratch_manager.name
            scratch = Path(tmp)
            # Resolve only the local daemon endpoint. Do not carry host registry credentials/config into preparation.
            endpoint = subprocess.check_output([docker, "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
                                               timeout=30, stderr=subprocess.DEVNULL).decode().strip()
            if not endpoint.startswith("unix://"):
                raise Blocked("only a local Unix Docker daemon is permitted")
            env.update(HOME=str(scratch), DOCKER_CONFIG=str(scratch / "docker-config"), DOCKER_HOST=endpoint)
            run([docker, "version", "--format", "{{.Server.Version}}"])
            context = scratch / "context"
            context.mkdir()
            export_files(ROOT, args.verifier_revision, context)
            report["source_sha256"] = {str(file.relative_to(context)): sha(file.read_bytes())
                                       for file in sorted(context.rglob('*')) if file.is_file()}
            seccomp = context / "harness/container/seccomp_profile.json"
            if sha(seccomp.read_bytes()) != policy["seccomp_sha256"]:
                raise Blocked("seccomp profile digest mismatch")
            lock = context / "frontend/package-lock.json"
            report["lockfile_sha256"] = sha(lock.read_bytes())
            # Builds use verifier sources only. Positive/mutated bundle preparation at Gate 2 must be separate builds.
            iid = scratch / "image-id"
            run([docker, "build", "--force-rm", "--platform", policy["platform"],
                 "--build-arg", f"QUALITYOPS_STAGE={args.stage}",
                 "--build-arg", f"PW_VERIFIER_REVISION={args.verifier_revision}", "--iidfile", str(iid),
                 "-f", str(context / "harness/container/Dockerfile"), str(context)])
            image = iid.read_text().strip()
            if not image.startswith("sha256:") or len(image) != 71:
                raise Blocked("missing built-image digest")
            report["built_image_digest"] = image
            tests = context / "frontend/tests"
            for item in scope["changes"]:
                (context / item["path"]).write_bytes(git(ROOT, "show", args.candidate_revision + ":" + item["path"]))
            report["executed_spec_sha256"] = {str(file.relative_to(context)): sha(file.read_bytes())
                                               for file in sorted(tests.rglob('*.spec.ts'))}
            evidence = output / "container"
            evidence.mkdir(mode=0o777)
            evidence.chmod(0o777)  # pwuser writes only this disposable evidence directory.
            # Mark before create: even a timed-out Docker client may have created a container.
            created = True
            run([docker, *docker_arguments(name, image, tests, evidence, seccomp, policy,
                                           args.verifier_revision, args.candidate_revision, args.stage)])
            inspection = json.loads(run([docker, "inspect", name]))[0]
            verify_inspection(inspection, policy, tests, evidence, args.stage)
            execution_error = None
            try:
                run([docker, "start", "--attach", name], timeout=1800,
                    monitor=lambda: evidence_files(evidence, enforce_names=False, tolerate_vanished=True))
            except Blocked as exc:
                execution_error = exc
            finally:
                state = json.loads(run([docker, "inspect", "--format", "{{json .State}}", name]))
                report["container_state"] = state
                if state.get('Running'):
                    raise Blocked('container still running; do not read candidate artifacts')
                if state.get("OOMKilled"):
                    raise Blocked("container memory limit exceeded")
            # Container is stopped. Reject every link/special/unknown artifact before host reads.
            evidence_files(evidence, name_prefix='container/')
            foundation = read_json(evidence / "foundation.json")
            if execution_error:
                report["result"] = "FAIL" if foundation.get("result") == "FAIL" else "BLOCKED"
                raise execution_error
            if foundation.get("result") != "PASS" or read_json(evidence / "isolation.json").get("result") != "PASS":
                raise Blocked("missing successful isolation/foundation reports")
            for project, file in [("chromium", "e2e/report.json"), ("chromium-guard-meta", "guard/report.json"),
                                  ("chromium-webmcp-lifecycle", "lifecycle/report.json")]:
                run(["node", str(ROOT / "harness/check_pr_reports.mjs"), "--project", project,
                     "--report", str(evidence / file)])
            run(["node", str(ROOT / "harness/check_pr_reports.mjs"), "--project", "chromium",
                 "--report", str(evidence / "e2e/discovery.json"), "--discovery"])
            if args.stage >= 2:
                for project in ["chromium", "chromium-guard-meta", "chromium-webmcp-lifecycle"]:
                    run(["node", str(ROOT / "harness/check_hygiene_report.mjs"), "--root", str(evidence),
                         "--project", project, "--verifier-revision", args.verifier_revision,
                         "--candidate-revision", args.candidate_revision])
                run(["node", str(ROOT / "harness/check_canary_report.mjs"), "--root", str(evidence),
                     "--summary", str(evidence / "canary/summary.json"),
                     "--verifier-revision", args.verifier_revision,
                     "--candidate-revision", args.candidate_revision])
            if args.stage >= 3:
                matrix = read_json(evidence / "red-team/publication/red-team-summary.json")
                if not isinstance(matrix, dict):
                    raise Blocked("red-team summary must be an object")
                local = matrix.get("local_scenarios", [])
                if not isinstance(local, list) or any(not isinstance(row, dict) for row in local):
                    raise Blocked("red-team local scenario rows are malformed")
                expected_ids = {"R1a", "R1b", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11", "R13"}
                validate_red_team_scenario_ids(local, expected_ids)
                r7 = next((row for row in local if row.get("id") == "R7"), {}) if isinstance(local, list) else {}
                browser = r7.get("browser_control") if isinstance(r7, dict) else None
                hashes = browser.get("artifact_sha256") if isinstance(browser, dict) else None
                report_names = browser.get("playwright_reports") if isinstance(browser, dict) else None
                original = browser.get("original") if isinstance(browser, dict) else None
                renamed = browser.get("renamed_control") if isinstance(browser, dict) else None
                valid_hashes = isinstance(hashes, dict) and set(hashes) == {"baseline", "renamed_control", "candidate_spec"} and \
                    all(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) for value in hashes.values()) and \
                    hashes.get("baseline") != hashes.get("renamed_control")
                valid_report_hashes = all(isinstance(outcome, dict) and
                    isinstance(outcome.get("report_sha256"), str) and
                    re.fullmatch(r"[0-9a-f]{64}", outcome["report_sha256"])
                    for outcome in (original, renamed))
                if (matrix.get("result") != "PASS" or matrix.get("verifier_revision") != args.verifier_revision or
                        matrix.get("candidate_revision") != args.candidate_revision or
                        any(row.get("status") != "PASS" or row.get("workspace_cleanup") != "PASS" for row in local) or
                        r7.get("cumulative_control") !=
                            {"result": "PASS", "canary": "KILLED", "evidence": "canary/summary.json"} or
                        not isinstance(browser, dict) or browser.get("result") != "PASS" or browser.get("locator") != "fixture-mixed" or
                        not isinstance(original, dict) or
                        {key: original.get(key) for key in ("variant", "status", "tests")} !=
                            {"variant": "baseline", "status": "PASS", "tests": 1} or
                        not isinstance(renamed, dict) or
                        {key: renamed.get(key) for key in ("variant", "status", "tests")} !=
                            {"variant": "renamed_control", "status": "PASS", "tests": 1} or
                        report_names != ["R7/baseline-report.json", "R7/renamed_control-report.json"] or
                        browser.get("assertion_minimum") != 7 or browser.get("behavior") !=
                            ["BLOCKED", "REQUIRED_FAILURE", "INSUFFICIENT_EVIDENCE"] or
                        not valid_hashes or not valid_report_hashes or
                        matrix.get("remote_scenarios") != [
                            {"id": "R12", "status": "NOT RUN", "reason": "separate authorization and disposable remote target required"},
                            {"id": "R14", "status": "NOT RUN", "reason": "separate authorization and disposable remote target required"}]):
                    raise Blocked("local red-team matrix is incomplete or remote status is inaccurate")
                for variant, outcome_name, report_name in (("baseline", "original", "baseline-report.json"),
                                                           ("renamed_control", "renamed_control", "renamed_control-report.json")):
                    report_path = evidence / "red-team/publication/cases/R7" / report_name
                    report = read_json(report_path)
                    outcome = browser.get(outcome_name)
                    if (report != {"schema_version": "r7-playwright-report-1", "variant": variant,
                                   "report_sha256": outcome["report_sha256"],
                                   "test": {"title": "mixed campaign displays BLOCKED with confirmed failure for x and missing evidence for y",
                                            "file": "mixed-campaign.spec.ts", "project": "chromium", "expected_status": "passed",
                                            "status": "expected", "retries": 0}, "result": "PASS"}):
                        raise Blocked("R7 sanitized Playwright report is incomplete or inconsistent")
                for row in local:
                    case = read_json(evidence / "red-team/publication/cases" / (row["id"] + ".json"))
                    if case != row:
                        raise Blocked("red-team case artifact does not match its summary row")
            report["result"] = "PASS"
    except (Blocked, ValueError, KeyError, OSError, subprocess.SubprocessError) as exc:
        report["reason"] = str(exc) if not isinstance(exc, subprocess.SubprocessError) else "unresolvable revision or local daemon"
    finally:
        if created:
            report["cleanup"] = cleanup_container(docker, name, env)
            if report["cleanup"] != "PASS":
                report["result"] = "BLOCKED"
        else:
            report["cleanup"] = "NOT RUN; no container created"
        if scratch_manager:
            scratch_manager.cleanup()
        reserve.unlink(missing_ok=True)
        report["duration_seconds"] = round(time.monotonic() - started, 3)
        (output / "summary.json").write_text(json.dumps(report, indent=2) + "\n")
        if report['cleanup'] == 'FAIL':
            # A live process may race artifact collection. Publish host summary only.
            publication = output / 'publication'
            publication.mkdir()
            report['artifact_collection'] = 'NOT RUN; cleanup failed'
            (publication / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
        else:
            collect_publication(output, report)
        (output / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({"result": report["result"], "report": str(output / "summary.json"), "reason": report.get("reason")}))
    return report["result"] != "PASS"


if __name__ == "__main__":
    raise SystemExit(main())
