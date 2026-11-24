# Dashboard development verification

Follow ../AGENTS.md, ../SPEC.md and ../PLAN.md. Frontend owner C may modify only frontend/ in its assigned worktree. Sanitized recorded exports and their source provenance are preserved.

Existing Planner, Generator and Healer definitions under .codex/agents are development aids. Generated or healed tests remain disposable until independent review and human acceptance. Preserve reviewed requirements, titles, reason assertions and evidence assertions. A real regression retains its failure and is reported; never skip, weaken assertions, change expected behavior or increase retries to obtain green output. CI invokes no agent or Healer.

Use the accepted container verifier for candidate execution. Host-side type checking and trusted infrastructure diagnostics do not establish isolation or acceptance. Gate 1 covers foundation; hygiene and paired canary begin at Gate 2. Never claim missing projects, probes, reports or unsupported capabilities passed.
