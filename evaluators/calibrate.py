"""Replay six authored calibration cases with the unchanged v1.2.0 grader."""

import argparse
from collections import Counter

import evaluate as ev
from backend.investigator.examples import FINDING, Script, answer, backend, read, turn
from backend.investigator.investigator import invoke

DIRECTORY = ev.ROOT / "calibration/v1"
PACKET_SHA = "5a454dbe5983f1499373daac9bd0dc28ca1f8cd7bbd79226c51317db502d0f7e"
VERDICTS = {"supported", "unsupported", "justified_abstention", "malformed", "unresolved"}


def packet():
    value = ev.pinned(DIRECTORY / "blind-packet.json", PACKET_SHA)
    for fixture, evidence in value["evidence"].items():
        ev.require(evidence == ev.model_input(fixture)["observations"], "review evidence differs")
    return value


def judgments(review, cases):
    ev.fields(review, "packet_sha256 reviewer independent_blind_review judgments", "invalid review fields")
    ev.require(review["packet_sha256"] == PACKET_SHA, "different review packet")
    rows = review["judgments"]
    ev.require(isinstance(rows, dict) and rows.keys() <= {case["id"] for case in cases},
               "invalid judgment IDs")
    if rows:
        ev.require(review["independent_blind_review"] is True and ev.identifier(review["reviewer"]),
                   "independent blind human review requires a reviewer alias and attestation")
    for row in rows.values():
        ev.fields(row, "verdict rationale", "invalid judgment fields")
        ev.require(row["verdict"] in VERDICTS and isinstance(row["rationale"], str)
                   and bool(row["rationale"].strip()), "judgment requires a verdict and rationale")
    return rows


def trial(case, fixture):
    run_id = "calibration-v1"
    if case["stage"].startswith("model "):
        last = (answer(**(FINDING | {"claim": case["text"], "evidence_ids": case["citations"]}))
                if case["stage"] == "model claim" else turn([{"text": case["text"]}]))
        script = Script(read("a1", "a2"), last)
        response, audit = invoke({"fixture_id": case["fixture"]}, backend=backend(script), run_id=run_id)
        ev.require(audit["offline"], "offline exchange required")
        source = "recorded"  # grade() uses this mode to check the stub's observed response metadata.
        telemetry = dict(response["usage"], estimated_cost_usd=response["estimated_cost_usd"],
                         latency_ms=response["latency_ms"])
    else:
        abstains = case["stage"] == "final abstention"
        response = dict(
            schema_version="2.0.0-draft.1", campaign_id=case["fixture"],
            evidence_sha256=ev.digest(ev.encode(fixture)), investigation_id="cal-" + case["id"],
            fixture_or_run_id=run_id, status="INCONCLUSIVE" if abstains else "DIAGNOSED",
            category=None if abstains else "observation",
            claims=[] if abstains else [dict(statement=case["text"], evidence_ids=case["citations"])],
            uncertainties=[case["text"]] if abstains else [], model_id="authored-calibration",
            prompt_sha256=ev.digest(b"Authored final record; no model call."),
            tool_contract_version="fixture-v1", parameters=dict(temperature=0, max_tokens=128),
            usage=None, estimated_cost_usd=None, latency_ms=0,
        )
        source = "authored"
        telemetry = dict.fromkeys(ev.TELEMETRY)
    identity = {key: response[key] for key in
                ("campaign_id", "investigation_id", "fixture_or_run_id", "evidence_sha256")}
    config = {key: response[key] for key in ("model_id", "prompt_sha256", "tool_contract_version", "parameters")}
    row = dict(**identity, case_id=case["fixture"], trial=1, response=response, protocol_valid=True,
               safety=dict.fromkeys(ev.SAFETY, False), telemetry=telemetry)
    return row, dict(source=source, run_id=run_id), config


def automated(cases):
    truth = ev.corpus()
    validator, _ = ev.validators()
    grades = {}
    for case in cases:
        fixture = ev.model_input(case["fixture"])
        row, run, config = trial(case, fixture)
        response = row["response"]
        arguments = (run, config, truth[case["fixture"]], fixture, validator)
        grade = ev.grade(row, *arguments)
        ev.require(grade["schema_valid"], "unexpected invalid final record")
        malformed_text = response["uncertainties"] == ["invalid_model_output"] and grade["status"] == "ERROR"
        if malformed_text:
            verdict = "malformed"
        elif grade["claims"]:
            verdict = grade["claims"][0]["support"]
        elif grade["abstention_correct"]:
            verdict = "justified_abstention"
        else:
            verdict = "review_required"
        grades[case["id"]] = dict(verdict=verdict, final_status=grade["status"],
                                  final_schema_valid=True, invalid_model_text=malformed_text,
                                  claims=grade["claims"])
        if case["stage"] == "model text":
            damaged = {key: value for key, value in response.items() if key != "status"}
            control = ev.grade(dict(row, response=damaged), *arguments)
            ev.require(not control["schema_valid"], "malformed final record escaped validation")
            grades[case["id"]]["malformed_final_record_control_valid"] = control["schema_valid"]
    return grades


def comparison(review, *, private=False):
    cases = packet()["cases"]
    rows = judgments(review, cases)
    complete = len(rows) == len(cases)
    summary = dict(calibration_version="1.0.0", packet_sha256=PACKET_SHA, grader_version=ev.GRADER_VERSION,
                   total=len(cases), human_judgments=len(rows), pending_human=len(cases)-len(rows),
                   review_complete=complete)
    if not complete:
        ev.require(not private, "complete blind judgments before viewing automated grades")
        return summary | dict(agreement=ev.rate([]), disagreements=None, unresolved=None)
    grades = automated(cases)
    counts = Counter()
    matches = []
    details = []
    for case in cases:
        key = case["id"]
        verdict = rows[key]["verdict"]
        auto = grades[key]["verdict"]
        if verdict == "unresolved" or auto == "review_required":
            outcome = "unresolved"
        else:
            outcome = "agreement" if verdict == auto else "disagreement"
        if verdict != "unresolved":
            matches.append(outcome == "agreement")
        counts[outcome] += 1
        details.append(dict(id=key, human=rows[key], automated=grades[key], outcome=outcome))
    summary.update(agreement=ev.rate(matches), disagreements=counts["disagreement"],
                   unresolved=counts["unresolved"])
    if private:
        summary["cases"] = details
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private", action="store_true", help="include evaluator-only adjudication details")
    args = parser.parse_args()
    try:
        report = comparison(ev.decode(ev.read(DIRECTORY / "judgments.json")), private=args.private)
    except (ValueError, OSError) as exc:
        parser.exit(2, f"{exc}\n")
    print(ev.encode(report).decode(), end="")


if __name__ == "__main__":
    main()
