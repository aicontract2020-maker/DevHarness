# System model and approved development strategy

## One end-to-end model

DevHarness models a feature as a dynamic chain rather than a set of files:

```text
user action
  -> frontend state and validation
  -> backend contract and authorization
  -> transaction / queue / external call
  -> database constraints and state change
  -> response and error handling
  -> refreshed user-visible state
```

The `system-model` contract records components, stores, entities, trust boundaries, roles,
permissions, flows, invariants, risks and unknowns. A successful API response cannot prove a
feature whose actual outcome depends on persistence, permissions, later events or UI state.

## Database review

Database review is first-class whenever a repository or goal touches persistent state. The
analysis must trace:

- Schema and migration order, compatibility and rollback.
- Entity ownership and every component allowed to read or write it.
- Database constraints that protect business invariants.
- Indexes justified by actual query patterns and query-plan evidence.
- Transaction boundaries, retries, idempotency and concurrency behavior.
- Seed/reset strategy and disposable test databases.
- Data classification, retention and deletion.
- Frontend-to-backend-to-database-to-UI outcome for affected flows.

A database capability pack will turn this declaration into migrations, constraint failures,
concurrency scenarios, rollback exercises and query-plan evidence. Production mutation is
never an implicit verification strategy.

## Security and dynamic relationships

Security review starts with assets and trust boundaries, then models:

- Role and permission matrices.
- Authentication and authorization at every boundary.
- State machines and valid/invalid transitions.
- Replay, race, duplication, stale state and partial-failure paths.
- Sensitive-data movement and lifetime.
- Cross-feature invariants and side effects.
- Abuse cases and recovery behavior.

Findings are classified as `goal-blocking`, `relevant`, `debt`, `unverified` or
`false-positive`. A false positive requires counter-evidence. Existing debt is not silently
folded into goal scope, but relevant or blocking risk remains visible at the approval gate.

## Design and architecture strategy baseline

After understanding the real system, DevHarness may research current official guidance and
propose a repository-wide strategy. Web research is input, not authority; the existing system,
product constraints and measured evidence remain primary.

The strategy covers:

- Frontend tokens, reusable components, interaction patterns, accessibility and content.
- Backend module boundaries, dependency direction, contracts, transactions, errors and
  observability.
- Data ownership, migration/constraint/index/concurrency rules.
- Security boundaries and enforcement.
- Testing and proof expectations.

Module-first and composition-first are defaults. Object-oriented implementation is used when
state, identity, lifecycle or polymorphism makes it the simplest model—not as a quota for
classes or abstractions.

An agent can propose a strategy or exception. Only a developer can approve the baseline or a
material replacement. Approval binds to an exact strategy hash and version. Later work must
follow the approved rules or surface a bounded exception; it cannot silently drift. Durable
architecture decisions are recorded as ADRs so independent agents apply the same choices.
