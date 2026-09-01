# Executable Review Scorecard

Status: Approved for implementation
Version: 1.0
Mode: Full
Last updated: 2026-08-31

## Overview

Turn trusted goal-run facts into one deterministic, portable review result that can be shown
by the CLI and developer review page without duplicating scoring or hiding blockers.

## Boundaries

**Always do:** preserve the core delivery-readiness verdict; show all failed hard gates;
bind results to run, repository, revision, scope, and harness version.

**Never do:** let the UI authorize delivery; treat a score as proof; accept caller-authored
evidence as trusted; silently omit unknown, failed, blocked, or not-applicable items.

## Acceptance Criteria

### AC-1: Portable scorecard [MUST]

Given a goal-run evaluation, when DevHarness creates a review scorecard, then the result
validates against a versioned schema containing identity, verdict, dimensions, hard gates,
exceptions, acceptance rows, evidence-level counts, and drill-down references.

### AC-2: Deterministic proof coverage [MUST]

Given the same ordered or unordered evaluation facts, when the scorecard is calculated twice,
then both results contain the same verdict, counts, and weighted score.

### AC-3: Hard gates dominate [MUST]

Given otherwise high proof coverage and one failed hard gate, when the scorecard is created,
then its verdict is not ready and the failure remains visible.

### AC-4: Trusted evidence only [MUST]

Given caller-authored or stale evidence, when verification coverage is calculated, then that
evidence cannot prove a criterion or produce a ready verdict.

### AC-5: Contract-driven review UI [MUST]

Given a valid scorecard document, when the developer opens the review page, then the verdict,
score, dimensions, blockers, acceptance rows, trace, proof, replay recipe, and significant
changes are rendered from that document rather than duplicated UI constants.

### AC-6: Honest sample state [MUST]

Given no live goal-run source is connected, when the page displays a bundled scorecard, then
it identifies the data as a contract fixture and cannot be mistaken for an approvable run.

## Out of Scope

- Approving delivery from the web page.
- Starting remote replay jobs.
- A hosted database or real-time event transport.
- Resolving the existing Supervisor isolation blocker.

