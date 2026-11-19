---
name: harness-author
description: Extend the QualityOps Stage 0 local verification harness, its fixture checks, ownership checks and execution report.
---

Read AGENTS.md, SPEC.md, PLAN.md, contracts/v2 and harness/README.md. Identify the approved invariant and its owning paths. Report schema disagreements for human reconciliation.

Add a focused unittest in harness/test_checks.py. Build deliberate failures from temporary fixture copies and assert the intended rejection. Keep synthetic wire examples labeled. Extend the fixed check list in harness/verify.py only if the new check needs a separate recorded command. Preserve the restricted child environment and record failures and unexecuted checks explicitly.

Run the README command and inspect harness/verification.json or the printed candidate report. Return exact results, limitations and freeze blockers. Keep the work within the development harness.
