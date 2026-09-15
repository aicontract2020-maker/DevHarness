# Specification: Execution Graph Surface

Status: Review Ready
Version: 1.0
Mode: Delta
Baseline: `../executable-system-onboarding/spec.md`
Last updated: 2026-09-02

## Outcome

DevHarness surfaces the existing execution graph as a compact, reviewable plan so a developer can
see the next ready task, integration owner, critical path, resource claims, and blocked reasons
without opening raw task artifacts. The slice does not dispatch agents or perform task execution; it
makes the planned work legible enough to trust the next autonomy step.

## Boundaries

**Always do:** derive every displayed graph fact from the current repository revision and the stored
goal/onboarding artifacts; keep the consumer repository unchanged; show blocked reasons when the
schedule is invalid; keep the review surface compact and traceable.

**Never do:** dispatch or run agent tasks; mutate the consumer repository; invent missing nodes,
dependencies, or resources; imply readiness when the graph is invalid; hide critical-path or lock
conflicts behind summary compression.

## Acceptance criteria

### AC-1: Existing execution-graph safety remains intact [UNCHANGED][MUST]

Given an execution plan with dependencies and resource locks, when the scheduling policy validates
it, then dependency satisfaction, resource conflict rejection, integration-owner coverage, and
critical-path derivation continue to work exactly as before.

### AC-2: Compact execution-graph summary is surfaced [ADDED][MUST]

Given a valid goal onboarding or live-alignment bundle, when DevHarness renders the developer-facing
summary, then it includes a compact execution-graph summary with node count, max parallelism,
integration owner, critical path, and the next ready wave or the reasons the graph is blocked.

### AC-3: Per-node task graph details are reviewable [ADDED][MUST]

Given a populated execution graph, when the live alignment packet is compiled, then the packet
includes an `Execution graph` section with one summary item and node items that show each task's
dependencies, resource claims, and readiness state.

### AC-4: Invalid graphs remain honest [ADDED][MUST]

Given a graph that is invalid because of a missing dependency, duplicate task, unsafe resource, or
integration-owner barrier failure, when the brief is compiled, then the blocked reasons are shown
and no next-task claim is implied.

### AC-5: Review surface is legible without raw artifacts [ADDED][SHOULD]

Given the review UI, when a developer opens the current run, then the execution graph is visible in
the same compact packet surface as the other goal summaries and can be read without opening raw
stored artifacts.

### AC-6: Consumer isolation remains intact [ADDED][MUST]

Given a goal run or live-alignment review, when the developer compares the consumer repository
before and after reading the execution graph, then the repository contents remain unchanged and no
task dispatch occurs.

## Non-functional requirements

- The execution graph summary must remain bounded and reviewable: one summary item plus per-node
  items, capped to the existing execution-plan limits.
- The graph surface must remain revision-bound and stored outside the consumer repository.
- Invalid graphs must fail closed, not degrade into optimistic language.

## Out of scope

- Actually executing tasks or dispatching agents.
- Introducing a second agent adapter or adapter-agnostic execution runtime.
- Repair-loop automation after verification failures.
- PR creation, merge, or deployment automation.

## Open questions

None.
