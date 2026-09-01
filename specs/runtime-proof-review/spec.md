# Runtime Proof Review

Status: Approved
Version: 1.0
Mode: Full
Last updated: 2026-08-31

## Overview

Turn isolated verification executions into compact, Goal-Run-bound review information, while
strengthening disposable-worktree preparation and lifecycle failure diagnosis.

## User Story

As a developer supervising an autonomous goal, I want one short runtime-proof panel that tells me
what actually ran, what passed, what failed, what remains unproved and whether cleanup was safe.

## Boundaries

**Always do:** validate receipt and artifact integrity; distinguish current from stale revisions;
record preparation, warmup, unexpected service exit and teardown independently.

**Ask first:** adding external dependencies; modifying a consumer repository; granting new runtime
authority; treating direct browser/network/database observation as proved.

**Never do:** expose secrets or raw environment values; trust arbitrary project-authored summaries;
turn failed, stale or partial execution into passing evidence; change AIedu_demo product code.

## Acceptance Criteria

### AC-1: Goal-bound receipt [MUST]
Given a public execution authorized by a Goal Run, when its receipt is written, then the receipt
contains that exact run id and remains bound to repository identity, revision and configuration.

### AC-2: Compact verification projection [MUST]
Given intact and tampered receipts in external storage, when review data is requested, then only
intact receipts are summarized with current/stale status, outcome reason, duration, readiness,
workspace cleanliness, evidence level and teardown; no raw environment value is returned.

### AC-3: Developer review panel [MUST]
Given live verification review data, when the developer opens the review page, then they see total
counts, the latest outcome, blocked coverage and at most five recent runs without opening logs.

### AC-4: Revision-pinned submodule preparation [MUST]
Given initialized submodules in the source revision, when a disposable verification worktree is
created, then each submodule is materialized at its recorded commit before any service starts;
failure blocks the command and is recorded.

### AC-5: Declared HTTP warmup [MUST]
Given credential-free loopback warmup URLs in a verification declaration, when services become
ready, then every warmup runs before the command, is bounded and recorded; a failed required warmup
blocks the command.

### AC-6: Unexpected service exit classification [MUST]
Given an owned service exits after readiness but before command completion, when the receipt is
finalized, then the outcome is failed with reason `service-exited`, rather than appearing as an
unexplained collection of command failures.

### AC-7: Honest system-command evidence [MUST]
Given a current passing `verify` receipt, when attestation is requested, then a sealed system-command
driver may issue E2 `test-result` evidence, while explicitly claiming no E3 browser snapshot,
network response or database-state proof.

### AC-8: Parallelism fails closed [MUST]
Given work whose dependencies or exclusive resources are missing, cyclic or conflicting, when a
parallel schedule is requested, then execution remains serial/blocked; only the existing validated
conflict-free waves may be used by a future worker executor.

### AC-E1: Missing or corrupt data [MUST]
Given corrupt receipts, missing artifacts or invalid review payloads, when the review page refreshes,
then corrupt data is omitted and the UI shows a bounded unavailable state without inventing counts.

## Non-Functional Requirements

- Review projection is deterministic for the same receipts and current revision.
- Review endpoints remain loopback, token authenticated, exact-origin and read-only.
- Review payload exposes at most 20 receipt summaries and the UI renders at most five by default.
- No framework change writes to the consumer checkout.

## Out of Scope

- Automatic fixes to consumer application failures.
- E3 direct browser/network/database evidence without a structured capture driver.
- Automatic merge or delivery.
- A multi-agent executor; AC-8 locks the safety precondition for that later component.

## Open Questions

None. The developer approved this increment on 2026-08-31.

