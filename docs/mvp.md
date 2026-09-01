# MVP plan

## MVP outcome

A developer can install DevHarness in an existing supported repository, submit a bounded feature or bug-fix goal, approve the scope, observe autonomous execution, and receive a pull request with criterion-level verification evidence.

The first release optimizes for one trustworthy end-to-end run, not breadth of agents, platforms, or workflows.

## Implementation approach

Use a local runtime with plugin interfaces. Incorporate configuration compilation from a skills/compiler approach, but do not make generated skills the product. Preserve boundaries that allow a future remote daemon without building the hosted system in v0.

## Milestone 0: contracts before orchestration

Status: in progress. The first v1 schemas, deterministic schema validator, goal state machine, event-stream validator, and delivery-readiness predicate are implemented with contract tests.

Deliverables:

- Versioned `devharness.yaml` schema.
- Goal, interaction packet, acceptance criterion, task, evidence, finding, and event schemas.
- State-transition rules and terminal verdict rules.
- External data-directory and repository-identity rules.
- A fixture-based contract test suite.

Exit criterion: a recorded goal run can be validated without invoking a model.

## Milestone 1: repository readiness

Status: in progress. `onboard`, `init`, `doctor`, project-harness compilation, and isolated command/service verification are implemented. Onboarding emits a revision-bound understanding plan with explicit domain coverage and capability requests. Contracts and deterministic policies now define system/database/security understanding, approved design strategy, the proof ladder, resource-aware task graphs and safe parallel waves. Dependency bootstrap and the live browser/simulator/database/deployment/load/canary drivers remain.

Commands:

```text
devharness onboard
devharness init
devharness doctor
devharness build
devharness verify
```

Capabilities:

- Repository discovery.
- Claim Ledger and compact Repository Understanding Brief.
- Database, security, design-strategy, verification and execution-plan contracts.
- Safe dependency/resource scheduling plan (without worker dispatch).
- Platform detection.
- Environment and dependency checks.
- Project-harness generation.
- Launch, health, verification, evidence capture, and teardown.
- Honest readiness verdicts with remediation actions.

Exit criterion: a clean consumer clone can be made verifiable without undocumented manual archaeology.

The exit criterion is not yet met: the current onboarding command exposes the missing live
proof instead of installing and executing the required drivers.

## Milestone 2: single-agent goal runtime

Status: started. Goal intake, event-backed external storage, compact status, blocked initial
scorecards, an authenticated read-only local review connection, the first static understanding
checkpoint and signed capability authorization are executable. `advance` records revision-bound
discovery and a traceable non-approvable Alignment Brief, then stops honestly in `clarifying`.
`request-capability` derives an exact bounded subject from the current checkpoint; the review page
shows its live status and the foreground TTY records the immutable decision. Live evidence
collection, product clarification, research, requirements, agent invocation and later governed
transitions remain.

Commands:

```text
devharness goal
devharness advance
devharness status
devharness request-capability
devharness approve
devharness resume
devharness cancel
```

Capabilities:

- Durable state machine.
- Clarification and cited research.
- Requirements, design, non-goals, and acceptance generation.
- Traceable Alignment Brief and Gate 1 understanding-and-acceptance approval.
- Decision Queue with at most three material exceptions per packet.
- Progress Pulse derived from durable state and artifacts.
- Planning and isolated implementation.
- Criterion-level verification and bounded repair.
- Independent review invocation.
- Traceable Delivery Brief and Gate 2.

Exit criterion: one goal survives process interruption, resumes to the same governed outcome, and can be controlled through the two default gates plus material exceptions without requiring the developer to read raw agent artifacts.

## Milestone 3: dynamic team coordination

Capabilities:

- Capability-based role selection.
- Task graph and ownership contracts.
- Safe parallelism analysis.
- Multiple isolated task workspaces.
- Integration sequencing and conflict recovery.
- Independent implementer, verifier, and reviewer identities.

Exit criterion: a multi-part feature is completed faster through safe coordination than serial execution, without weakening verification.

## Milestone 4: agent and project portability

Capabilities:

- Second agent adapter passes the same runtime contract tests.
- Second structurally different consumer passes readiness and goal workflows.
- Adapter and pack compatibility matrix.
- GitHub pull-request and CI feedback loop.

Exit criterion: neither the runtime nor artifact contracts contain assumptions specific to the first agent or AIedu_demo.

## First dogfood consumer: AIedu_demo

AIedu_demo is intentionally external to this repository. It exercises a realistic web stack with frontend, backend, PostgreSQL, authentication, browser automation, and API behavior.

The first golden goal should target a bounded flow that does not require nondeterministic model output. A note-creation persistence flow is a useful harness-validation scenario because it can prove:

- Seeded authentication.
- Browser interaction.
- Frontend/backend integration.
- Network behavior.
- PostgreSQL persistence.
- Reload behavior.
- Evidence capture and cleanup.

This is a consumer acceptance test, not code embedded in the DevHarness core.

## Second consumer

Add a small CLI or API repository before expanding the web pack. Its purpose is architectural falsification:

- No browser dependency.
- Different launch and proof mechanisms.
- Fast deterministic test loop.
- Easy use in framework CI.

## Explicitly deferred

- Automatic merge and deployment.
- Hosted dashboard and multi-tenant control plane.
- Long-lived cloud agents.
- Mobile and desktop platform packs.
- Marketplace and third-party pack distribution.
- Cost optimization beyond basic budgets and limits.

## MVP risks

### Overfitting the first consumer

Mitigation: keep consumer-specific declarations outside core and add the second consumer before calling the API stable.

### Building an elaborate scheduler before proof works

Mitigation: finish readiness and verification before multi-agent parallelism.

### Confusing activity with reliability

Mitigation: progress is derived from state and artifacts; completion is derived from acceptance evidence.

### Drowning the developer in artifacts

Mitigation: keep detailed artifacts as runtime memory and audit evidence, while the default interface exposes only Alignment Brief, Decision Queue, Progress Pulse, and Delivery Brief packets with complete traceability.

### Unbounded repair loops

Mitigation: every loop has attempt, time, cost, and scope budgets with a terminal blocked verdict.

### Agent-specific leakage

Mitigation: contract tests exercise adapters against the same task and result schemas.
