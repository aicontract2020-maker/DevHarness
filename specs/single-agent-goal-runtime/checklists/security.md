# Security Checklist: Live Goal Alignment

Spec: `specs/single-agent-goal-runtime/spec.md` @ v1.0  
Generated: 2026-08-31

## Primary

- [x] Is Agent invocation authority explicit and separate from scope approval? — AC-1, Boundaries
- [x] Is read-only consumer access stated and enforced for ignored/untracked paths? — AC-2, AC-13
- [x] Is default-deny access stated for environment, Supervisor state, unrelated files and network? — AC-2
- [x] Is repository and revision binding required? — AC-2
- [x] Is provider output prevented from becoming trusted evidence? — Boundaries, Open Questions
- [x] Are repository and internet instructions prevented from changing goal, authority or policy? — AC-4a

## Alternate

- [x] Is local analysis behavior specified when network authority is absent? — AC-9
- [x] Are approved network destinations, outbound data and redirects bounded? — AC-9
- [x] Are network citations and research failures specified? — AC-9
- [x] Is provider-neutral result handling required? — AC-15

## Exception

- [x] Are timeout, cancellation, invalid output and integrity failure specified? — AC-11
- [x] Are stale, expired and rejected decisions prohibited from granting authority? — Boundaries
- [x] Is behavior specified for unresolved high-impact questions? — AC-8
- [x] Is hostile markup/control-sequence handling specified? — AC-12
- [x] Are material and blocking classifications objectively defined? — AC-6
- [x] Is claim validation independent of the producer? — AC-4
- [x] Is area applicability derived outside the producer? — AC-5

## Recovery

- [x] Is replay identity and invalidation explicit after interruption? — AC-10
- [x] Is automatic retry bounded? — AC-11, Non-Functional Requirements
- [x] Must failed attempts preserve one safe recovery action? — AC-11

## Non-functional

- [x] Is the execution deadline numeric and bounded? — AC-14
- [x] Is forced process termination bounded? — AC-14
- [x] Are output, record, disk and memory limits numeric? — AC-14
- [x] Are temporary storage and process-count limits numeric? — AC-14
- [x] Are credential values and private chain-of-thought excluded? — AC-12
- [x] Is the developer decision surface bounded and deterministically ordered? — AC-6, Non-Functional Requirements

Intentionally excluded: project mutation, implementation, delivery, production-grade worker
isolation and external deployment — AC-16 and Out of Scope.

**27 items, 0 findings.**
