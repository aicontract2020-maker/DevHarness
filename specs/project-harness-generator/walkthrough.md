# Walkthrough: Project Harness Generator and Owned Service Lifecycle

For an engineer reviewing or maintaining this feature. Execution order, not file order.

## 1. Init proposes source declarations

`proposeProjectConfig()` — `packages/project/src/init.mjs:15`

Discovery results become accepted command candidates plus empty service declarations and verification jobs. No readiness URL is guessed.

## 2. Build preserves the preview/write boundary

`runCli()` build branch — `packages/cli/src/cli.mjs:128`

The CLI reads the accepted declaration, validates the external data root, compiles the harness, and writes only when `--write` is present.

## 3. The compiler resolves and hashes semantics

`compileProjectHarness()` — `packages/project/src/harness.mjs:52`

It rejects duplicate or wrong-kind references, validates loopback readiness, resolves exact command records, derives lifecycle and verification hashes, and reports unconfigured launch commands as blockers. Canonical key sorting makes semantic hashes independent of JSON object ordering.

## 4. Verification binds itself to the compiled harness

`createVerificationPlan()` — `packages/runtime/src/verify.mjs:49`

Existing Git, environment, submodule, timeout, and path preconditions run first. The plan then records harness/config/verification hashes and resolves the required service for the requested command.

## 5. One external worktree owns all processes

`executeVerificationPlan()` — `packages/runtime/src/verify.mjs:356`

The runtime creates a detached external worktree and starts the declared service there as a detached process group with the existing secret-safe environment allowlist. Service output goes to separate mode-0600 logs.

## 6. Readiness gates the verification command

`waitForReadiness()` — `packages/runtime/src/verify.mjs:287`

The loop polls only the prevalidated local HTTP target, has a deadline, notices early service exit, and starts the verification command only after an accepted status.

## 7. Teardown precedes proof

`stopOwnedService()` and `finally` — `packages/runtime/src/verify.mjs:327`, `packages/runtime/src/verify.mjs:393`

Every exit path sends TERM, escalates to KILL when needed, waits for process exit, checks worktree dirtiness, and removes/prunes the worktree. Command and service logs are hashed before the receipt is stored.

## 8. Doctor re-derives trust

`receiptMatchesCurrentConfig()` — `packages/project/src/doctor.mjs:17`

Readiness is upgraded only when repository, revision, full config, command, verification relationship, lifecycle, artifact integrity, readiness, and both teardown layers still match and pass.

## Not handled here

- Browser screenshots, Playwright traces, network events, and database-state evidence.
- Dynamic ports, multi-service graphs, containers, dependency installation, and remote services.
- Goal planning, agent adapters, multi-agent staffing, pull requests, merge, and deploy.

## Unrequested behavior

None. New behavior maps to the feature spec, plan, machine contracts, or ADR 0004.

