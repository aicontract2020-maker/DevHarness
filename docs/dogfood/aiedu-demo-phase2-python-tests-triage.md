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

