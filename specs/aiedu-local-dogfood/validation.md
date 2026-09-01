# AIedu_demo Local Dogfood Validation

Status: Runtime findings ready for developer review
Validated: 2026-08-31

## Safety boundary

- Consumer revision: `49a4c5dfd34442705c8a2e7eb5de1d1a325811f6` (`demo_deploy`).
- Execution used a disposable Git worktree plus isolated PostgreSQL, Redis, backend and frontend
  containers.
- Configuration, dependencies, results, screenshots and receipts remained under DevHarness's
  ignored `local-projects/aiedu-demo/` area.
- AIedu_demo was clean before and after execution. No consumer file was created or changed.
- Teardown passed and removed the run's containers, network and volumes.

## Quantitative result

Receipt: `verify-1788210530580-e20d9ef1`

- Declared Playwright cases: 115.
- Passed: 23.
- Failed: 14.
- Skipped: 4.
- Did not run because prerequisite projects failed: 74.
- Duration: 11.6 minutes after service readiness and route prewarming.
- Full-stack readiness checks: 2/2 passed.
- Teardown: passed.
- Passing evidence: correctly not issued because the verification failed.

## What the run proved

- The repository can be started from a clean revision with an isolated PostgreSQL and Redis data
  plane, backend, frontend and seeded non-production users.
- The real browser completed all six authentication cases after cold routes were prewarmed.
- Admin, parent, student, teacher and profile journeys all produced real passing observations; the
  result is not based on API-only smoke testing.
- The first run's student and parent login timeouts were harness cold-start false negatives: both
  login APIs returned HTTP 200, while first route compilation exceeded the tests' 15-second wait.

## Failure clusters (review by exception)

1. **Two likely data/UI contract mismatches.** The parent dashboard did not expose any text matching
   its expected weekly-widget vocabulary. The student home page did not expose an expected active
   learning label. Both pages and their supporting API calls loaded successfully.
2. **Two cold-compilation timeouts.** `/progress` required about 141 seconds to compile in the local
   Next.js development server; the progress and following achievements journeys exceeded their
   60-second test budgets.
3. **Ten cascading runtime failures.** During the later profile/onboarding phase the frontend
   process stopped responding. The first cases reported aborted or empty responses and the
   remaining cases immediately reported connection refused. These are one runtime incident, not
   ten independent product defects.
4. **Four explicit skips.** Three signup-form tests were skipped by repository configuration. The
   teacher knowledge-base test was skipped after the isolated backend reported no imported course
   trees.

## Repository and harness gaps exposed

- The course-content Git submodule exists in the consumer checkout, but DevHarness's disposable Git
  worktree did not materialize its content. Worktree isolation therefore needs an explicit,
  revision-pinned submodule preparation step.
- A development server is useful for local diagnostics but unstable and slow for a full browser
  acceptance suite. The project pack needs a bounded production-build/start mode or a declared
  route-prewarming phase.
- Test output is captured intact but not yet summarized into the developer review page. Developers
  should see counts, failure clusters, blocked coverage and evidence links without reading logs.
- The public `verify --attest` path only has a sealed unit-test evidence driver today. A distinct
  browser/system evidence driver is required before a passing Playwright receipt can satisfy
  behavioral acceptance criteria.
- The runner executes the repository's configured single-worker dependency graph faithfully, but
  lacks framework-level safe parallel scheduling, slow-test reporting and cascade suppression.
- Frontend dependency installation reported seven dependency vulnerabilities (one moderate, six
  high); this is a finding, not proof that the application is exploitable.

## Decision requested

Approve the next DevHarness increment to implement:

1. browser/system evidence ingestion and a compact review-page verification panel;
2. revision-pinned submodule materialization in disposable worktrees;
3. declared warmup plus stable service modes, with cascade-aware result classification;
4. safe parallel execution only after dependency and state-isolation checks pass.

No AIedu_demo product fix is proposed in this increment. Product findings remain evidence for a
separate, explicitly authorized goal.

## Runtime hardening follow-up — 2026-08-31

Receipt `verify-1788214709418-344e849b` exercised the new DevHarness lifecycle:

- The `database/course` submodule was materialized at exact commit
  `38a0d703fa3173b8f83bf3fbaa5f5799238f4bae` in the disposable worktree.
- A stricter external PostgreSQL health check eliminated a real initialization race that previously
  claimed `aiedu_user` was ready after two refused connections.
- Full import loaded 51 units, 281 lessons, 1,211 knowledge points, 418,291 assessments and 992
  resources before the backend became ready.
- Backend and frontend readiness passed 2/2 within the new project-declared 20-minute bound.
- Route warmup passed 10/11. `/signup` repeatedly failed at the connection level for 120 seconds;
  `/subject-selection` and `/profiling` returned 200 immediately afterward.
- Playwright was correctly not started, passing evidence was not issued, teardown passed, and
  AIedu_demo remained Git-clean.

The next product-level question is now narrow: why the production `/signup` route terminates its
HTTP request while adjacent routes remain healthy. Investigating or changing that route requires a
separate authorized AIedu goal.
