# aiedu Phase 2 baseline dogfood

- Goal Run: `run-07377e5c-8aaf-4ae9-99bc-debe3782d1e3`
- Attested: `pytest-health-readiness` on HEAD `7f32844e6d4e3bb721191f41479f01c57dbc51ac`
- Evidence: `manifest-76e6bccde98dcc2eadd3e3c45841fe26`
- Caps: `dependency-install` + `service-runtime` (TTY approved)

Next on the doctor Phase 2 ladder: continue remaining unproved quality commands (python-tests, frontend-test, builds, launch, playwright) toward autonomy level 2+.

## 2026-09-17 python-tests re-attest

- Caps re-approved; scrub commits `322b994` / `cd8c633` in effect.
- Receipt `verify-1789653847210-6e27af06`: still **121 failed / 47 errors / 3446 passed** (same as pre-scrub).
- Root cause corrected: product settings defaults → localhost:5432, not host env leak. See `aiedu-demo-phase2-python-tests-triage.md`.

## 2026-09-17 postgres+redis for python-tests

Wired disposable `aiedu-postgres-redis` service onto `python-tests` (TCP readiness). Local-only under `local-projects/aiedu-demo/` (gitignored). DevHarness core: test+TCP verification support.

## 2026-09-17 migrate/seed wired into aiedu-postgres-redis

Launch path now migrates KB+user schemas and light-seeds users before TCP readiness completes for dependents. See triage note.

