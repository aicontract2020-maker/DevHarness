# Technical Plan: Executable Review Scorecard

## Architecture

Add a portable `review-scorecard` schema and a deterministic core projection. The projection
calls the existing delivery-readiness policy and treats its reasons as authoritative hard-gate
failures. Trace metadata contributes to coverage and drill-down, but never changes delivery
authority. The UI imports one schema-shaped JSON document and renders all review values from it.

## Components

| Component | Responsibility | ACs |
|---|---|---|
| Scorecard schema | Portable UI/CLI contract | AC-1 |
| Core scorecard projector | Deterministic counts, weights, gates, evidence sufficiency | AC-2, AC-3, AC-4 |
| Contract and policy tests | Prove schema, determinism, and fail-closed behavior | AC-1–AC-4 |
| Review UI data adapter | Render a scorecard document without embedded review facts | AC-5, AC-6 |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Score becomes a second authority path | High | Derive verdict from delivery-readiness; fail closed without trusted context |
| Evidence type overstates observation | High | Require explicit signed E-level; infer conservatively when absent |
| UI fixture looks live | Medium | Display a persistent fixture badge and disable approval |
| Schema becomes presentation-specific | Medium | Store semantic counts and references; keep colors/layout out of the contract |

## Validation

- Schema fixture validation.
- Determinism test with reordered inputs.
- High-score plus failed-gate regression.
- Untrusted evidence regression.
- UI build using the same JSON contract.

