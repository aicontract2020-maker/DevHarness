# Plan: Repository Understanding Digest

## Goal

Add a small but high-leverage upgrade to onboarding: the developer should be able to see, at a glance, how much of the repository understanding is proved, what is merely detected, where conflicts exist, and which domains still block autonomous work.

## Implementation sketch

1. Extend the onboarding plan with a deterministic summary object derived from existing claims and coverage.
2. Update the text brief to print the summary counts, conflict hints, and prioritized domain gaps before generic warnings.
3. Keep the JSON output revision-bound and schema-valid.
4. Add regression tests for the summary values and the rendered brief ordering.

## Risks

- Adding new plan fields must not invalidate current consumers.
- The summary must be derived only from plan data already in scope.
- The text brief must stay compact and should not become another long artifact dump.

## Exit criteria

- The onboarding plan exposes a deterministic summary that a future review page can reuse.
- The brief is visibly easier to review by exception.
- Existing onboarding and schema tests remain green.
