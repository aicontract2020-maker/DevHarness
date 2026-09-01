# Technical Plan: Decision-light developer interaction

## Spec Reference

`specs/decision-light-interaction/spec.md` v1.0.0

## Architecture Overview

Add a Decision Surface between the goal runtime's artifact store and any CLI/dashboard. It compiles detailed artifacts into one of four structured interaction packets. Packets remain read models; gates, events, criteria, and evidence remain authoritative.

## Component Breakdown

### Product flow

Update product and architecture documents so Gate 1 becomes understanding-and-acceptance approval, autonomous execution uses review-by-exception, and Gate 2 consumes a Delivery Brief.

### Interaction packet contract

Add a v1 JSON Schema with packet kind, verdict, attention summary, bounded sections, decision options, actions, source-artifact references, traceability mappings, and compression counts.

### Event vocabulary

Add packet publication and attention lifecycle events without changing the goal state machine. Attention is orthogonal to execution state except where policy requires a blocker or gate.

### Interaction policy

Add deterministic semantic checks for traceability, compression counts, blocking verdicts, gate attention, Decision Queue behavior, Progress Pulse no-action behavior, and one recommended next action.

### Validator

Enforce `maxItems` so the three-decision interaction budget and existing lifecycle cardinality declarations are real contract checks.

## AC Coverage Map

| AC | Component |
|----|-----------|
| AC-1, AC-5, AC-6 | Interaction packet schema and interaction policy |
| AC-2, AC-3, AC-7 | Product flow and interaction-model documentation |
| AC-4, AC-E2 | Packet schema and validator `maxItems` support |
| AC-8 | Run-event vocabulary |
| AC-E1 | Deterministic interaction policy |

## Risks

- A generic packet could become an unstructured dumping ground. Mitigation: fixed packet kinds, bounded decision count, fixed claim markers, actions, traceability, and compression fields.
- A concise summary could hide important detail. Mitigation: blocking verdict semantics and item-to-artifact traceability are mandatory.
- Too many runtime states could complicate recovery. Mitigation: attention uses events and packet artifacts, not new goal states.

## Out of Scope

No CLI rendering or autonomous goal execution is added in this slice.
