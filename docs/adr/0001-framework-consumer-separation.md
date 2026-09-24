# ADR 0001: Keep framework and consumer repositories separate

- Status: Accepted
- Date: 2026-08-28

## Context

DevHarness will be developed using real repositories, beginning with example-consumer. Putting framework implementation inside the consumer would make early experimentation convenient but would blur ownership, encourage project-specific assumptions, and make extraction into a reusable open-source framework harder.

## Decision

DevHarness and every consumer application remain separate repositories and sibling directories during local development.

Framework-owned code includes:

- Goal runtime and orchestration.
- Schemas and policies.
- Agent, research, and VCS adapters.
- Platform packs and generic evidence collectors.
- Project-harness generator and templates.

Consumer-owned code includes:

- A minimal declarative `devharness.yaml`.
- Existing project build and test configuration.
- Application tests that are valuable independently of DevHarness.
- Explicit testability surfaces that belong to the application.

Run state, generated adapters, worktrees, and evidence live outside the consumer repository by default.

## Consequences

Benefits:

- The framework can be released independently.
- Consumer-specific logic is visible and reviewable.
- A clean clone accurately tests onboarding.
- Additional consumers can falsify assumptions early.

Costs:

- Local development requires explicit consumer paths.
- Cross-repository changes cannot be committed atomically.
- Compatibility must be expressed through versioned contracts.

These costs are desirable pressure toward a real public interface.

