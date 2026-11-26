"""Reconcile the four synthetic campaign gates in the static showcase against fixture evidence."""
import argparse
from contextlib import closing
from pathlib import Path
import sqlite3

from backend.gate import replay
from backend.ingestion import importer

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "samples/reconciliation"
SHOWCASE = ROOT / "frontend/src/showcase-export.json"
BUNDLES = ("mixed", "partial", "pass", "fail")

# A passed slot has a published reason only when every required slot passed.
RECONCILE = """
WITH coverage AS (
    SELECT r.campaign, r.execution,
           CASE WHEN o.execution IS NULL THEN 'absent' ELSE o.observation END AS state,
           o.outcome,
           CASE WHEN o.confirmed AND o.observation = 'complete' AND o.outcome = 'failed'
                    THEN 'REQUIRED_FAILURE'
                WHEN o.confirmed AND o.observation = 'complete' AND o.outcome = 'passed'
                    THEN 'ALL_REQUIRED_PASSED'
                ELSE 'INSUFFICIENT_EVIDENCE' END AS code
    FROM required r LEFT JOIN observed o USING (campaign, execution)
), expected AS (
    SELECT campaign, execution, state, outcome,
           CASE WHEN code != 'ALL_REQUIRED_PASSED' OR
                     MIN(code = 'ALL_REQUIRED_PASSED') OVER (PARTITION BY campaign)
                THEN code END AS code
    FROM coverage
), keys AS (
    SELECT campaign, execution, code FROM expected
    UNION SELECT campaign, execution, code FROM published
)
SELECT k.campaign, k.execution, e.state, e.outcome, k.code,
       (e.code IS NOT NULL AND e.code = k.code) AS wanted, COUNT(p.code) AS actual
FROM keys k LEFT JOIN expected e USING (campaign, execution)
LEFT JOIN published p USING (campaign, execution, code)
GROUP BY k.campaign, k.execution, k.code
ORDER BY k.campaign, k.execution, k.code
"""


def audit(export_path):
    campaigns = importer.decode(export_path.read_bytes())["campaigns"]
    gates = {}
    ids = set()
    for campaign in campaigns:
        cid = campaign["id"]
        if cid in ids:
            raise ValueError(f"{cid}: duplicate campaign")
        ids.add(cid)
        if campaign["gate"] is None:
            continue
        if campaign["gate"]["campaign_id"] != cid:
            raise ValueError(f"{cid}: duplicate or mismatched campaign")
        gates[cid] = campaign["gate"]

    policy_bytes = (FIXTURES / "policy.json").read_bytes()
    contract = replay.schema("evidence")
    policy, required = replay.load_policy(policy_bytes, contract["properties"]["expected"])
    receipts = importer.decode((ROOT / "harness/source-receipts.json").read_bytes())
    with closing(sqlite3.connect(":memory:")) as db:
        db.executescript("""
            CREATE TABLE required (campaign TEXT, execution TEXT, PRIMARY KEY(campaign, execution));
            CREATE TABLE observed (campaign TEXT, execution TEXT, observation TEXT, outcome TEXT,
                                   confirmed INTEGER, PRIMARY KEY(campaign, execution));
            CREATE TABLE published (campaign TEXT, execution TEXT, code TEXT);
        """)
        for name in BUNDLES:
            raw, evidence, matrix, observations, artifacts, data = replay.load_bundle(FIXTURES / name, contract)
            cid = evidence["campaign_id"]
            gate = gates.pop(cid, None)
            if gate is None:
                raise ValueError(f"{cid}: missing published gate")
            if (matrix != required or gate["evidence_sha256"] != importer.digest(raw)
                    or gate["policy_sha256"] != importer.digest(policy_bytes)
                    or gate["policy_version"] != policy["version"]):
                raise ValueError(f"{cid}: policy or evidence binding differs")
            facts = replay.synthetic_facts(evidence, matrix, observations, artifacts, data, receipts)
            db.executemany("INSERT INTO required VALUES (?, ?)", ((cid, ident) for ident in required))
            for ident, obs in observations.items():
                confirmed = (ident, obs["outcome"], obs["observation"]) in facts
                db.execute("INSERT INTO observed VALUES (?, ?, ?, ?, ?)",
                           (cid, ident, obs["observation"], obs["outcome"], confirmed))
            for row in gate["reasons"]:
                execution, code = row["execution_id"], row["code"]
                if not isinstance(execution, str) or not isinstance(code, str):
                    raise ValueError(f"{cid}/{execution}: invalid published reason")
                db.execute("INSERT INTO published VALUES (?, ?, ?)", (cid, execution, code))
        if gates:
            raise ValueError(f"unexpected published campaigns: {', '.join(sorted(gates))}")
        return list(db.execute(RECONCILE))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=Path, default=SHOWCASE, help="showcase export or disposable copy")
    args = parser.parse_args()
    try:
        rows = audit(args.export)
    except (KeyError, TypeError, OSError, ValueError, sqlite3.Error) as exc:
        parser.exit(1, f"Audit failed: {exc}\n")
    failed = False
    for cid, ident, state, outcome, code, wanted, actual in rows:
        wanted = int(wanted or 0)
        matches = wanted == actual
        failed |= not matches
        print(f"{'PASS' if matches else 'FAIL'} {cid}/{ident} {state or 'unexpected'} "
              f"{outcome or '-'} {code or '(no reason)'} expected={wanted} published={actual}")
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
