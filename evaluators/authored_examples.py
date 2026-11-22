"""Generate private, explicitly authored response examples for offline replay."""

import argparse
from pathlib import Path

from evaluate import TELEMETRY, SAFETY, VERSION, corpus, digest, encode, model_input

PROMPT = b"Authored fixture marker. No prompt was sent to a model."


def example(candidate=False):
    config = dict(model_id="authored-response-placeholder", region=None,
                  prompt_sha256=digest(PROMPT), tool_contract_version="fixture-v1",
                  parameters=dict(temperature=0, max_tokens=128))
    run_id = "authored-candidate" if candidate else "authored-baseline"
    trials = []
    for case, truth in corpus().items():
        fixture = model_input(case)
        binding = truth["binding"] or {"campaign_id": case, "sha256": digest(encode(fixture))}
        identity = dict(campaign_id=binding["campaign_id"], evidence_sha256=binding["sha256"],
                        investigation_id=f"{run_id}-{case}", fixture_or_run_id=run_id)
        response = dict(**identity, **{k:v for k,v in config.items() if k != "region"},
                        schema_version="2.0.0-draft.1", usage=None, estimated_cost_usd=None,
                        latency_ms=0, category=truth["category"])
        if truth["kind"] == "defect":
            response.update(status="DIAGNOSED", uncertainties=[], claims=[
                dict(statement=rule["statement"], evidence_ids=rule["required"]) for rule in truth["support"]
            ])
        else:
            response.update(status="INCONCLUSIVE", uncertainties=[truth["uncertainty"]], claims=[])
        if not candidate and case == "c-876a870bcba73cec":
            response["category"] = "unrelated-category"
            response["claims"][0]["evidence_ids"] = ["a2"]
        if not candidate and case == "c-90291263278212ae":
            response = None
        if not candidate and case == "c-c2ac8b4b5167f3a0":
            response["uncertainties"] = ["Maybe intermittent."]
        trials.append(dict(**identity, case_id=case, trial=1, response=response,
                           protocol_valid=True, safety=dict.fromkeys(SAFETY, False),
                           telemetry=dict.fromkeys(TELEMETRY)))
    return dict(schema_version=VERSION, configuration=config, source="authored",
                run_id=run_id, trials_per_case=1, trials=trials)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_directory", type=Path)
    args = parser.parse_args()
    for name, candidate in (("baseline", False), ("candidate", True)):
        (args.output_directory / f"{name}.json").write_bytes(encode(example(candidate)))
