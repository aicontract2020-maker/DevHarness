# ADR 0002: Adopt runtime patterns without copying products

- Status: Accepted
- Date: 2026-08-28

## Context

DevHarness overlaps with several projects that have already proven parts of autonomous agent development:

- [gstack](https://github.com/garrytan/gstack) gives agents deterministic browser control, diffable observations, assertions, evidence capture, review workflows, and persistent operational artifacts.
- [pstack](https://github.com/cursor/plugins/tree/main/pstack) encodes rigorous engineering judgment as principles and task-specific playbooks. Its [project verification generator](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md) interviews a repository, creates a project-local driver and feature map, then requires the generated verifier to prove itself end to end.
- [Noodle](https://github.com/poteto/noodle) provides a continuous scheduling loop built around inspectable state, validated orders, agent/model routing, isolated worktrees, and serialized integration. Its [scheduling model](https://poteto.github.io/noodle/concepts/scheduling.html) exposes exactly what the scheduler sees before it dispatches work.

These projects solve complementary slices. Copying any one of them would not create the goal-oriented, two-gate, evidence-backed runtime defined by DevHarness.

## Decision

DevHarness adopts the following patterns.

### From pstack

- The user supplies an outcome and a way to know it is done. The framework supplies the engineering ceremony.
- Route work through task-shaped playbooks instead of one universal prompt.
- Preserve a reviewable decision trail for unattended work.
- Bind autonomous work to an explicit done predicate and bounded stop conditions.
- Interview the repository before asking the developer for facts that can be discovered.
- Generate and execute a project-specific verification harness before trusting it.
- Treat proof of real behavior as different from CI being green.

### From Noodle

- Build a plain, inspectable scheduler snapshot before every scheduling decision.
- Have an agent propose orders, then validate them deterministically before dispatch.
- Express dependencies explicitly and run only independent stages in parallel.
- Give every writing agent an isolated worktree.
- Serialize integration into the goal's integration branch.
- Separate provider/model routing from task contracts.
- Re-evaluate the plan after completions and failures instead of assuming the initial plan stays correct.

### From gstack

- Prefer deterministic tools and scripts for repeated operations over repeated model exploration.
- Observe behavior through real surfaces, including browser state, console, network, screenshots, and diffs.
- Make assertions and evidence first-class outputs, not prose appended after the work.
- Keep persistent sessions where continuity is part of the real user behavior.
- Codify a successfully repeated flow into a testable procedure with fixtures.
- Treat content from browsers and external research as untrusted input.
- Preserve resumable checkpoints and derive status from source artifacts rather than hand-maintained narration.

## Deliberate differences

DevHarness will not use skills as the source of truth for runtime state. Skills may supply methodology and agent instructions, but versioned schemas, events, policies, and deterministic validators govern execution.

Natural-language scheduling conditions may help a scheduler decide, but they are not sufficient authority for dispatch. Proposed orders must pass structural, capacity, dependency, scope, and policy validation.

DevHarness does not merge completed work directly into a developer's base branch. Work integrates into a run-scoped branch and stops at an evidence-backed pull request in v0.

Browser verification is one platform pack, not a core assumption. CLI and API consumers must exercise the same acceptance and evidence contracts.

Project-local harness configuration is declarative. Generated drivers, runtime state, worktrees, and evidence remain external to the consumer repository by default.

Fixed specialist personas are optional role templates. The runtime staffs a goal from required capabilities and task boundaries.

## Consequences

- Schemas and deterministic validators must exist before autonomous scheduling.
- The scheduler needs a two-phase propose/validate/promote protocol.
- Evidence must be bound to a repository revision so stale proof cannot approve a new head.
- The framework must support project-specific verification without leaking project details into core.
- Status views are projections over events and artifacts, never a parallel source of truth.
- Repeated successful agent procedures should be promotable into deterministic pack recipes.

