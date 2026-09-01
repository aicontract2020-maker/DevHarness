# Quantitative review scorecard

Status: Executable v1 contract, deterministic projection, durable storage and live local review

## Purpose

DevHarness produces detailed research, specifications, plans, tasks, logs, tests, evidence,
and reviews. A developer should not have to read all of them to decide whether an agent
understood a goal and delivered it correctly.

The Review Scorecard turns those artifacts into a bounded, reproducible assessment. It
measures **proof coverage**, not how persuasive an agent's explanation sounds. The score is
never allowed to override a blocking failure.

This document is the reusable standard for future DevHarness evaluations. The copyable
worksheet is in [`docs/templates/review-assessment.md`](templates/review-assessment.md).

## Evaluation unit

Every assessment is bound to all of the following:

- Goal run ID.
- Repository identity and Git revision.
- Approved scope or acceptance-set hash.
- Project-harness version.
- Evaluation timestamp.

Evidence from another revision, run, or approved scope is stale unless the Supervisor can
prove that it is still applicable. A score without these bindings is invalid.

## Verdict before score

The result has two independent fields:

1. **Verdict:** `ready`, `not-ready`, or `blocked`.
2. **Proof coverage:** a number from 0 to 100, with visible numerators and denominators.

The verdict is decided first. A run with 96/100 proof coverage can still be `not-ready`.
There is no minimum score that can compensate for a hard-gate failure.

### Hard gates

Any applicable item below makes the verdict `not-ready` or `blocked`:

- One or more `[MUST]` acceptance criteria are not proved as `PASS`.
- One or more unresolved critical unknowns, requirement conflicts, or scope conflicts remain.
- Evidence is stale, mutable, self-issued by the worker being evaluated, or not bound to the
  evaluated revision and acceptance set.
- A security, authorization, privacy, destructive-action, or data-integrity finding remains
  open at blocking severity.
- A user-visible feature was not exercised through its real surface, such as a browser,
  simulator, desktop application, or CLI terminal.
- A database-changing flow was not verified through both the application path and the
  resulting persisted state.
- Behavior-critical implementation and final verification were not independently evaluated.
- Required deployment, migration, automation, rollback, load, or canary behavior was not
  tested at the evidence level required by the approved scope.
- The developer has not approved the exact current scope at Gate 1 or the exact current
  delivery at Gate 2.
- The Supervisor trust boundary required for the claimed verdict has not been established.

Items that are not applicable must include a short reason. They cannot be silently omitted.

## Evidence levels

Every proof claim receives exactly one evidence level. Higher levels include the lower-level
checks needed to interpret the result, but do not automatically prove unrelated claims.

| Level | Name | What exists | Suitable use |
|---|---|---|---|
| E0 | Claim | Agent statement, plan, or unchecked prose only | Never sufficient for completion |
| E1 | Inspected | Cited source, configuration, schema, or documentation was checked | Repository understanding and design constraints |
| E2 | Executed | Automated unit, component, contract, or integration test ran with a revision-bound result | Isolated logic and interfaces |
| E3 | Behavior observed | Real user surface was exercised and the expected API, database, filesystem, queue, or device side effect was observed | Feature acceptance and end-to-end flows |
| E4 | System proved | Production-like deployment, migration, automation, rollback, load, resilience, or canary behavior ran successfully | Release and operational claims |

Minimum defaults:

- Repository facts and architecture claims: E1.
- Changed testable modules: E2.
- User-visible `[MUST]` behavior: E3.
- Database mutation claims: E3, including persisted-state inspection.
- Release-readiness claims: E4 when deployment, migration, load, or recovery is in scope.

An acceptance criterion fails proof sufficiency when its evidence level is below its declared
minimum, even if a lower-level test passed.

## Traceability model

Completeness is evaluated by tracing every approved requirement forward and every delivered
change backward:

```text
goal requirement
  -> acceptance criterion
      -> proof recipe and required evidence level
      -> implementation task
          -> changed code or configuration
          -> test and observed evidence
          -> independent review finding or verdict
```

The matrix must also detect reverse orphans:

- A task without an acceptance criterion.
- Changed production behavior without an approved requirement or design decision.
- A test or evidence record that proves no acceptance criterion.
- An acceptance criterion with no task, implementation, or adequate proof.

## Proof-coverage score

The score has five independently visible dimensions. Each dimension is computed from counts,
not an agent's confidence estimate.

| Dimension | Weight | Numerator | Denominator |
|---|---:|---|---|
| Acceptance definition | 20 | Approved requirements with concrete, falsifiable acceptance criteria and declared proof methods | All approved requirements |
| System understanding | 20 | In-scope critical flows mapped and confirmed at E1 or higher | All in-scope critical flows identified from the goal, repository, platform pack, and risk baseline |
| Delivery traceability | 20 | `[MUST]` criteria with complete requirement → task → change → test/evidence links, with no reverse orphan | All `[MUST]` criteria |
| Verification sufficiency | 30 | `[MUST]` criteria proved at or above their required evidence level | All `[MUST]` criteria |
| Independent review and closure | 10 | Applicable independent checks completed and blocking findings closed with evidence | All applicable checks and blocking findings |

For each dimension:

```text
dimension score = weight × proved items / applicable items
proof coverage = sum of the five dimension scores
```

Rules:

- Always show `proved/applicable` beside the weighted score.
- An empty denominator is `N/A`, not 100%; the reason must be visible.
- Unknown applicability is a gap and stays in the denominator.
- Partial credit is count-based only. Do not award subjective fractions to one item.
- Duplicate evidence may support multiple criteria only when the evidence explicitly exercises
  every criterion; shared links alone are insufficient.
- A score is reproducible only when another evaluator can recompute it from referenced,
  revision-bound artifacts.

## Critical-flow coverage

A critical flow is more than an endpoint. For every in-scope user or system outcome, the
assessment checks the applicable parts of this chain:

```text
user or external trigger
  -> frontend or public interface
  -> authentication and authorization
  -> backend orchestration and business rules
  -> database, queue, filesystem, or external service
  -> returned result and visible state
  -> failure, recovery, retry, and concurrency behavior
  -> observability and operational response
```

A flow is counted as understood only when its entry point, data movement, ownership boundary,
state changes, and principal failure/recovery paths are cited. A flow is counted as behaviorally
proved only when the real surface and its consequential side effects were observed.

The completeness denominator is not chosen by the implementing agent alone. It is derived
from the approved goal, repository discovery, detected platform pack, database and security
baselines, and release policy. Missing documentation or conflicting documentation becomes an
explicit unknown or conflict; it does not shrink the denominator.

## Required exception counts

Every scorecard reports these counts even when each is zero:

- Blocking failures.
- Failed, blocked, pending, and not-applicable `[MUST]` criteria.
- Unresolved unknowns and conflicts.
- Unmapped requirements.
- Orphan tasks and orphan changed behavior.
- Evidence below its required level.
- Stale or invalid evidence records.
- Open security and data-integrity findings.
- Repository-discoverable questions unnecessarily asked of the developer.
- Scope changes discovered after Gate 1.

Zero must be written as `0`; absence of a row is not evidence of zero.

## Developer review surface

The default review must fit on one screen and contain:

1. Verdict and proof coverage.
2. Hard-gate result and blocking count.
3. The five dimension scores with numerators and denominators.
4. Acceptance status counts.
5. Evidence-level distribution.
6. Only red and yellow exceptions, ordered by impact.
7. The exact decision requested from the developer.
8. Links to the trace matrix, evidence, changed behavior, and replay commands.

The developer should be able to review by exception. Detailed prose remains available for
audit, but a normal approval must not require reading every generated file.

For any important claim, the review surface must support four drill-down actions:

- **Trace:** show requirement → criterion → task → change → proof.
- **Proof:** open the immutable evidence and execution metadata.
- **Replay:** rerun the proof recipe in an isolated environment.
- **Changes:** show only behaviorally significant code, schema, configuration, and automation
  changes linked to that claim.

## Suggested command surface

These commands describe the intended product behavior; they are not all implemented yet.

```text
devharness review summary
devharness review gaps
devharness review trace [AC-ID]
devharness review proof [AC-ID]
devharness review replay [AC-ID]
devharness review changes [AC-ID]
```

The v1 schema lives at `packages/schema/schemas/v1/review-scorecard.schema.json`; the
deterministic projection lives at `packages/core/src/review-scorecard.mjs`. Goal Run storage keeps
the current scorecard outside the consumer repository, and the local review API returns only
schema-valid current-run documents. The developer review page consumes this live contract when
connected and falls back to `apps/review-ui/data/review-scorecard.json` as an explicit sample.

For evaluations that do not yet have runtime integration, use
[`docs/templates/review-assessment.md`](templates/review-assessment.md) and fill every value
from cited artifacts or observed evidence. Do not infer missing values from conversation
history.

## Product acceptance criteria for an executable scorecard

The future implementation is acceptable only when:

- Two independent evaluators produce the same verdict and dimension counts from the same
  immutable run artifacts.
- Adding an unproved `[MUST]` criterion lowers the correct dimensions and blocks readiness.
- Removing a requirement from the matrix without an approved scope change is reported as an
  unmapped requirement, not treated as improved coverage.
- A stale revision, tampered artifact, worker-self-issued proof, or lower-than-required
  evidence level cannot produce `ready`.
- A hard-gate failure remains visible even when proof coverage is otherwise high.
- Every displayed count drills down to the exact included records.
- The one-screen summary never hides failed, blocked, unknown, conflicted, or not-applicable
  items.
