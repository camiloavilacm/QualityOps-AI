"""Authored synthetic Converse exchanges for offline demonstration."""

import argparse
from decimal import Decimal
import json

from .investigator import Backend, invoke

REQUEST_ID = "00000000-0000-4000-8000-000000000001"
CASE = "c-5125ee1591d8d901"
FLAKY_CASE = "c-c2ac8b4b5167f3a0"
FINDING = dict(status="DIAGNOSED", category="soft-delete-filter",
               claim="The generated listing query had no deletion predicate and the response included that row.",
               evidence_ids=["a1", "a2"], anchor="listing query had no deletion predicate")
# A plausible-sounding guess with valid citation references and real quoted symptoms.
UNSUPPORTED = dict(status="DIAGNOSED", category="timeout",
                   claim="A timeout caused the first attempt failure.",
                   evidence_ids=["a1", "a2"], anchor="First attempt timed out without timing breakdown.")



def turn(content, stop="end_turn"):
    return {
        "stopReason": stop,
        "output": {"message": {"role": "assistant", "content": content}},
        "usage": {"inputTokens": 100, "outputTokens": 20, "totalTokens": 120},
        "ResponseMetadata": {"RequestId": REQUEST_ID, "RetryAttempts": 0},
    }


def read(*ids):
    return turn([{"toolUse": {"name": "read_evidence", "toolUseId": f"read-{index}",
                              "input": {"evidence_id": ident}}}
                 for index, ident in enumerate(ids)], "tool_use")


def answer(**value):
    return turn([{"text": json.dumps(value)}])


class Script:
    def __init__(self, *turns):
        self.turns = iter(turns)
        self.requests = []

    def converse(self, **request):
        self.requests.append(request)
        response = next(self.turns)
        if isinstance(response, Exception):
            raise response
        return response


def backend(client, **overrides):
    settings = dict(model_id="authored-offline-stub", region="offline", offline=True,
                    input_token_ceiling=2048, input_usd_per_token=Decimal(0),
                    output_usd_per_token=Decimal(0))
    return Backend(client, **(settings | overrides))


def main():
    examples = {
        "failed": ("fixture-fail", [read("x"), answer(status="INCONCLUSIVE")]),
        "partial": ("fixture-partial", [read("y"), answer(status="INCONCLUSIVE")]),
        "projected": (CASE, [read("a1", "a2"), answer(**FINDING)]),
        "unsupported": (FLAKY_CASE, [read("a1", "a2"), answer(**UNSUPPORTED)]),
        "outage": ("fixture-fail", [RuntimeError()]),
    }
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("example", choices=examples)
    name = parser.parse_args().example
    fixture_id, turns = examples[name]
    result, audit = invoke({"fixture_id": fixture_id}, backend=backend(Script(*turns)))
    print(json.dumps({"source": "authored-offline-example", "result": result, "audit": audit},
                     indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
