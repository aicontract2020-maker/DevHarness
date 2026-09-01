# Walkthrough: Decision-light developer interaction

## 1. A goal produces detailed authoritative artifacts

Research, requirements, design, acceptance criteria, tasks, evidence, and review records remain outside the consumer repository as durable runtime memory.

## 2. The Decision Surface compiles a human read model

`interaction-packet.schema.json` constrains a packet to one of four kinds and requires verdict, attention, sections, decisions, actions, source artifacts, traceability, and compression counts.

## 3. Gate 1 uses one Alignment Brief

The developer approves the shared understanding, non-goals, acceptance criteria, material assumptions, and unresolved product decisions without reading every source artifact.

## 4. Execution uses review by exception

A Progress Pulse carries no action. A Decision Queue carries one to three material decisions. `interaction-policy.mjs` rejects packets that disguise decisions as status or omit gate attention.

## 5. Summaries remain auditable

Every surfaced claim maps to a known checksummed artifact. The deterministic policy checks source and surfaced counts, item mappings, blocking verdicts, and the single recommended next action.

## 6. Gate 2 uses one Delivery Brief

The developer sees acceptance verdicts, evidence coverage, independent review, significant changes, and remaining risks, with optional drill-down to evidence and diff.

## Not handled here

- Goal orchestration and packet generation by an agent.
- CLI/dashboard rendering and notifications.
- Hosted collaboration.

## Unrequested behavior

None. The change does not add a goal command, alter completion authority, remove human gates, or execute consumer code.

