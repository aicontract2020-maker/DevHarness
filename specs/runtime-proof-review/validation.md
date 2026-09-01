# Validation: Runtime Proof Review

Status: Ready for developer review
Validated: 2026-08-31

## Outcome

All framework acceptance criteria passed. The real AIedu run stopped honestly before Playwright
because one declared route failed warmup; this is a consumer finding, not a framework pass claim.

## Quantitative evidence

- DevHarness regression: 149/149 tests passed.
- Schema regression after extending the bounded startup range: 17/17 passed.
- Review UI: 6/6 tests, lint and production build passed.
- Browser review: the live page rendered receipt totals, current/stale status, latest outcome,
  readiness, cleanup and five recent runs without opening logs.
- AIedu receipt `verify-1788214709418-344e849b`:
  - Goal Run binding: `run-b95fdcb8-d0a2-47c8-a32f-655a49a7a6b0`.
  - Revision-pinned submodules: 1/1 materialized at the declared commit.
  - Full-stack readiness: 2/2 passed.
  - Declared HTTP warmup: 10/11 passed.
  - `/signup`: failed after a bounded 120 seconds of connection failures.
  - `/subject-selection` and `/profiling`: returned 200 immediately afterward.
  - Teardown: passed; isolated containers, network, volumes and worktree removed.
  - Passing attestation: correctly not issued.
- AIedu_demo working tree: clean before and after all runs.

## Acceptance trace

| Criterion | Result | Evidence |
|---|---|---|
| AC-1 Goal-bound receipt | PASS | receipt schema/runtime tests and real AIedu Goal Run id |
| AC-2 Compact projection | PASS | deterministic projection, corruption omission and cap tests |
| AC-3 Review panel | PASS | API/client/UI tests plus live in-app browser inspection |
| AC-4 Submodule preparation | PASS | exact-commit lifecycle test plus real `database/course` materialization |
| AC-5 Declared warmup | PASS | ordered bounded test plus real 10/11 recorded result |
| AC-6 Service-exit classification | PASS | owned-service exit regression returns `service-exited` |
| AC-7 Honest system evidence | PASS | sealed verify driver emits E2 test-result only; no E3 claim |
| AC-8 Parallelism fails closed | PASS | scheduler cycle, dependency, path and workspace-conflict tests |
| AC-E1 Missing/corrupt data | PASS | invalid receipts omitted; UI uses bounded unavailable state |

## Findings exposed by real execution

1. The original PostgreSQL health check could pass during the image's temporary initialization
   server. The external-only overlay now requires the final PID 1 postmaster plus a real SQL query.
2. Importing 418,291 assessment records and building the production frontend exceeded the original
   ten-minute startup ceiling. Framework schemas now permit a project-declared maximum of thirty
   minutes; AIedu declares twenty minutes. The wait remains bounded.
3. Production readiness completed, but `/signup` repeatedly terminated the HTTP request while ten
   other declared pages returned 200. Playwright did not start, so later failures were not invented.

## Evidence boundary

The command-system driver can seal a current passing `verify` receipt as E2. It does not claim a
browser snapshot, network response or database-state proof. The real AIedu run failed before test
execution and therefore produced no passing evidence.

## Drift and compatibility

- Older v1 project declarations remain valid because warmup is optional at source and compiles to
  an empty list.
- Older receipts remain reviewable because new preparation, warmup, reason and Goal Run fields are
  additive.
- AIedu_demo contains no DevHarness configuration or generated file.

