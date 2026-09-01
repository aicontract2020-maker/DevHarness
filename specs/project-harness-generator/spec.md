# Project Harness Generator and Owned Service Lifecycle

Status: Review Ready
Version: 1.0
Mode: Full
Last updated: 2026-08-29

## Overview

A developer can compile an accepted project declaration into a deterministic, revision-bound harness and use it to verify behavior that depends on long-running local services without leaving processes or files behind.

## User Stories

As a developer, I want DevHarness to explain exactly how it will operate my repository before anything runs so that I can trust its execution boundary.

As an autonomous goal runtime, I want a verified project lifecycle so that later agents can prove behavior instead of merely reporting that code appears complete.

## Boundaries

**Always do:**

- Bind generated harnesses and receipts to the exact accepted declaration and Git revision.
- Keep generated harnesses, worktrees, logs, and receipts outside the consumer repository.
- Own and tear down every service process started by the runtime.
- Report unresolved lifecycle facts as blockers rather than inventing values.

**Ask first:**

- Writing the proposed declaration into a consumer repository.
- Adding new dependencies or executing dependency installation.
- Probing any network target other than the local machine.

**Never do:**

- Run a discovered but unaccepted command.
- Infer a health endpoint and treat the inference as verified truth.
- Preserve a service after the verification run ends.
- Store secret values in a plan, manifest, receipt, or log metadata.

## Acceptance Criteria

### AC-1: Deterministic harness preview [MUST]

Given a clean committed repository and a valid accepted declaration
When the developer previews the project harness twice at the same revision
Then both previews have the same harness identifier and content and neither changes the consumer repository or external runtime state.

### AC-2: Explicit external harness write [MUST]

Given a valid harness preview
When the developer explicitly authorizes writing it
Then one contract-valid manifest is atomically stored outside the consumer repository with declaration and revision hashes, and the consumer repository remains unchanged.

### AC-3: Honest lifecycle blockers [MUST]

Given a repository with long-running application commands but no accepted readiness declaration
When the harness is compiled
Then the manifest identifies service lifecycle as blocking and lists the exact missing declaration without inventing a URL or port.

### AC-4: Owned service verification [MUST]

Given an accepted verification relationship that requires a local service
When verification is explicitly executed
Then the runtime starts only the declared service, waits for its declared readiness result, runs the declared verification command only after readiness, and records both command and service evidence.

### AC-5: Guaranteed bounded teardown [MUST]

Given any started service, including a verification failure or timeout
When the run terminates
Then the runtime sends a bounded graceful termination, escalates if necessary, verifies process exit, removes the isolated worktree, and reports teardown failure as a failed result.

### AC-6: Current lifecycle proof upgrades readiness [MUST]

Given a passing intact receipt for the current revision and exact accepted lifecycle declaration
When readiness is evaluated
Then service launch passes; changing the revision, declaration, evidence, or teardown result removes that proof.

### AC-E1: Invalid references are rejected [MUST]

Given a declaration whose lifecycle references an unknown, non-launch, or non-verification command
When configuration or harness compilation is attempted
Then it fails before writing a manifest or starting a process and names the invalid reference.

### AC-E2: Readiness failure blocks verification [MUST]

Given a declared service that exits early or does not become ready within its declared timeout
When verification is executed
Then the verification command is not started, service logs are retained as hashed evidence, teardown is attempted, and the receipt is blocked or failed rather than passed.

### AC-E3: Unsafe readiness targets are rejected [MUST]

Given a readiness target that is non-loopback or contains credentials, a query, or a fragment
When the harness is compiled or verification is planned
Then it is rejected before network access or process startup.

### AC-7: Rich browser evidence [WONT]

This iteration will not capture screenshots, browser traces, network events, or database state. It establishes the lifecycle and evidence-integrity foundation those collectors require.

## Out of Scope

- Modifying any consumer repository during framework validation.
- Inferring or installing dependencies.
- Docker Compose ownership and cleanup.
- Multiple concurrent services or dynamic port allocation in one verification job.
- Automatic merge, deployment, or PR creation.

## Open Questions

- [RESOLVED] Health endpoint inference → The compiler reports a blocker; only an explicit accepted target may be trusted.
- [RESOLVED] Lifecycle command surface → A verification job declares its required service, and `verify` activates it automatically.
- [RESOLVED] Network scope → v0 readiness supports credential-free loopback HTTP only.

## Non-Functional Requirements

- Determinism: identical revision and declaration inputs produce byte-equivalent semantic manifests and the same SHA-256-derived ID.
- Safety: dry-run commands perform zero filesystem writes and zero process/network activity.
- Timeout: readiness is bounded between 1 second and 10 minutes; shutdown grace is bounded between 100 ms and 30 seconds.
- Privacy: environment values never appear in structured output; child processes receive only the existing allowlist plus declared keys.
