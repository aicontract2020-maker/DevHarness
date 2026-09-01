# Decision Log: Live Goal Alignment

## D-1 — First Agent slice stops at scope-ready alignment

Date: 2026-08-31  
Decision: The first executable Agent integration is read-only and ends with either an approvable
Alignment Brief or a bounded Decision Queue. It does not implement project code.  
Reason: The current runtime can preserve and review understanding artifacts, while write-capable
worker isolation and complete feature-proof drivers are still explicit blockers.

## D-2 — Agent and network are separate authorities

Date: 2026-08-31  
Decision: Agent invocation requires a dedicated bounded authority. Network research requires a
separate authority and is never implied by Agent permission.  
Reason: Model execution and external network access have different data-exposure and side-effect
boundaries.

## D-3 — Model results are untrusted inputs

Date: 2026-08-31  
Decision: Portable model results are schema-validated and integrity-bound but do not become execution
evidence or human authority.  
Reason: Structured output reduces ambiguity; it does not establish truth.

## D-4 — Provider transport is not research authority

Date: 2026-09-01  
Decision: Agent-runtime authority includes only the provider control-plane channel necessary for the
selected adapter. Project research uses a separate, allow-listed DevHarness gateway; Agent web tools
remain disabled.  
Reason: A local Agent still needs provider connectivity, but that must not become arbitrary outbound
network authority.

## D-5 — Semantic validation uses a fresh sequential invocation

Date: 2026-09-01  
Decision: A successful producer result requires a new validator invocation with a distinct identity
and source-first context before readiness projection.  
Reason: Schema validation proves shape, not whether citations support claims or areas were omitted.

## D-6 — Real execution fails closed when host isolation is insufficient

Date: 2026-09-01  
Decision: The adapter contract and fake execution path may be implemented on every host, but the real
adapter cannot start unless a non-model enforcement probe proves access/resource boundaries.  
Reason: Prompt instructions and post-run Git status cannot prove that secrets were unread or that
transient consumer writes never happened.

## D-7 — Clarification answers remain inside the Goal Run

Date: 2026-09-01  
Decision: The first slice includes an immutable, stale-safe `answer` command and resumes analysis from
the selected option; it does not require recreating the goal.  
Reason: A question-blocked brief without an answer path cannot complete the alignment loop required by
AC-8.

## D-8 — Logical operations and external attempts have separate identities

Date: 2026-09-01  
Decision: A stable semantic AlignmentOperation owns numbered, phase-specific attempts and an
append-only commit journal. Timestamps and attempt numbers do not alter the operation id.  
Reason: This makes replay, one bounded retry and crash reconciliation compatible instead of using one
create-only invocation directory for conflicting purposes.

## D-9 — The first real isolation backend targets macOS

Date: 2026-09-01  
Decision: v1 real execution uses a macOS Seatbelt boundary, immutable repository snapshot, sanitized
environment, parent-owned loopback credential proxy and continuous resource monitor. Other hosts fail
closed.  
Reason: A named enforceable backend is required before a real Agent can be claimed; a generic probe or
prompt is not a security boundary.

## D-10 — Research uses plan, fetch, synthesis, validation

Date: 2026-09-01  
Decision: The analyst first proposes public research topics; the runtime constructs and approves exact
queries, then a fresh synthesis consumes sanitized sources before a distinct validator runs.  
Reason: Research fetched after a final producer result cannot influence the result without conflating
synthesis and independent validation.

## D-11 — Authority expiry stops external work, not local review

Date: 2026-09-01  
Decision: Expired Agent/network authority forbids the next external invocation/request, but a complete
intact same-revision analysis may still be deterministically published and submitted for local scope
approval.  
Reason: Authority governs side effects and disclosure, not the later review of already-created
historical bytes.

## D-12 — Operation detail does not expand the Goal Run event protocol

Date: 2026-09-01  
Decision: Phase, attempt, authority and recovery detail uses the closed Operation Journal. Goal Run
checkpoints reuse only existing event types and do not extend the run-event enum in this slice.  
Reason: The Goal Run event payload is intentionally broad, while the Operation Journal already owns
the exact crash-safe variants. A second event vocabulary would duplicate state and create an
under-specified frozen contract.
