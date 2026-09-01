# Contract: Lifecycle Verification

## Ordered flow

1. Validate revision, declaration, environment, data-root, and lifecycle target.
2. Create a detached worktree outside the consumer repository.
3. Start the declared service as a runtime-owned detached process group.
4. Capture service stdout and stderr into mode-0600 files.
5. Poll the declared loopback HTTP target until an accepted status or timeout.
6. Start the verification command only after readiness passes.
7. Capture verification stdout and stderr.
8. Stop the service in reverse ownership order using TERM and bounded KILL escalation.
9. Confirm process exit, inspect worktree dirtiness, remove/prune the worktree, hash artifacts, and write the receipt.

## Receipt rules

- The receipt contains the exact resolved service command and readiness declaration hash.
- Service readiness and teardown have independent status and timestamps.
- Service and verification logs are global hashed artifacts with an explicit subject ID.
- Overall pass requires readiness pass, verification exit 0 without timeout, clean worktree, service teardown pass, and worktree teardown pass.
- A readiness failure never starts the verification command.
- A teardown failure can never produce an overall pass.

## Safety rules

- Child environments use only the OS allowlist plus keys declared by the repository.
- URL parsing and loopback enforcement occur before process or network activity.
- Every wait and termination path has a numeric upper bound.
- Exceptions still enter teardown and produce a blocked or failed receipt when evidence storage is available.

