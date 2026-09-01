# Runtime contracts

DevHarness gives agents freedom inside deterministic boundaries. Agents may propose requirements, plans, teams, tasks, evidence, findings, and transitions. The runtime validates those proposals against versioned contracts before they affect run state.

## v1 schemas

The first contracts live in `packages/schema/schemas/v1/`:

| Contract | Responsibility |
| --- | --- |
| `goal-run` | Current goal, repository identity, state, gates, budgets, and revision |
| `interaction-packet` | Alignment, exception, progress, or delivery read model with attention, actions, compression, and source traceability |
| `acceptance-criterion` | Falsifiable claim, proof recipe, evidence requirements, and verdict |
| `task-contract` | Agent assignment, dependencies, allowed scope, outputs, and criteria |
| `evidence-record` | Revision-bound observation and checksummed artifacts |
| `approval-receipt` | Separate human-gate decision bound to repository revision and canonical artifact hash |
| `review-finding` | Review claim, severity, lifecycle, and resolution |
| `review-verdict` | Independent current-head review outcome |
| `run-event` | Append-only event used to reconstruct and audit a run |
| `project-config` | Accepted commands, lifecycle declarations, gates, and delivery policy |
| `project-harness` | Deterministic compiled commands, services, verification jobs, hashes, and blockers |
| `verification-receipt` | Current-revision command and service lifecycle result, artifacts, and teardown |
| `onboarding-plan` | Read-only Claim Ledger, domain coverage, limitations, blockers, capability requests, and one next action |
| `capability-request` | Bounded operation, target, scope, risk, authority and human decision without secret values |
| `repository-understanding-baseline` | Revision-bound understanding claims, conflicts, system-model coverage and approved-strategy reference |
| `system-model` | Components, data stores/entities, trust boundaries, roles, flows, invariants, risks and unknowns |
| `design-strategy` | Human-approved frontend/backend/data/security/testing consistency rules and exceptions |
| `verification-policy` | Unit-to-postdeploy proof ladder, real drivers, independence and numeric thresholds |
| `execution-plan` | Dependency DAG, critical-path inputs, resource locks, workspaces, integration owner and progress policy |
| `task-progress` | Observable long-task step/count/blocker heartbeat used to derive a no-action Progress Pulse |

Every contract:

- Has `schema_version: 1`.
- Rejects undeclared fields unless explicitly designed as extensible data.
- Uses stable identifiers rather than display names as references.
- Records actors as human, agent, tool, or runtime.
- Binds proof and review to an exact Git commit when code is involved.

## Deterministic schema validation

`packages/schema/src/validator.mjs` is a zero-dependency validator for the JSON Schema subset currently used by the v1 contracts. It supports external and local references, strict object fields, required properties, types, enums, constants, patterns, formats, array constraints, and numeric bounds.

The schema documents themselves use JSON Schema 2020-12 and remain compatible with full validators. The built-in validator is intentionally narrow: adding a schema keyword requires a failing contract test and validator support before that keyword can govern runtime behavior.

## State authority

`packages/core/src/state-machine.mjs` is the authority for phase transitions. Agent prose cannot skip phases or approve gates.

Notable rules:

- Scope approval is required before planning begins.
- Failed verification or blocking review returns work to repair.
- Delivery readiness must pass before Gate 2 can be requested.
- Developer delivery approval is required before completion.
- Completed, blocked, and cancelled runs are terminal.
- Active runs may always stop honestly as blocked or cancelled.

## Event authority

`packages/core/src/event-stream.mjs` validates the append-only audit stream:

- The first event creates the run.
- Sequence numbers are contiguous and start at one.
- Event identifiers are unique.
- A stream cannot mix run identifiers.
- Event timestamps cannot move backward.

Status and interaction views are derived projections over these events and referenced artifacts. They must not become a second writable source of truth. Packet publication and developer attention are recorded explicitly so every CLI or dashboard presents the same decision surface.

`packages/core/src/interaction-policy.mjs` validates semantics that JSON shape alone cannot prove: traceability completeness, honest compression counts, blocking verdicts, gate attention, Decision Queue behavior, Progress Pulse no-action behavior, and a single recommended next action.

A blocked or action-required Alignment Brief may request missing evidence without exposing an approve
action. A `ready` Alignment Brief must request explicit gate approval. This keeps early static
discovery visible without turning detection into authorization.

Additional policy modules enforce repository-understanding coverage and live proof,
feature/release verification depth, and dependency/resource-safe scheduling waves. Schema
shape alone never proves that references exist, a graph is acyclic, a strategy was approved by
a developer, or an evidence set is sufficient.

## Delivery-readiness authority

`packages/core/src/delivery-readiness.mjs` computes whether the runtime may ask for Gate 2 approval. It rejects delivery when:

- Gate 1 has not been approved.
- A blocking criterion has not passed.
- Passing criteria lack evidence.
- Evidence refers to a prior commit.
- Required evidence types are missing.

Repository-understanding policies are reached through
`packages/project/src/understanding.mjs`. That boundary performs live discovery, derives required
coverage and validates contracts. The supervisor-owned evidence/approval issuer is not yet
implemented, so the trusted context currently contains neither and fails closed. Direct caller
arrays, paths and roots cannot produce a ready verdict.
- An independent criterion was verified only by its implementer.
- No independent passing review exists for the current commit.
- A blocking review finding remains open.
- An agent attempts to accept blocking risk on the developer's behalf.

This verdict is deterministic and returns structured reason codes suitable for CLI progress output and repair scheduling.

## Contract evolution

Contract changes follow these rules:

1. Add a fixture showing the desired valid shape.
2. Add at least one invalid fixture for the boundary being introduced.
3. Update deterministic validators before runtime code relies on the field.
4. Preserve v1 compatibility or introduce a new schema version and migration.
5. Record a design decision for changes to authority, trust boundaries, or completion semantics.
