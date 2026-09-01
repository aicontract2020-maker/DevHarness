# Developer Walkthrough: Runtime Proof Review

## What the developer sees

Open the local DevHarness review page. The first panel answers five questions without requiring log
review:

1. How many runs passed, failed or became stale?
2. What happened in the latest run?
3. Was it bound to the current Goal Run and Git revision?
4. Did services become ready and clean up safely?
5. Is the result E0 or sealed E2, and what E3 proof is still missing?

Only the five newest executions are expanded. Detailed receipts and logs stay available for an
exception investigation, not as mandatory reading.

## How to interpret the latest AIedu result

- `preparation pass` means the course submodule was copied from the developer's already-initialized
  checkout into an independent disposable checkout at the exact Gitlink commit.
- `2/2 ready` means backend and frontend both answered their declared health surfaces.
- `warmup-failed` means browser tests never started. Ten pages answered 200; `/signup` did not.
- `cleanup pass` means the failed run still removed its isolated resources.
- `E0` is correct for the failed run. No green evidence was issued.

## Review decision

The DevHarness increment itself is ready for review. A separate AIedu goal would be required to
diagnose or fix `/signup`; this increment has no authority to change AIedu_demo product code.

