"""Verify local evidence against independently supplied policy and receipts."""
import re
from pathlib import Path
from tempfile import TemporaryDirectory

from jsonschema import Draft202012Validator, FormatChecker

from ..ingestion import importer as a1
from .policy import decide

CONFIRMATION = (
    "Complete mandatory failure corroborated by a trusted source receipt "
    "for the campaign, execution and artifact digest."
)
PRECEDENCE = ["BLOCKED", "INCONCLUSIVE", "ELIGIBLE"]
MAX_EXECUTIONS = 1024
SHA256 = re.compile(r"[0-9a-f]{64}")


def schema(name):
    return a1.decode(a1.SCHEMA.with_name(f"{name}.schema.json").read_bytes())


def validate(document, contract, message):
    validator = Draft202012Validator(contract, format_checker=FormatChecker())
    a1.require(validator.is_valid(document), message)


def read_external(path, bundle):
    path = Path(path)
    a1.require(not path.resolve().is_relative_to(bundle.resolve()),
               "trusted inputs must be outside the bundle")
    with a1.directory(path.parent) as root:
        return a1.read_at(root, path.name, a1.MANIFEST_LIMIT)


def load_policy(raw, expected_schema):
    policy = a1.decode(raw)
    a1.require(isinstance(policy, dict) and policy.keys() ==
               {"version", "required", "confirmed_failure", "precedence"}, "invalid policy fields")
    a1.require(isinstance(policy["version"], str) and a1.IDENTIFIER.fullmatch(policy["version"])
               and policy["confirmed_failure"] == CONFIRMATION
               and policy["precedence"] == PRECEDENCE, "unsupported policy rules or version identifier")
    required = a1.keyed(policy["required"], "execution_id", MAX_EXECUTIONS)
    validate(policy["required"], expected_schema, "invalid required policy matrix")
    return policy, required


def load_bundle(bundle, contract):
    with a1.directory(bundle) as root:
        raw = a1.read_at(root, "evidence.json", a1.MANIFEST_LIMIT)
        evidence = a1.decode(raw)
        a1.require(isinstance(evidence, dict), "invalid evidence manifest")
        expected = a1.keyed(evidence.get("expected"), "execution_id", MAX_EXECUTIONS)
        observed = a1.keyed(evidence.get("observed"), "execution_id", MAX_EXECUTIONS)
        artifacts = a1.keyed(evidence.get("artifacts"), "id", a1.MAX_ARTIFACTS)
        validate(evidence, contract, "evidence violates frozen v2 schema")
        a1.require(observed.keys() <= expected.keys(), "unexpected execution")
        a1.require(len({a["path"] for a in artifacts.values()}) == len(artifacts),
                   "duplicate artifact path")
        for row in observed.values():
            refs = row["artifact_ids"]
            a1.require(set(refs) <= artifacts.keys(), "unresolved artifact reference")
            a1.require(row["outcome"] == "missing" or
                       any(artifacts[ref]["kind"] == "execution-report" for ref in refs),
                       "observation lacks an execution report")
        entries = {"evidence.json", "artifacts"} if artifacts else {"evidence.json"}
        a1.check_inventory(root, entries)
        data = {}
        if artifacts:
            names = {ident: artifact["path"].removeprefix("artifacts/")
                     for ident, artifact in artifacts.items()}
            with a1.directory("artifacts", root) as artifact_dir:
                a1.check_inventory(artifact_dir, names.values())
                remaining = a1.BUNDLE_LIMIT
                for ident, name in names.items():
                    payload = a1.read_at(artifact_dir, name, min(a1.ARTIFACT_LIMIT, remaining))
                    a1.require(a1.digest(payload) == artifacts[ident]["sha256"],
                               "artifact digest mismatch")
                    data[ident] = payload
                    remaining -= len(payload)
    return raw, evidence, expected, observed, artifacts, data


def synthetic_facts(evidence, expected, observed, artifacts, data, receipts):
    a1.require(isinstance(receipts, dict), "invalid synthetic receipt index")
    for campaign_id, entries in receipts.items():
        a1.require(a1.IDENTIFIER.fullmatch(campaign_id) and isinstance(entries, dict) and
                   all(a1.IDENTIFIER.fullmatch(ident) and isinstance(digest, str) and
                       SHA256.fullmatch(digest) for ident, digest in entries.items()),
                   "invalid synthetic receipt")
    receipts = receipts.get(evidence["campaign_id"], {})
    complete = observed.keys() == expected.keys() and all(
        row["observation"] == "complete" and row["outcome"] != "missing"
        for row in observed.values()
    )
    a1.require(complete == (evidence["completeness"] == "complete"), "inconsistent completeness")
    facts = set()
    for ident, row in observed.items():
        fact = {key: row[key] for key in ("execution_id", "outcome", "observation")}
        refs = row["artifact_ids"]
        for ref in refs:
            a1.require(artifacts[ref]["kind"] == "execution-report", "invalid fixture report kind")
            a1.require(a1.decode(data[ref]) == fact, "fixture report contradicts observation")
        if len(refs) == 1 and receipts.get(ident) == artifacts[refs[0]]["sha256"]:
            facts.add(tuple(fact.values()))
    return facts


def recorded_facts(evidence, artifacts, data, receipt, scratch):
    # Recreate A1's source layout from the already bounded, verified byte snapshot.
    # A1 authenticates the original manifest and its diagnostic declarations before
    # deriving any execution outcome, observation state or artifact reference.
    with TemporaryDirectory(prefix="gate-replay-", dir=scratch) as temporary:
        source = Path(temporary)
        seen = set()
        for ident, artifact in artifacts.items():
            location = artifact["source_path"]
            a1.require(location not in seen, "duplicate source artifact path")
            seen.add(location)
            if location == "adapter/receipt.json":
                a1.require(data[ident] == a1.encode(receipt), "embedded receipt differs from trusted receipt")
                continue
            parts = location.split("/")
            a1.require(location == "campaign.json" or
                       (len(parts) == 4 and parts[0] == "artifacts" and
                        all(a1.COMPONENT.fullmatch(part) for part in parts)),
                       "unsafe recorded source artifact path")
            target = source.joinpath(*parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data[ident])
        try:
            with a1.directory(source) as root:
                _, normalized = a1.build_bundle(root, receipt)
        except (AttributeError, KeyError, TypeError, UnicodeError) as exc:
            raise a1.ImportError("invalid recorded report or trusted receipt") from exc
    verified = a1.decode(normalized["evidence.json"])
    a1.require(verified == evidence, "recorded bundle differs from A1 normalization")
    return {(row["execution_id"], row["outcome"], row["observation"]) for row in verified["observed"]}


def replay(bundle, policy_path, receipt_path, *, scratch=None):
    """Return canonical decision content, excluding CLI presentation metadata."""
    bundle = Path(bundle)
    contract = schema("evidence")
    policy_bytes = read_external(policy_path, bundle)
    policy, required = load_policy(policy_bytes, contract["properties"]["expected"])
    receipt = a1.decode(read_external(receipt_path, bundle))
    raw, evidence, expected, observed, artifacts, data = load_bundle(bundle, contract)
    a1.require(expected == required, "expected matrix differs from trusted policy")
    source = evidence["source"]
    adapter = (source["kind"], source["adapter_version"])
    if adapter == ("synthetic", "fixture-v1"):
        facts = synthetic_facts(evidence, expected, observed, artifacts, data, receipt)
    elif adapter == ("recorded", "qa-features-v1"):
        facts = recorded_facts(evidence, artifacts, data, receipt, scratch)
    else:
        raise a1.ImportError("unsupported evidence adapter")
    decision, reasons = decide(evidence, policy, facts)
    return dict(schema_version=a1.VERSION, campaign_id=evidence["campaign_id"],
                evidence_sha256=a1.digest(raw), policy_version=policy["version"],
                policy_sha256=a1.digest(policy_bytes), decision=decision, reasons=reasons)
