# Offline calibration review v1.0.0

Reviewer alias `Camilo-Avila` independently adjudicated all six cases against the pinned blind packet before viewing automated grades. The packet digest is recorded in `judgments.json`.

## Comparison

The evaluator's default aggregate reports agreement on 3 of 4 determinate human judgments, or 75%. Case B and E were human-unresolved and excluded from the agreement denominator. Case C had a determinate human verdict, but the grader referred its wording for review. Automated referrals remain in the denominator with zero agreement credit. There were no determinate human-versus-automated disagreements. Three cases were unresolved in the comparison: B, C, and E.

Cases A, D, and F matched between reviewer and grader. Case B remains unresolved because the evidence omits the actual HTTP statuses and resulting session state. For C, the reviewer considered the claim supported by the two observations, while the historical grader routed the wording for review. Case E also received a review referral from the grader, while the reviewer could not confidently classify the claim.

The per-case review and grader output is stored in evaluator-only `comparison.json`. The public `aggregate.json` contains counts and rates without case labels or rationales.

## Targeted rubric proposal

Keep grader v1.2.0 and its historical benchmark unchanged. For a candidate rubric revision, add a reviewer-approved paraphrase mapping for the case C claim to the existing supported proposition and its required evidence IDs `a1` and `a2`. This tests whether a direct, evidence-equivalent rewording can be supported without treating citation resolution as claim support.

Keep the reversed claim in case E as a negative control. Its result should remain referred for review until a reviewer can classify it confidently. Do not infer support merely because both citations resolve. Add the paraphrase and reversed-claim controls to the candidate rubric tests, then compare candidate and v1.2.0 on the same six cases. Promotion of a rubric change requires a separately reviewed, versioned mapping and must preserve the historical report under v1.2.0.

This is a proposal only. No grader, prompt, or rubric behavior was changed, and no live model evaluation was run.
