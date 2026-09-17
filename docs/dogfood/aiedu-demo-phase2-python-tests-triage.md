# aiedu Phase 2: `python-tests` triage

Receipt: `verify-1789620832823-47561c3e` (FAIL, exit 1, ~62s)  
Command: `uv --directory backend run --extra dev pytest -q`  
Totals: **3446 passed**, **121 failed**, **47 errors**, 240 skipped.

## Classification (Kai preference: fixture/env vs product)

| Bucket | Approx size | What the user/agent sees | Likely cause |
|---|---:|---|---|
| Host Postgres leak | majority of FAIL+ERROR (~66+ blocks hit `:5432`) | Tests crash with `psycopg2.OperationalError: Connection refused` to `localhost:5432` | Isolated verify still forwarded host `DATABASE_URL` / related declared keys into the unit-test process; SQLite fixtures never get a chance |
| Client fixture timeout | ~18 ERROR setups | `TimeoutError` while building `client` fixture | Cascade from DB connect hang / refused |
| SQLite type adapter | few | `Error binding parameter … type 'Query' is not supported` | Fixture/SQLAlchemy SQLite adapter gap |
| Assertion / contract | ~10 FAILURE blocks | Ordinary `AssertionError` | Possible real product or test-contract bugs — triage only after env is clean |

Asyncio shutdown noise (`unhandled exception during asyncio.run() shutdown`) is secondary cleanup fallout, not a separate product list.

## What this means for autonomy

Phase 2 is correctly blocked: the full backend suite is **not** a stable baseline under DevHarness verify until host DB env is scrubbed (or a disposable Postgres service is attached for tests that truly need it).

## Fix order

1. **DevHarness (done next):** for `command.kind === "test"`, do not forward host DB URL keys unless listed in that command’s `env_keys`.
2. Re-run `python-tests` attest on run `run-07377e5c-…`.
3. Only then open a product bug list from remaining AssertionErrors.

## Repro

```bash
cd /Users/kaimaplespark/GAC/git/film-making/DevHarness
node packages/cli/src/cli.mjs verify \
  --repo local-projects/aiedu-demo/worktree-dogfood-clean \
  --config local-projects/aiedu-demo/devharness.yaml \
  --run run-07377e5c-8aaf-4ae9-99bc-debe3782d1e3 \
  --command python-tests --execute --attest
```
