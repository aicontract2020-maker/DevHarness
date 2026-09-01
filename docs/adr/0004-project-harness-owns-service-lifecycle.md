# ADR 0004: The project harness owns explicit local service lifecycle

- Status: accepted
- Date: 2026-08-29

## Context

Short-lived command receipts can prove builds and tests, but web and API behavior usually requires a long-running service. Discovery can find launch commands but cannot safely know readiness routes, ports, credentials, or cleanup semantics. Treating process creation or a fixed delay as readiness would turn activity into false proof.

## Decision

The accepted project declaration explicitly maps a launch command to a local service lifecycle and maps a verification command to the service it requires. The compiled project harness resolves and hashes those relationships for an exact Git revision.

The v0 runtime:

- Supports at most one required service per verification job.
- Allows credential-free loopback HTTP readiness only.
- Starts the service inside the verification worktree as an owned process group.
- Probes every declared HTTP readiness target concurrently and gates verification on all of them.
- Captures service logs as hashed artifacts.
- Sends bounded TERM/KILL signals, runs an optional bounded explicit cleanup command, and waits for both before removing the worktree.
- Requires readiness, command, clean workspace, service teardown, and worktree teardown to pass.

## Consequences

Lifecycle facts that cannot be discovered safely appear as compiler blockers and require developer acceptance in `devharness.yaml`. This creates some onboarding work, but it prevents guessed endpoints and leaked services from becoming trusted automation.

The first implementation can supervise a reviewed container stack through its launch and cleanup commands, but it does not natively allocate ports, start multiple independent lifecycles, or collect browser/database evidence. Those mechanisms can extend the compiled contract without weakening its authority boundary.
