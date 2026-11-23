"""Offline adapter for qa-features campaign manifests, format 1.0."""
import errno
import hashlib
import json
import os
import re
import stat
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import NamedTuple

from jsonschema import Draft202012Validator, FormatChecker

VERSION = "2.0.0-draft.1"
SCHEMA = Path(__file__).resolve().parents[2] / "contracts/v2/evidence.schema.json"
MANIFEST_LIMIT = 1024 * 1024
ARTIFACT_LIMIT = 8 * 1024 * 1024
BUNDLE_LIMIT = 64 * 1024 * 1024
MAX_ARTIFACTS = 512
IDENTIFIER = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}")
COMPONENT = re.compile(r"[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*")
STATES = {"complete", "partial", "unavailable", "error"}
CAMPAIGN_STATUSES = {"passed", "failed", "error", "incomplete"}
RESULT_STATUSES = {"passed", "failed", "error", "not_run"}
DIAGNOSTIC_KINDS = {"checks.json": "log", "network.json": "network"}
REVISION = re.compile(r"[a-f0-9]{40}(?:[a-f0-9]{24})?")
DIRECTORY = os.O_DIRECTORY | os.O_NOFOLLOW


class ImportError(ValueError):
    """Input or local publication could not be verified."""


class ImportResult(NamedTuple):
    evidence_path: Path
    created: bool


def require(condition, message):
    if not condition:
        raise ImportError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(data):
    return (json.dumps(data, indent=2, sort_keys=True, ensure_ascii=True) + "\n").encode()


def decode(data):
    def unique_object(pairs):
        result = dict(pairs)
        require(len(pairs) == len(result), "duplicate JSON field")
        return result

    def reject_constant(_):
        raise ImportError("invalid JSON number")

    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=unique_object,
                          parse_constant=reject_constant)
    except (ValueError, RecursionError) as exc:
        if isinstance(exc, ImportError):
            raise
        raise ImportError("invalid JSON") from exc


@contextmanager
def directory(path, parent=None):
    fd = os.open(path, os.O_RDONLY | DIRECTORY, dir_fd=parent)
    try:
        yield fd
    finally:
        os.close(fd)


def read_at(root, path, limit):
    """Resolve each component below a pinned directory without following symlinks."""
    parts = path.split("/")
    require(len(parts) <= 8 and all(COMPONENT.fullmatch(part) for part in parts),
            "unsafe file reference")

    def read(parent, remaining):
        name, *tail = remaining
        if tail:
            with directory(name, parent) as child:
                return read(child, tail)
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode), "expected a regular file")
            require(info.st_size <= limit, "file exceeds byte limit")
            data = stream.read(limit + 1)
            require(len(data) <= limit, "file exceeds byte limit")
            return data

    try:
        return read(root, parts)
    except OSError as exc:
        raise ImportError("cannot safely read referenced file") from exc


def load_config(path):
    path = Path(path)
    with directory(path.parent) as root:
        return decode(read_at(root, path.name, MANIFEST_LIMIT))


def keyed(rows, key, limit):
    require(isinstance(rows, list) and len(rows) <= limit, "invalid or oversized list")
    indexed = {}
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get(key), str), "invalid record identity")
        identity = row[key]
        require(identity not in indexed, "duplicate record identity")
        indexed[identity] = row
    return indexed


def expected_matrix(config):
    matrix = {}
    slots = config["slots"]
    scenarios = config["scenarios"]
    names = config["complete_artifact_names"]
    require(isinstance(names, list) and 0 < len(names) <= 16
            and all(isinstance(name, str) and COMPONENT.fullmatch(name) for name in names)
            and len(set(names)) == len(names), "invalid required artifact names")
    require(isinstance(slots, dict) and 0 < len(slots) <= 32
            and isinstance(scenarios, dict) and 0 < len(scenarios) <= 32,
            "invalid trusted matrix dimensions")
    require(len(set(slots.values())) == len(slots), "duplicate canonical slot")
    for upstream_slot, slot in sorted(slots.items()):
        require(isinstance(slot, str) and COMPONENT.fullmatch(slot), "invalid matrix slot")
        for test_id, requirements in sorted(scenarios.items()):
            require(COMPONENT.fullmatch(test_id) and isinstance(requirements, list),
                    "invalid matrix scenario")
            matrix[upstream_slot, test_id] = {
                "execution_id": f"{slot}.{test_id}", "test_id": test_id,
                "slot": slot, "requirement_ids": requirements,
            }
    return matrix


def validate_receipt(config):
    require(set(config) == {
        "campaign_id", "issue_id", "feature_ref", "run_revision", "run_id", "run_attempt",
        "workflow_conclusion", "collected_at", "capture", "capture_revision", "repository",
        "source_location", "manifest_sha256", "slots", "scenarios", "complete_artifact_names",
    }, "invalid trusted receipt fields")
    require(config["repository"] == "camiloavilacm/qa-features"
            and re.fullmatch(r"[1-9][0-9]{0,19}", config["run_id"])
            and type(config["run_attempt"]) is int and config["run_attempt"] > 0
            and isinstance(config["workflow_conclusion"], str)
            and IDENTIFIER.fullmatch(config["workflow_conclusion"])
            and all(COMPONENT.fullmatch(part) for part in config["source_location"].split("/")),
            "invalid trusted run metadata")
    require(re.fullmatch(r"[0-9a-f]{40}", config["feature_ref"])
            and re.fullmatch(r"[0-9a-f]{40}", config["run_revision"]), "invalid source revision")
    capture_revision = config["capture_revision"]
    require((config["capture"] == "tracked" and isinstance(capture_revision, str)
             and re.fullmatch(r"[0-9a-f]{40}", capture_revision))
            or (config["capture"] == "local-archive" and capture_revision is None),
            "invalid capture provenance")


def completeness(states):
    if states == {"complete"}:
        return "complete"
    if states == {"unavailable"}:
        return "unavailable"
    if states <= {"unavailable", "error"}:
        return "error"
    return "partial"


def source_status(record, allowed, message, field="status"):
    value = record.get(field)
    require(isinstance(value, str) and value in allowed, message)
    return value


def observer_state(observer):
    require(isinstance(observer, dict) and observer.keys() == {"state", "events", "detail"},
            "invalid observer payload")
    state = source_status(observer, STATES, "invalid observer state", field="state")
    events = observer["events"]
    require(isinstance(events, list)
            and (observer["detail"] is None or isinstance(observer["detail"], str)),
            "invalid observer payload")
    for event in events:
        require(isinstance(event, dict)
                and event.keys() == {"method", "path", "status", "authorization_present"}
                and event["method"] in ("GET", "POST")
                and event["path"] in ("/users", "/users/login", "/user")
                and type(event["status"]) is int and 100 <= event["status"] <= 599
                and type(event["authorization_present"]) is bool, "invalid observer event")
    return state


def verify_checks(checks, result, test_id, outcome):
    require(isinstance(checks, dict), "invalid checks report")
    require(all(checks.get(field) == result[field]
                for field in ("slot_id", "execution_id", "sut_revision", "runner_revision"))
            and checks.get("scenario") == test_id and checks.get("outcome") == outcome,
            "checks report contradicts scenario outcome or execution identity")
    require(isinstance(checks.get("checks"), list)
            and all(isinstance(check, str) for check in checks["checks"])
            and "identity_id" in checks
            and (checks["identity_id"] is None or isinstance(checks["identity_id"], str)),
            "invalid checks report")


def build_bundle(root, config):
    validate_receipt(config)
    raw = read_at(root, "campaign.json", MANIFEST_LIMIT)
    require(digest(raw) == config["manifest_sha256"], "source manifest digest mismatch")
    campaign = decode(raw)
    require(campaign["schema_version"] == "1.0", "unsupported source campaign version")
    source_status(campaign, CAMPAIGN_STATUSES, "invalid campaign status")
    require(all(campaign[field] == config[field] for field in ("campaign_id", "issue_id", "feature_ref")),
            "source campaign identity differs from trusted receipt")
    require(isinstance(campaign["campaign_id"], str) and IDENTIFIER.fullmatch(campaign["campaign_id"]),
            "invalid campaign ID")
    matrix = expected_matrix(config)
    slots = keyed(campaign["slots"], "slot_id", 32)
    require(slots.keys() <= config["slots"].keys(), "unexpected source slot")

    files = {}
    artifacts = []
    source_paths = set()
    remaining = BUNDLE_LIMIT

    def add_artifact(source_path, kind, data, expected_digest):
        nonlocal remaining
        require(len(artifacts) < MAX_ARTIFACTS and len(data) <= remaining, "bundle exceeds artifact limits")
        require(source_path not in source_paths, "duplicate artifact path")
        source_paths.add(source_path)
        actual_digest = digest(data)
        require(actual_digest == expected_digest, "artifact digest mismatch")
        artifact_id = "a-" + digest(source_path.encode())
        path = "artifacts/" + artifact_id + ".json"
        files[path] = data
        remaining -= len(data)
        artifacts.append(dict(id=artifact_id, path=path, sha256=actual_digest, kind=kind,
                              source_path=source_path))
        return artifact_id

    report = add_artifact("campaign.json", "execution-report", raw, config["manifest_sha256"])
    receipt = encode(config)
    add_artifact("adapter/receipt.json", "diagnostic", receipt, digest(receipt))
    observed = []
    execution_ids = set()
    states = {}
    for upstream_slot, slot in sorted(slots.items()):
        slot_state = slot["state"]
        require(slot_state in STATES | {"missing"}, "invalid slot observation state")
        result = slot.get("result")
        if result is None:
            require(slot_state != "complete", "complete slot has no result")
            for key in matrix:
                if key[0] == upstream_slot:
                    states[key] = "error" if slot_state == "error" else "unavailable"
            continue
        require(slot_state in {"complete", "partial", "error"}, "slot state contradicts result")
        result_status = source_status(result, RESULT_STATUSES, "invalid slot result status")
        require(all(result[field] == campaign[field]
                    for field in ("schema_version", "campaign_id", "issue_id", "feature_ref"))
                and result["slot_id"] == upstream_slot and result["tooling_ref"] == config["run_revision"],
                "execution provenance contradicts campaign")
        require(all(isinstance(result.get(field), str) and REVISION.fullmatch(result[field])
                    for field in ("sut_revision", "runner_revision")), "invalid execution revisions")
        upstream_id = result["execution_id"]
        require(isinstance(upstream_id, str) and IDENTIFIER.fullmatch(upstream_id)
                and upstream_id not in execution_ids, "invalid or duplicate source execution ID")
        execution_ids.add(upstream_id)
        scenarios = keyed(result["scenarios"], "id", 32)
        require(scenarios.keys() <= config["scenarios"].keys(), "unexpected source scenario")
        for test_id, scenario in sorted(scenarios.items()):
            row = matrix[upstream_slot, test_id]
            outcome = source_status(scenario, RESULT_STATUSES, "invalid scenario status")
            # qa-features results.schema.json requires string-or-null error,
            # narrowed to null for passing scenarios.
            require("error" in scenario, "missing scenario error field")
            error = scenario["error"]
            require(error is None or isinstance(error, str), "invalid scenario error field")
            require(outcome != "passed" or error is None, "passing scenario has non-null error")
            observer = scenario.get("observer")
            observation = observer_state(observer)
            refs = [report]
            diagnostics = keyed(scenario["artifacts"], "path", 16)
            names = set()
            for relative, artifact in sorted(diagnostics.items()):
                parent, sep, name = relative.partition("/")
                require(parent == test_id and sep and COMPONENT.fullmatch(name), "unsafe scenario artifact path")
                names.add(name)
                source_path = f"artifacts/{row['slot']}/{relative}"
                data = read_at(root, source_path, min(ARTIFACT_LIMIT, remaining))
                refs.append(add_artifact(source_path, "diagnostic", data, artifact["sha256"]))
                if name in DIAGNOSTIC_KINDS:
                    require(artifact.get("kind") == DIAGNOSTIC_KINDS[name],
                            "invalid scenario diagnostic kind")
                    payload = decode(data)
                    if name == "checks.json":
                        verify_checks(payload, result, test_id, outcome)
                    else:
                        # Format 1.0 binds the observer to the slot and scenario by path.
                        observer_state(payload)
                        require(payload == observer, "network report contradicts scenario observer")
            if outcome == "not_run":
                outcome = "missing"
                observation = "unavailable"
            elif outcome == "error" or slot_state == "error" or result_status == "error":
                observation = "error"
            elif observation == "complete" and (
                slot_state == "partial" or result_status == "not_run"
                or not (DIAGNOSTIC_KINDS.keys() | set(config["complete_artifact_names"])) <= names
            ):
                observation = "partial"
            if observation == "complete":
                require(observer["events"], "complete observer has no events")
            states[upstream_slot, test_id] = observation
            observed.append(dict(execution_id=row["execution_id"], outcome=outcome,
                                 observation=observation, artifact_ids=refs))
    for key in matrix.keys() - states.keys():
        states[key] = "unavailable"
    evidence = dict(schema_version=VERSION, campaign_id=campaign["campaign_id"],
                    collected_at=config["collected_at"], expected=list(matrix.values()), observed=observed,
                    source=dict(kind="recorded", repository=config["repository"],
                                revision=config["run_revision"], run_id=config["run_id"],
                                adapter_version="qa-features-v1"),
                    completeness=completeness(set(states.values())), artifacts=artifacts)
    ids = {row["execution_id"] for row in matrix.values()}
    require(len(ids) == len(matrix), "duplicate canonical execution identity")
    validator = Draft202012Validator(decode(SCHEMA.read_bytes()), format_checker=FormatChecker())
    require(validator.is_valid(evidence), "normalized evidence violates frozen v2 schema")
    files["evidence.json"] = encode(evidence)
    return campaign["campaign_id"], files


def check_inventory(root, expected):
    remaining = set(expected)
    with os.scandir(root) as entries:
        for entry in entries:
            require(entry.name in remaining, "unexpected publication entry")
            remaining.remove(entry.name)
    require(not remaining, "missing publication entry")


def publish(store, campaign_id, files):
    """Rename a fully staged directory. Existing published directories are nonempty."""
    store.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = store / campaign_id
    with directory(store) as store_fd, TemporaryDirectory(prefix=".import-", dir=store) as scratch:
        staged = Path(scratch) / "bundle"
        staged.mkdir(mode=0o700)
        (staged / "artifacts").mkdir()
        for relative, data in files.items():
            (staged / relative).write_bytes(data)
        try:
            os.stat(campaign_id, dir_fd=store_fd, follow_symlinks=False)
        except FileNotFoundError:
            try:
                os.rename(f"{Path(scratch).name}/bundle", campaign_id,
                          src_dir_fd=store_fd, dst_dir_fd=store_fd)
                return ImportResult(target / "evidence.json", True)
            except OSError as exc:
                # A concurrent publisher may have already installed its nonempty directory.
                if exc.errno not in {errno.EEXIST, errno.ENOTEMPTY, errno.ENOTDIR, errno.EISDIR}:
                    raise
        try:
            with directory(campaign_id, store_fd) as existing:
                check_inventory(existing, {"artifacts", "evidence.json"})
                with directory("artifacts", existing) as artifacts:
                    check_inventory(artifacts, {name.split("/")[1] for name in files
                                                if name.startswith("artifacts/")})
                require(all(read_at(existing, path, len(data)) == data for path, data in files.items()),
                        "publication bytes differ")
        except (OSError, ImportError) as exc:
            raise ImportError("conflicting or damaged immutable campaign publication") from exc
        return ImportResult(target / "evidence.json", False)


def import_campaign(source, store, config):
    """Import one campaign using configuration from an independent trusted source."""
    try:
        with directory(source) as root:
            campaign_id, files = build_bundle(root, config)
        return publish(Path(store), campaign_id, files)
    except (AttributeError, KeyError, TypeError, UnicodeError) as exc:
        raise ImportError("invalid campaign or trusted import configuration") from exc
    except OSError as exc:
        raise ImportError("source or publication directory is unavailable or unsafe") from exc
