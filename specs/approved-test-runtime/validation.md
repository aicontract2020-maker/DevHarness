# Validation: Approved Test Runtime

Status: Developer review passed; external local mode validated
Validated: 2026-08-31

## Acceptance results

- AC-1 PASS: runtime tests prove that all declared readiness checks are attempted, recorded and
  required before verification; one failed check prevents the verification command.
- AC-2 PASS: runtime tests prove successful cleanup evidence and prove that a non-zero cleanup
  result fails service teardown and the overall verification.
- AC-3 PASS (structural): the external AIedu_demo declaration validates against the public
  contract and compiles against clean consumer revision
  `49a4c5dfd34442705c8a2e7eb5de1d1a325811f6` to one full-stack lifecycle, two readiness checks,
  one Playwright binding and zero declaration blockers. The compiled contract records both the
  consumer revision and configuration hash.
- AC-4 PASS: validation did not invoke Docker Compose, AIedu services, Playwright or consumer test
  commands. AIedu_demo has zero tracked or untracked changes and contains no `devharness.yaml`.

## Quantitative evidence

- DevHarness regression at initial approval: 139/139 tests passed. External-config regression is
  recorded separately in `specs/external-local-config/validation.md`.
- Approved runtime additions: 4 new lifecycle tests passed.
- Review UI: 5/5 tests passed; lint and production build passed.
- AIedu declaration structural coverage: 100/100.
- AIedu declaration blockers: 0.
- AIedu configured launch surfaces: 1/1 lifecycle-bound.
- AIedu configured behavior jobs: 1/1 service-bound.

## Important limit

The 100/100 score measures declaration completeness only. No runtime correctness is claimed yet.
Actual readiness remains blocked until required local capabilities are approved and the Docker
stack, database state and browser behavior produce signed evidence bound to the clean consumer
revision and exact external configuration hash. The declaration creates its isolated test
environment only from
`config/.env.example`; it neither copies nor requires a production credential file.

The live developer review page was also verified in the real browser. It now exposes the project
declaration before any Goal Run exists and shows both exact execution surfaces instead of requiring
the developer to open the configuration file.

## Developer decision

The developer approved the project declaration on 2026-08-31 and subsequently required local-only
testing with no AIedu_demo file changes. DevHarness therefore loads the exact declaration from its
ignored local project area. Chat approval is recorded as product history, not misrepresented as a
signed Supervisor capability receipt; runtime execution still requires those explicit receipts.

## Subsequent local runtime result

The developer later approved the bounded local capabilities and a full isolated browser run was
performed without modifying AIedu_demo. The runtime result is intentionally not a passing claim:
23 tests passed, 14 failed, 4 skipped and 74 were dependency-blocked. Both readiness checks and
bounded teardown passed. Full findings and the receipt id are recorded in
`specs/aiedu-local-dogfood/validation.md`.
