# DevHarness Autonomy Roadmap

Last updated: 2026-09-01

This document records the long-term plan for evolving DevHarness from a trusted
environment and verification layer into a framework that can let an agent take a
goal, understand a repository, plan work, execute safely, verify with evidence,
and keep a developer informed without forcing them to inspect every generated
artifact.

It is intentionally aligned with the project constitution and the existing
spec/plan artifacts in `specs/`.

## Current state

We already have the foundation for a trustworthy framework:

- repository identity and revision-bound evidence
- external state separated from the consumer repo
- approval and capability tracking
- onboarding and understanding briefs
- project declaration and verification scorecards
- owned service startup and teardown for proof runs
- support for local external config and approval state

That means DevHarness is no longer just an idea. The remaining work is mostly
about turning those parts into a coherent operating system for agentic
development.

## The target

The goal is not “an agent that edits code.”

The goal is:

- an agent can receive a goal,
- clarify missing requirements,
- understand the repository deeply enough to plan responsibly,
- split work into a sensible task graph,
- execute with bounded authority,
- verify with real evidence,
- surface risks and conflicts early,
- and keep the developer in a reviewable, low-friction loop.

## Roadmap

### Phase 1 — Make repository understanding trustworthy

Objective: a developer can trust what DevHarness says about an existing repo.

What this phase should do:

- detect docs/code/runtime conflicts early
- distinguish “documented”, “detected”, “confirmed”, and “proved”
- force the first step to include a real runtime bring-up when the repo needs one
- surface missing auth, database, browser, or simulator capabilities before work starts
- make database structure and data flow first-class in the understanding brief

Exit criteria:

- the brief clearly shows what is known, what is unverified, and what blocks progress
- the developer can see the main risks without reading a pile of raw files
- a repo with conflicting docs is flagged instead of being treated as understood

Relevant existing work:

- `specs/executable-system-onboarding/spec.md`
- `specs/project-declaration-review/spec.md`
- `specs/executable-review-scorecard/spec.md`
- `specs/runtime-proof-review/spec.md`
- `specs/goal-understanding-checkpoint/spec.md`

### Phase 2 — Make planning legible and review cheap

Objective: the developer should be able to review agent intent in minutes, not by
reading every generated file.

What this phase should do:

- turn a goal into a concise plan with explicit checkpoints
- show the likely agent crew and the division of work
- expose acceptance points, not just implementation notes
- provide a developer review page with summarized evidence, risks, and unknowns
- quantify progress with a readable readiness or confidence score

Exit criteria:

- the developer review surface explains the plan and evidence without dumping
  every artifact
- the developer can approve, request changes, or stop based on a compact packet
- the plan is traceable back to the exact repository revision and declaration

Relevant existing work:

- `specs/decision-light-interaction/spec.md`
- `specs/durable-goal-review/spec.md`
- `specs/verification-outcome-reporting/spec.md`
- `specs/project-declaration-review/spec.md`

### Phase 3 — Make task execution safe, parallel, and bounded

Objective: DevHarness can organize work without letting the agent wander.

What this phase should do:

- split a goal into a dependency graph
- identify one integration owner and a critical path
- run independent tasks in parallel only when resources do not conflict
- keep long-running work isolated from the consumer repository
- gate action by capability and approval, not by optimism

Exit criteria:

- parallel work is only allowed when the graph says it is safe
- service, file, port, data, and environment claims are visible
- execution always has a bounded teardown path

Relevant existing work:

- `specs/authorized-execution-gate/spec.md`
- `specs/capability-authorization/spec.md`
- `specs/single-agent-goal-runtime/spec.md`
- `specs/project-harness-generator/spec.md`

### Phase 4 — Make verification real instead of symbolic

Objective: the framework proves actual behavior, not just command exit codes.

What this phase should do:

- unit proof for modules
- browser proof for web behavior
- simulator proof where applicable
- database proof for schema and data flow
- deployment, rollback, and canary proof for release paths
- performance thresholds where the system needs them

Exit criteria:

- feature completion cannot be claimed by API-only or CI-only proof
- verification is tied to the surface the user actually experiences
- deployment and automation scripts are tested when they matter

Relevant existing work:

- `specs/verification-outcome-reporting/spec.md`
- `specs/runtime-proof-review/spec.md`
- `specs/executable-review-scorecard/spec.md`

### Phase 5 — Close the loop with learning and reuse

Objective: every run makes the framework better for the next run.

What this phase should do:

- capture recurring failure patterns
- turn stable patterns into reusable harnesses or policies
- keep architecture and behavior consistent across projects
- make the framework portable across different repos and, eventually, different
  agent environments

Exit criteria:

- recurring failures reduce over time
- harness generation improves from real usage
- the framework becomes easier to adopt on a new repo

Relevant existing work:

- `specs/project-harness-generator/spec.md`
- `specs/durable-goal-review/spec.md`
- `specs/executable-review-scorecard/spec.md`

## Suggested execution order

If we keep progressing in small, reviewable slices, the order should be:

1. strengthen repository understanding and early runtime proof
2. make the developer review surface concise and quantitative
3. make goal planning and task decomposition explicit
4. deepen real verification across database, browser, and release surfaces
5. improve reuse so each successful run teaches the framework

## Operating rule

At every step, DevHarness should favor:

- clear evidence over optimistic inference
- bounded artifacts over raw dumps
- explicit approval over implied permission
- real behavior over API-only confirmation
- consumer-repo separation over convenience

If a step cannot be proved, it should be reported honestly as incomplete or
blocked.

