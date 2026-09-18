# aiedu Phase 2: `python-tests` triage

Receipts:
- First fail: `verify-1789620832823-47561c3e` (FAIL, ~48s)
- Re-attest after DB scrub: `verify-1789653847210-6e27af06` (FAIL, ~53s)

Both: **121 failed / 3446 passed / 240 skipped / 47 errors** — identical shape.

## Corrected root cause (2026-09-17 re-attest)

| Bucket | Count (approx) | Nature | Notes |
|--------|----------------|--------|-------|
| Default Postgres to `:5432` | majority of FAIL+ERROR (~90 OperationalError blocks) | `psycopg2.OperationalError: Connection refused` to `localhost:5432` | **Not** a host-env leak. Host shell has no `DATABASE_*`. Product `backend/src/config/settings.py` defaults `KB_DATABASE_URL` / `USER_DATABASE_URL` to `postgresql://…@localhost:5432/…`; module-level engines in `kb_session.py` / `user_session.py` connect on import. `conftest` SQLite only covers `get_db`. |
| Client fixture timeouts | ~47 CancelledError | Cascade from DB connect failures | |
| Assertion/contract | ~10–15 | Product or test-contract | Triage **only after** DB baseline is honest |
| SQLite type adapter | few | Query binding | Separate small slice |

## What the scrub did / did not do

DevHarness `322b994` + `cd8c633`: for `command.kind === "test"`, scrub host DB env keys unless listed in `env_keys`.

- Hygiene is still correct (prevents a real host `.env` from poisoning unit verify).
- On this Mac, `set_keys` was already `[]` before and after — scrub could not change outcomes.
- Leaving defaults unset surfaces the product’s localhost Postgres defaults.

## Phase 2 stance

Full backend `pytest -q` is **not** a stable DevHarness baseline until either:

1. **Disposable Postgres (preferred harness path)** — declare harness services for KB+user DB and attach them to `python-tests` (or a dedicated `python-tests-pg` command), or
2. **Narrow attested command** — keep `pytest-health-readiness` (already PASS) and/or a SQLite-safe subset as the Phase2 automated-tests rung until product fixtures patch KB/user engines, or
3. **Consumer conftest fix** — monkeypatch settings / delay engine creation (touches aiedu; avoid unless Kai wants product work).

Do **not** treat remaining AssertionErrors as a product bug list yet.

## Repro

```bash
cd /Users/kaimaplespark/GAC/git/film-making/DevHarness
node packages/cli/src/cli.mjs verify \
  --repo local-projects/aiedu-demo/worktree-dogfood-clean \
  --config local-projects/aiedu-demo/devharness.yaml \
  --run run-07377e5c-8aaf-4ae9-99bc-debe3782d1e3 \
  --command python-tests --execute --attest
```

Caps: `dependency-install` + `service-runtime` (TTY APPROVE phrase).

## 2026-09-17 harness services path

DevHarness now allows:
- `harness.verifications` on **test** (as well as verify) commands
- TCP readiness (`kind: tcp`, `tcp://127.0.0.1:port`) for DB/cache ports

aiedu local config (gitignored `local-projects/aiedu-demo/`):
- launch `aiedu-postgres-redis-launch` → `scripts/start-postgres-redis-for-tests.sh`
- service `aiedu-postgres-redis` (TCP 55432 + 56379 from compose overlay)
- `python-tests` bound to that service; command inlines KB/USER/REDIS URLs to overlay ports

Re-attest after caps approve.

## 2026-09-17 after disposable Postgres+Redis

Receipt `verify-1789657568042-dc37cf7d`:
- Service `aiedu-postgres-redis`: readiness **pass** (TCP 55432+56379), teardown **pass**
- `:5432` Connection refused: **0**
- Pytest: **324 failed / 3481 passed / 2 skipped / 47 errors** (~54s)

Host wiring works. Remaining failures are no longer “no DB”; next slice is **schema/migrate/seed** (and fixture expectations) against empty compose DBs — not more harness plumbing.

## 2026-09-17 migrate/seed on owned Postgres

`local-projects/aiedu-demo/scripts/migrate-seed-for-tests.sh` (called from postgres-redis launch):
1. Ephemeral patch of aiedu user migrations 030/035 UNION casts (TEXT vs INTEGER) in the verify worktree
2. KB + user `alembic upgrade head`
3. `dashboard_copy` + `seed_default_users` (dogfood passwords from `.env.example` defaults)
4. Best-effort `scripts/kb_reconcile.py`

Smoke: 82 user tables, 6 seeded users, KB schema present.

## 2026-09-17 after migrate/seed (+ patch restore)

Receipt `verify-1789659292950-f92d362a`:
- Service readiness/teardown **pass**; `dirty_after: false` (ephemeral 030/035 patches restored after alembic)
- KB reconcile ran (subjects refreshed)
- Pytest: **48 failed / 3757 passed / 2 skipped / 47 errors** (~57s)
- `:5432` / `UndefinedTable`: **0**

Remaining FAIL bucket is mostly product/test-contract (gemini failover mocks, bulk admin CSV, loadtest scripts, a few review/mix asserts) — not harness DB plumbing. ERROR lines still include client/setup CancelledError noise to triage separately.


## 2026-09-17 triage of remaining 48 FAIL + 47 ERROR

Source receipt: `verify-1789659292950-f92d362a`. Machine JSON: `/tmp/python-tests-triage-20260917.json`.

**Do not treat remaining AssertionErrors as a product bug list until env/fixture buckets below are clean.**

### ERROR (47) — one env root

| Files | Count | Signature | Bucket |
|-------|------:|-----------|--------|
| `test_admin_authorization`, `test_auth_tokens`, `test_password_management`, `test_knowledge_base` | 47 | `client` → `TestClient` lifespan → `seed_default_users` **`SystemExit(1)`** → surfaces as `CancelledError` | **env** |

Root: verify process env only keeps safeKeys + `declared_keys` (and DB scrub for `kind=test`). `SEED_USER_*` are **not** declared on `python-tests`, so lifespan seed fails with:

`ERROR: seed user password(s) missing or empty: guest, teacher, parent, admin, overseer, schooladmin`

Migrate/seed already populated the owned Postgres; TestClient still re-runs seed on startup and needs those env vars.

Same root explains FAIL `test_default_user_seed_creates_required_dev_accounts` (`SystemExit: 1`).

### FAIL by bucket

| Bucket | Count | Files | Nature | Product? |
|--------|------:|-------|--------|----------|
| Gemini + live Redis sticky | 19 | `test_gemini_failover.py` | `backup-key != primary-key`, cooldown/exhaustion; harness sets `REDIS_URL=…56379`; shared Redis cooldowns leak across unit tests (only ~4 tests clear `REDIS_URL`) | No — **env** |
| Readiness vs live KB | 12+1 | `test_readiness_service.py`, `test_readiness_api.py` | e.g. `skill_rational_expressions` vs `skill_polynomial_*`; node counts 5≠12, 2≠6 — reconciled KB topology ≠ fixture assumptions | No — **fixture/live-KB** |
| School admin cred row | 4 | `test_school_admin_usage.py` | `LookupError: credential_version: user 100 not found` | No — **fixture** |
| Bulk CSV drift | 2 | `test_bulk_admin_create_users.py` | expects `STU-001`, CSV has `STUA-0088` | No — **fixture** |
| Loadtest path | 2 | `test_loadtest_run_staged.py` | `cd: ../pilot: No such file` in tmp | No — **env/path** |
| Seed passwords | 1 | `test_user_database_startup_cutover.py` | same SEED env as ERROR | No — **env** |
| Admin delete sqlite bind | 1 | `test_admin_user_delete.py` | `Query` bound into sqlite param | **maybe** product — defer |
| Mix mistakes ranking | 3 | `test_mix_post_attempt_top.py` | `Question 3` vs `Question 1` | **maybe** — defer |
| Misc asserts | 3 | mistake open review, review hub, submit_db_reads | recap/`UPR-MTH301` title/SELECT counts | **maybe** — defer |

### Recommended next fix slices (order)

1. **Inject `SEED_USER_*` (and a stub `GEMINI_API_KEY` if lifespan requires it) into the `python-tests` command env** — same defaults as migrate-seed / `.env.example`. Expect ~47 ERROR + 1 seed FAIL to clear.
2. **Isolate Redis for `test_gemini_failover`** — autouse `REDIS_URL=""` (or module-scoped scrub). Expect ~19 FAIL.
3. **Isolate readiness from live reconciled KB** (fixture graph / mock pool). Expect ~13 FAIL.
4. **CSV expectation + loadtest pilot stub** — 4 FAIL.
5. Re-attest, then triage leftover AssertionErrors as product/contract.

### Repro notes

- Artifacts: `~/.local/state/devharness/projects/3b5e3cf63c8008d4b848ec5ef0e6d33482b41e63c5da0288c9ee12b346df4b17/verification/verify-1789659292950-f92d362a/artifacts/`
- `:5432` / `UndefinedTable`: **0** (Postgres+migrate baseline is honest)

## 2026-09-17 after SEED+GEMINI env on python-tests

Local gitignored `devharness.yaml` `python-tests` `run` now inlines (same defaults as migrate-seed / `.env.example`):
- `SEED_USER_*` passwords
- stub `GEMINI_API_KEY=devharness-test-stub-key` (startup presence check only)

Receipt `verify-1789698078729-b89c32af`:
- Service readiness/teardown **pass**; `dirty_after: false`
- Pytest: **40 failed / 3812 passed / 2 skipped / 0 errors** (~86s)
- `ERROR at setup` / `CancelledError` / missing seed passwords / missing Gemini: **0**

Slice 1 worked: the 47 ERROR client-setup cascade is gone. Net ~+55 passes from former ERROR/seed paths; remaining FAIL still dominated by gemini+live Redis (19), then school_admin/mix/loadtest/bulk CSV/etc. Next: isolate Redis for `test_gemini_failover`.

## 2026-09-17 after isolate_gemini_redis plugin

Harness-local (no consumer edits):
- `local-projects/aiedu-demo/pytest_plugins/isolate_gemini_redis.py` — autouse clears `REDIS_URL` + resets shared cooldown client for `test_gemini_failover.py` only
- `python-tests` loads it via `PYTEST_PLUGINS` + `PYTHONPATH` + `-p isolate_gemini_redis`

Receipt `verify-1789702525541-b89aa525`:
- **21 failed / 3831 passed / 2 skipped / 0 errors** (~67s)
- `test_gemini_failover` FAILs: **0** (was 19)
- `backup-key != primary-key`: **0**

Remaining FAIL (~21): school_admin (4), mix ranking (3), admin_authorization (3), password (2), loadtest (2), bulk CSV (2), plus one-offs (delete/submit/review/mistake/answer_evaluation).

## Pinned baseline revision (2026-09-18)

Baseline test fixes are **in-tree** on dogfood branch `dogfood/agent-runtime-20260914-163931` at:

`f426af23acce2e535799b86a1ca4a463bcff56cc`

(FF-merge of `dogfood/python-tests-baseline-fixes`.)

| Item | Value |
|---|---|
| Goal Run | `run-a298786c-f588-46e3-a92d-13f6fd9ffb72` (clarifying) |
| Verify receipt | `verify-1789737886209-4f94c72d` |
| Outcome | PASS, `dirty_after: false` |
| Revision | `f426af23acce…` |
| Overlay | `run-python-tests-with-baseline-fixes.sh` skips patch apply when HEAD already contains the fixes; patch file kept as safety for older checkouts |
| Prior run (pre-pin) | `run-07377e5c-…` @ `7f32844` — superseded for baseline attest |

