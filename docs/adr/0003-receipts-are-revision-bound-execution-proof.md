# ADR 0003: Receipts are revision-bound execution proof

- Status: Accepted
- Date: 2026-08-29

## Context

Repository discovery can find scripts, test frameworks, browser drivers, and launch files. Their presence does not prove that they run, target the intended application, leave the repository clean, or still apply to the current revision.

Treating detection as proof produced an unrealistically high first AIedu_demo readiness score. The result contradicted DevHarness's central rule that agent or tool claims are not completion evidence.

## Decision

Build, test, verification, and lifecycle capabilities move from `warn` to `pass` only when DevHarness can load an intact verification receipt that:

- Matches the repository identity and exact current commit.
- Matches a command in the approved project configuration, including its hash.
- Was executed in an external isolated Git worktree.
- Started and ended with no non-ignored workspace changes.
- Passed with the expected exit result.
- Preserved checksummed stdout and stderr artifacts.
- Completed required teardown.
- Satisfies the versioned receipt schema.

Artifact files are re-hashed when receipts are loaded. Missing, modified, malformed, stale, or config-mismatched receipts are ignored.

## Execution authority

`devharness verify` is a dry run by default. Execution requires all of:

1. A command already present in the reviewed `devharness.yaml`.
2. A Goal Run bound to the same repository and revision.
3. Current signed approval for every capability required by the compiled command (process execution always; browser and container authority when applicable).
4. An explicit `--execute` flag.

Raw commands supplied through CLI arguments are not accepted.

Direct execution of `launch` commands is blocked until a lifecycle driver can prove readiness, process ownership, and teardown. A process starting successfully is not service verification.

## Environment boundary

The child process receives only a small operating-system allowlist plus environment keys declared by the project's redacted examples. Unrelated host secrets are not inherited. Receipts store key names and set/unset state, never values.

Runtime data, worktrees, logs, and receipts must live outside the consumer repository.

## Consequences

- Doctor scores remain conservative until commands actually run.
- Any new commit invalidates old proof automatically.
- Re-running doctor can detect artifact tampering without an agent judgment.
- Verification can fail honestly while still producing useful logs and a cleanup verdict.
- Service lifecycle verification requires a separate driver rather than reusing the short-lived command runner.
