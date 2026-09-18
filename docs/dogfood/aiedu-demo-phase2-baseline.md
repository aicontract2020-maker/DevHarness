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

## 2026-09-17 migrate/seed attest

`python-tests` with owned Postgres+Redis + migrate/seed: **48 failed / 3757 passed / 47 errors** (`verify-1789659292950-f92d362a`). Harness path is honest; remaining fails are product/test-contract.

## 2026-09-18 Phase 2 doctor ladder climb (HEAD `7b01a854`)

Goal Run: `run-817968d0-f7c7-43a6-95e7-a34195293813`

### Proved (Supervisor evidence @ current revision)

| Command | Receipt / note |
|---|---|
| `pytest-health-readiness` | already proved |
| `python-tests` | `verify-1789738819730-1bad19e7` — 3852 passed / 2 skipped |
| `frontend-test` | `verify-1789739045801-6beead85` (after nested `npm ci` fix) |
| `frontend-test-failover` | proved |
| `health-live-and-legacy-service` | proved |
| `health-service-field` | proved |

Ladder: **6/14** proved. Next listed: `controlled-change-marker` (DevHarness dogfood probe, not product suite).

### Honest gaps

- **`frontend-lint`**: runs (eslint present after nested install) but **fails** — 2 errors + 30 warnings in consumer frontend (product debt).
- **`frontend-build` / builds**: command can PASS, but doctor stays ○ because **no sealed evidence driver is registered for build receipts** yet.
- **Launch commands**: blocked — “Launch commands require a lifecycle driver with readiness and teardown proof”.
- **`controlled-change-marker` / `docs-readiness-summary`**: external dogfood probes (marker file / env path), not Maple Spark product tests.
- **DevHarness fix:** `prepareDependencies` runs `npm ci` in one-level nested package roots (`frontend/`) — committed as `bda90e5`.

## 2026-09-18 ladder re-attest + Gate1

- Dogfood HEAD: `a2e7334b` (post lint-escape merge).
- Goal Run `run-f09020ac-83b1-4ce3-ac06-4eb31d4ec616`: **scope=approved**; ladder **7/14** sealed-proved.
- Lint/build execute green but not sealed; marker probe N/A on clean HEAD; delivery skipped (no change).

## 2026-09-18 sealed lint/build (`dc9d130`)

- Added `command-quality` Supervisor driver for `lint`|`build` receipts (`supervisor-evidence.mjs` + `verify --attest` routing).
- Re-attested `frontend-lint` + `frontend-build` on Goal Run `run-f09020ac…` @ `a2e7334b` → ladder **9/14**.
- Doctor: `build-command` **pass**; readiness **85/100**, autonomy **level 2**.
