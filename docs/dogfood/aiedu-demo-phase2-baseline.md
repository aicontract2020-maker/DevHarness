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

## 2026-09-18 launch lifecycle (`e54565d`)

- Added sealed `command-lifecycle` driver: launch verify = start owned service → readiness → probe → teardown (no re-spawn of launch).
- Doctor `service-launch` now reads current launch manifests (`launchReceipt` no longer hard-null).
- Dogfood @ `a2e7334b`:
  - ✓ `aiedu-postgres-redis-launch` sealed (TCP readiness + teardown).
  - ● `aiedu-full-stack-launch` — sealed PASS @ `96055667` (`verify-1789753876936-ee206033`); product UNION + Node 22 fixes landed.
- Ladder **11/14**; doctor score **88**; `service-launch` **pass**.

## 2026-09-18 full-stack product fix + sealed launch

- aiedu dogfood HEAD `96055667`: cast `class_student.student_id` to integer in `class_member` / `class_group_member` views (030/035); TYPE_OVERRIDES for `class_student.student_id`; pilot frontend Dockerfile → Node 22.
- Manual prove: `/health` healthy + frontend HTTP 200; migration 030→035 clean.
- Sealed `aiedu-full-stack-launch` on Goal Run `run-95bc169b…` @ `96055667` → receipt `verify-1789753876936-ee206033`, attestation issued (backend `:18000/health/ready` + frontend `:13000/` both pass).
- Remaining ladder gaps unchanged in kind: ○ `controlled-change-marker` (clean HEAD), ○ `web-playwright` (behavior), supervisor-isolation / behavior-verification still blocked until playwright seals.

## 2026-09-18 re-attest at 96055667

Re-sealed on Goal Run `run-95bc169b…` after HEAD moved for full-stack fixes:
- PASS: health-service-field, health-live-and-legacy-service, pytest-health-readiness, frontend-lint, frontend-build, docker-compose-build, aiedu-postgres-redis-launch, aiedu-full-stack-launch, frontend-test, frontend-test-failover
- FAIL (not sealed): python-tests — 1 failed / 3851 passed (`test_non_adaptive_report_keeps_order_index_when_timestamps_tie`); unrelated to full-stack fixes
- Still open: controlled-change-marker (clean HEAD), docs-readiness-summary, web-playwright / behavior-verification, supervisor-isolation

## 2026-09-18 python-tests flake fix

- Fixed `test_non_adaptive_report_keeps_order_index_when_timestamps_tie`: pin item ids (`item-zzz-c` / `item-mmm-b` / `item-aaa-a`) so `!= sorted(...)` is deterministic.
- Dogfood HEAD `05e4b104`; Goal Run `run-62514227…`; `python-tests` sealed PASS; suite re-sealed at new SHA → phase2 **11/14**.
