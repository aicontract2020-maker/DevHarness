# Research: Runtime Proof Review

Status: Verified
Date: 2026-08-31

## Problem Summary

The first external browser dogfood produced intact verification receipts and useful failure
artifacts, but the developer review surface cannot display them or associate them with the Goal Run
that authorized execution. The same run exposed missing disposable-worktree preparation and weak
failure classification.

## Relevant Files

| File | Current responsibility | Key location |
|---|---|---|
| `packages/runtime/src/data-store.mjs` | Stores and integrity-checks receipts | `verificationPaths()` and `listValidReceipts()` — lines 30-42, 91-132 |
| `packages/runtime/src/verify.mjs` | Plans and executes isolated commands and services | `createVerificationPlan()` and `executeVerificationPlan()` — lines 49-116, 437-583 |
| `packages/runtime/src/review-server.mjs` | Serves authenticated read-only review data | `createReviewApiResponder()` — lines 37-109 |
| `packages/runtime/src/supervisor-evidence.mjs` | Issues sealed evidence from passing receipts | `issueCommandTestEvidence()` — lines 37-116 |
| `apps/review-ui/lib/review-client.mjs` | Fetches fixed review endpoints | lines 23-79 |
| `apps/review-ui/app/page.tsx` | Renders declaration, alignment and scorecards | runtime refresh — lines 240-330 |
| `packages/core/src/scheduling-policy.mjs` | Computes conflict-safe execution waves | `createSchedule()` — lines 41-107 |

## Current Information Flow

1. The CLI compiles a command and service binding into a verification plan —
   `packages/runtime/src/verify.mjs:49-116`.
2. Execution creates a detached Git worktree, starts services, waits for HTTP readiness, runs the
   command and tears everything down — `packages/runtime/src/verify.mjs:437-493`.
3. A receipt and hashed stdout/stderr/service logs are stored under the repository's external data
   directory — `packages/runtime/src/verify.mjs:517-583`.
4. The data store accepts only schema-valid receipts whose artifact sizes and hashes still match —
   `packages/runtime/src/data-store.mjs:91-132`.
5. The review service exposes runs, a declaration, scorecards, interactions and capabilities, but
   no verification endpoint — `packages/runtime/src/review-server.mjs:64-105`.
6. The browser UI fetches only those existing surfaces — `apps/review-ui/app/page.tsx:276-315`.

## Key Findings

### F-1: Receipts are repository-bound but not Goal-Run-bound

The receipt schema requires repository and commit identity but has no Goal Run field —
`packages/schema/schemas/v1/verification-receipt.schema.json:7-23`. The CLI uses a Goal Run only to
authorize execution, then omits it from the plan and receipt — `packages/cli/src/cli.mjs:450-505`.

### F-2: Integrity filtering already provides the correct review trust boundary

`listValidReceipts()` ignores malformed, tampered, missing or size-mismatched artifacts —
`packages/runtime/src/data-store.mjs:91-132`. A review projection should consume this function,
not scan JSON files directly.

### F-3: New worktrees do not materialize initialized submodules

Planning blocks when the source checkout reports uninitialized submodules —
`packages/runtime/src/verify.mjs:63-66`. Execution creates a detached worktree and immediately
starts services, without a submodule preparation step — `packages/runtime/src/verify.mjs:453-467`.

### F-4: Readiness is not warmup

All readiness checks run before the verification command — `packages/runtime/src/verify.mjs:458-467`.
They prove endpoints respond, but there is no declared post-readiness phase for compiling or
caching additional application routes.

### F-5: Unexpected service exit is not a first-class outcome

Service handles record exit state — `packages/runtime/src/verify.mjs:237-277` — but final success
checks only readiness results and teardown status, not whether an owned service exited during the
command — `packages/runtime/src/verify.mjs:495-515`.

### F-6: The only sealed command driver intentionally excludes browser proof

The registered `command-test` driver accepts only `test` receipts and explicitly forbids browser,
network and database evidence — `packages/runtime/src/supervisor-evidence.mjs:13-20,54-59`.
Therefore a passing Playwright command currently cannot receive even honest E2 system-command
evidence, and must never be promoted to E3 without captured surface artifacts.

### F-7: A conservative parallel scheduling policy already exists

The scheduler treats shared workspaces, overlapping paths and shared data/schema/database resources
as conflicts — `packages/core/src/scheduling-policy.mjs:5-16`. It emits bounded waves only after
validating dependencies and integration ownership — `packages/core/src/scheduling-policy.mjs:41-107`.

## Existing Constraints

- Review APIs remain read-only, loopback-only, exact-origin and token authenticated —
  `packages/runtime/src/review-server.mjs:37-60`.
- Failed or stale receipts cannot become passing evidence — `constitution.md` and
  `packages/runtime/src/supervisor-evidence.mjs:54-59`.
- Consumer repositories remain unchanged; runtime state and preparation occur in disposable
  external worktrees — `AGENTS.md`.

## Open Questions for the Spec

None. The developer approved the four bounded outcomes in
`specs/aiedu-local-dogfood/validation.md`; direct browser/network/database observation remains a
later proof-driver increment rather than an implicit claim.

## Not Investigated

- Automatic product repair in AIedu_demo.
- Hosted review services or remote artifact URLs.
- Multi-agent worker execution; this increment uses the existing scheduler only as the safety gate.

