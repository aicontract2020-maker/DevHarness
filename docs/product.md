# Product definition

## Problem

Coding agents can edit files, but developers still perform most of the engineering management loop themselves: clarifying intent, gathering context, decomposing work, checking progress, testing behavior, reviewing changes, recovering from failures, and deciding whether a result is trustworthy.

Existing skills can improve an individual agent session. They do not by themselves provide a durable, observable, agent-independent runtime that owns a goal from intake to an evidence-backed pull request.

## Product promise

DevHarness accepts a software goal and runs a visible, resumable engineering process that ends in one of three honest outcomes:

1. A pull request that satisfies approved acceptance criteria and includes verification evidence.
2. A clearly explained blocker that requires developer authority or a missing project capability.
3. A failed verdict with preserved evidence and actionable next steps.

The runtime never converts "the agent says it is done" into a completion verdict.

## Primary user

The first user is an individual developer or small engineering team already using coding agents who wants to delegate an entire feature or bug-fix outcome instead of supervising every edit.

## Core job to be done

> When I have a well-scoped software outcome, help me turn it into a trustworthy pull request while I handle only meaningful product decisions and exceptions.

## Existing-project engagement (three phases)

For repositories that already exist, DevHarness must not jump straight to feature goals.
Engagement is ordered:

1. **Understand** the project (goals, stack, architecture, test map) — including environment
   setup and bounded capability approvals as prerequisites, not as the whole of onboarding.
2. **Test and fix bugs** until the baseline is stable enough to build on.
3. **Only then** autonomously develop new features from goals (Gate 1 → implement/verify → Gate 2).

Skipping ahead is an anti-pattern: a wired harness plus one smoke receipt is not phase-3
readiness. See [existing-project-onboarding-phases.md](./existing-project-onboarding-phases.md).


## Default autonomy policy

Before accepting a goal, DevHarness onboards the repository. It produces a compact,
revision-bound Repository Understanding Brief and asks once for the bounded capabilities
needed to run the real system. Static detection, documentation, code, tests and runtime
observations remain distinguishable. Database, security and complete feature flows are
explicit review domains. Missing proof blocks autonomous-start readiness rather than being
hidden behind an aggregate score.

The default workflow has two mandatory human gates:

### Gate 1: understanding and acceptance approval

The developer approves:

- Refined goal and user outcome.
- Requirements and explicit non-goals.
- Proposed functional and technical design.
- Falsifiable acceptance criteria.
- Material risks, assumptions, and external dependencies.

The developer reviews these through one traceable Alignment Brief, not by opening every generated research, requirement, design, and acceptance file. Approval records the authoritative artifact set represented by the brief.

### Gate 2: delivery approval

The developer receives:

- Pull request or final diff.
- Acceptance-criterion verdicts.
- Test and behavior-verification evidence.
- Independent review findings and resolutions.
- Remaining risks, limitations, and follow-up work.

Planning, team formation, implementation, coordination, verification, repair, and review are autonomous between the gates unless a policy or blocker requires intervention.

Projects may choose stricter policies. Relaxing either default gate is outside the v0 promise.

## Decision-light interaction

Detailed artifacts are runtime memory and audit evidence, not a developer inbox. The normal goal experience has four bounded surfaces:

1. **Alignment Brief:** shared understanding and acceptance contract for Gate 1.
2. **Decision Queue:** one to three material exceptions that require developer judgment or authority.
3. **Progress Pulse:** a no-action projection of phase, criteria coverage, risk, and blockers.
4. **Delivery Brief:** criterion-oriented result and evidence for Gate 2.

The runtime resolves repository-discoverable facts and low-risk reversible implementation choices autonomously. It requests attention only for material outcome or scope changes, security/privacy/destructive/financial/external-authority boundaries, costly-to-reverse choices, unresolvable product ambiguity, or exhausted budgets.

Every surfaced claim is traceable to structured source artifacts. Blocking uncertainty cannot be hidden by summary compression. See [Developer interaction model](interaction-model.md).

## Observable work, not hidden reasoning

The product records inspectable engineering artifacts rather than private model reasoning. Developers see compact derived packets by default and open these artifacts only when they need to audit or drill down:

- Goal interpretation, assumptions, and clarification questions.
- Research sources and adopted conclusions.
- Requirements, design, and non-goals.
- Acceptance criteria and proof method for each criterion.
- Plan, dependencies, ownership, and current status.
- Agent roles, task contracts, and permitted change scope.
- Decisions, risks, blockers, and retries.
- Test output, screenshots, logs, network observations, and data-state evidence.
- Review findings and repair history.
- Final completion report.

## Reliability contract

A goal may be marked complete only when:

- Gate 1 was approved and the approved scope has not drifted silently.
- Every required acceptance criterion has an explicit verdict.
- Every passing verdict references reproducible evidence.
- Required project quality gates pass.
- Every applicable database, security and end-to-end system impact has a traced model and proof plan.
- Module work has unit proof; feature work has integration, actual-surface functional and system proof.
- Release claims, when requested, include exercised deployment/rollback automation, numeric performance thresholds and postdeploy canary evidence as applicable.
- Behavior-critical work is verified outside the implementation agent's self-report.
- Independent review has no unresolved blocking findings.
- The final diff is attributable to approved tasks.
- Gate 2 is ready for developer review.

Unsupported projects and unverifiable goals are readiness failures, not successful runs. `doctor` must explain the missing capability and how to add it.

## Vision versus v0

"Any project, any goal" is the extensibility vision. The initial product supports a narrower matrix and must report its actual support honestly.

The v0 wedge is:

- Existing Git repositories.
- Local execution.
- One agent adapter initially, with the adapter interface proven by a second adapter.
- Web applications first, followed by a deliberately different CLI or API consumer.
- Feature and bug-fix goals.
- Evidence-backed pull requests, not automatic merge or production deployment.

## Success criteria for the framework

The framework is working when:

1. A clean clone can be assessed without manual repo archaeology.
2. The same core runtime completes goals in two structurally different repositories.
3. Replacing the coding agent does not change the goal or evidence contracts.
4. An interrupted run can resume without reconstructing decisions from chat history.
5. A developer can determine progress, blockers, and proof without reading agent transcripts.
6. A failed verification automatically returns work to a bounded repair loop.
7. A normal bounded goal can be governed through the two default gates and material exceptions without reviewing every generated artifact.
8. Every developer-facing summary item can be traced to the authoritative artifact set it compresses.

## Non-goals for v0

- Automatic merging or deployment.
- A hosted multi-tenant control plane.
- Arbitrary mobile, embedded, data, and infrastructure verification.
- Optimizing for large multi-team enterprises.
- Maintaining dozens of fixed agent personas.
- Exposing model chain-of-thought.
- Replacing Git, CI, test frameworks, or issue trackers.
