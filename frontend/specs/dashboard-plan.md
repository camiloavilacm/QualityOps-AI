# QualityOps AI Static Dashboard — E2E Test Plan

## Application Overview
Static React/TypeScript showcase dashboard served at `http://127.0.0.1:4183/` displaying deterministic release gate decisions (`ELIGIBLE`, `BLOCKED`, `INCONCLUSIVE`), read-only offline AI failure investigations (`DIAGNOSED`, `INCONCLUSIVE`, `ERROR`, absent), and measured live (120-trial) + offline evaluation comparison reports.

## Seed State (`tests/seed.spec.ts`)
- Navigate to `/`.
- Verify all 5 campaign cards render under the `Campaigns` region and the `Investigator evaluation reports` teaser links to `?view=evaluation`.

## Scenarios

### 1. Passing Campaign (`fixture-pass` → `ELIGIBLE`)
1. From `/`, open `Passing campaign` (`fixture-pass`).
2. Verify release decision is `ELIGIBLE`, evidence completeness is `complete`, and policy version is `mandatory-v2`.
3. Verify `ALL_REQUIRED_PASSED` reasons for executions `x` and `y` link to `#evidence-x` and `#evidence-y`.
4. Verify investigation panel reports `No investigation or evaluation record is available for this fixture.`

### 2. Partial Evidence Campaign (`fixture-partial` → `INCONCLUSIVE` Gate + `INCONCLUSIVE` Investigation)
1. Navigate to `/?campaign=fixture-partial`.
2. Verify release decision is `INCONCLUSIVE` with `INSUFFICIENT_EVIDENCE` for execution `y`.
3. Verify the read-only AI failure investigation panel displays status `INCONCLUSIVE`, mode `Offline authored replay`, and uncertainty `insufficient_causal_evidence`.

### 3. Failing Campaign with Investigator Outage (`fixture-fail` → `BLOCKED` Gate + `ERROR` Investigation)
1. Navigate to `/?campaign=fixture-fail`.
2. Verify release decision remains `BLOCKED` (`REQUIRED_FAILURE` for `x`) even when the AI investigator panel displays `ERROR` (`backend_unavailable`).

### 4. Projected Defect Investigation (`c-5125ee1591d8d901` → `DIAGNOSED` with Cited Evidence Links)
1. Navigate to `/?campaign=c-5125ee1591d8d901`.
2. Verify release decision displays `NOT APPLICABLE` (`Investigator evaluation projection`).
3. Verify AI failure investigation displays status `DIAGNOSED`, root-cause category `soft-delete-filter`, verbatim claim, and clickable citations `#evidence-a1` and `#evidence-a2`.
4. Click `Evidence a1` and verify URL hash updates to `#evidence-a1`.

### 5. Live & Offline Evaluation Comparison View (`/?view=evaluation`)
1. From `/`, click `Evaluation` in the primary top navigation.
2. Verify `Live candidate promotion (eu-west-1)` displays `BLOCKED (FAIL)` with `120 (60 baseline + 60 candidate)` measured live trials.
3. Verify the live SPEC §9 threshold table shows `per_trial_cost_usd` (`pass`), `p95_latency_ms` (`pass`), `citation_validity` (`pass`), `safety_violations` (`pass`), and `diagnosis_accuracy` (`fail`).
4. Verify the offline authored replay comparison table is rendered separately below.

### 6. Unknown Campaign Fallback (`/?campaign=nonexistent`)
1. Navigate to `/?campaign=nonexistent`.
2. Verify `Campaign unavailable` heading renders and `← All campaigns` returns to `/`.
