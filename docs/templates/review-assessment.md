# DevHarness review assessment

Use with [`docs/review-scorecard.md`](../review-scorecard.md). Replace every placeholder from
revision-bound artifacts and actual observations. Do not use agent self-report as evidence.

## Evaluation identity

| Field | Value |
|---|---|
| Goal | [goal summary] |
| Goal run ID | [run ID] |
| Repository | [identity] |
| Git revision | [full SHA] |
| Approved scope hash | [hash] |
| Project-harness version | [version/hash] |
| Evaluated at | [timestamp] |
| Evaluator | [human or independent evaluator identity] |

## One-screen decision

**Verdict:** [ready / not-ready / blocked]  
**Proof coverage:** [0–100]  
**Blocking failures:** [count]  
**Developer decision:** [approve scope / approve delivery / request correction / unblock]

### Score dimensions

| Dimension | Coverage | Weighted result | Status |
|---|---:|---:|---|
| Acceptance definition | [proved/applicable] | [__/20] | [PASS/GAP/N/A] |
| System understanding | [proved/applicable] | [__/20] | [PASS/GAP/N/A] |
| Delivery traceability | [proved/applicable] | [__/20] | [PASS/GAP/N/A] |
| Verification sufficiency | [proved/applicable] | [__/30] | [PASS/GAP/N/A] |
| Independent review and closure | [proved/applicable] | [__/10] | [PASS/GAP/N/A] |

### Acceptance and evidence

| Measure | Count |
|---|---:|
| MUST: pass / fail / blocked / pending / N/A | [p / f / b / p / n] |
| Evidence: E0 / E1 / E2 / E3 / E4 | [counts] |
| Unresolved unknowns / conflicts | [u / c] |
| Unmapped requirements | [count] |
| Orphan tasks / changed behavior | [t / b] |
| Below-level / stale-invalid evidence | [l / s] |
| Open security / data-integrity findings | [s / d] |
| Late scope changes | [count] |

## Hard-gate checklist

Mark every row `PASS`, `FAIL`, or `N/A`; explain every `N/A`. Any `FAIL` prevents `ready`.

| Gate | Result | Evidence or reason |
|---|---|---|
| All MUST criteria proved | [result] | [link/ID] |
| No critical unknown or conflict | [result] | [link/ID] |
| Evidence provenance, immutability, and revision binding | [result] | [link/ID] |
| Security, privacy, authorization, and destructive-action safety | [result] | [link/ID] |
| Data-integrity and database side effects | [result] | [link/ID] |
| Real user surface exercised | [result] | [link/ID] |
| Independent implementation verification and final review | [result] | [link/ID] |
| Deployment, automation, migration, load, rollback, and canary proof | [result] | [link/ID or N/A reason] |
| Exact current Gate 1 / Gate 2 human approval | [result] | [receipt] |
| Required Supervisor trust boundary | [result] | [evidence] |

## Exceptions requiring attention

List only blocking and material exceptions, highest impact first.

| ID | Severity | Type | Affected outcome | Evidence | Required action |
|---|---|---|---|---|---|
| [EX-1] | [blocking/high] | [gap/conflict/failure/risk] | [outcome/AC] | [link] | [one action] |

## Critical-flow coverage

| Flow | Entry/UI | Auth | Backend rules | Data/side effect | Failure/recovery | Observability | Understanding proof | Behavior proof |
|---|---|---|---|---|---|---|---|---|
| [FLOW-1] | [location] | [location/N/A] | [location] | [location] | [location] | [location] | [E1 evidence] | [E3/E4 evidence] |

## Acceptance traceability

| Requirement | AC | Required level | Task | Changed behavior | Test/evidence | Independent review | Verdict |
|---|---|---:|---|---|---|---|---|
| [REQ-1] | [AC-1] | [E2/E3/E4] | [TASK-1] | [file/config/schema] | [evidence ID] | [review ID] | [PASS/FAIL/BLOCKED/PENDING/N/A] |

## Replay and drill-down

| Claim or AC | Trace | Proof | Replay | Significant changes |
|---|---|---|---|---|
| [AC-1] | [link] | [link] | [safe command/recipe] | [link] |

## Final evaluator statement

- **Why this verdict follows from the gates:** [one short paragraph]
- **What remains unproved:** [explicit list or `none`]
- **What the developer needs to inspect:** [exceptions only]
- **Exact next action:** [one action]

