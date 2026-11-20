"""Pure decision logic. Call with validated policy, evidence and corroborated facts."""


def decide(evidence, policy, corroborated):
    """Evaluate using exact corroborated (execution ID, outcome, observation) tuples."""
    observed = {row["execution_id"]: row for row in evidence["observed"]}
    passes = []
    adverse = []
    blocked = False
    for execution_id in sorted(row["execution_id"] for row in policy["required"]):
        row = observed.get(execution_id, {})
        outcome = row.get("outcome")
        observation = row.get("observation")
        reason = dict(execution_id=execution_id, artifact_ids=sorted(row.get("artifact_ids", [])))
        if observation == "complete" and (execution_id, outcome, observation) in corroborated:
            if outcome == "failed":
                blocked = True
                adverse.append(dict(reason, code="REQUIRED_FAILURE"))
                continue
            if outcome == "passed":
                passes.append(dict(reason, code="ALL_REQUIRED_PASSED"))
                continue
        adverse.append(dict(reason, code="INSUFFICIENT_EVIDENCE"))
    if blocked:
        return "BLOCKED", adverse
    if adverse:
        return "INCONCLUSIVE", adverse
    return "ELIGIBLE", passes
