# ADR 0005: Use a Decision Surface over rich artifacts

Date: 2026-08-29
Status: Accepted

## Context

Reliable autonomous work needs detailed research, requirements, design, task, event, evidence, review, and repair artifacts. Requiring developers to read all of them would recreate the supervision burden DevHarness is meant to remove. Replacing them with an untraceable agent summary would recreate the original trust problem in a smaller document.

## Decision

DevHarness keeps rich artifacts as authoritative runtime memory and audit evidence, but exposes a bounded Decision Surface by default:

- Alignment Brief for understanding-and-acceptance approval.
- Decision Queue for one to three material exceptions.
- Progress Pulse for no-action status.
- Delivery Brief for criterion-oriented delivery approval.

Every surfaced item traces to checksummed source artifacts. Packets disclose compression counts and bind to the goal run and Git revision. Blocking uncertainty cannot be represented by an informational or ready verdict.

The runtime asks the developer only when unresolved uncertainty has material impact and is costly to reverse or crosses an approved outcome, scope, security, privacy, destructive, financial, external-authority, or budget boundary. Repository-discoverable facts and low-risk reversible implementation choices remain autonomous.

## Consequences

- Developer attention becomes an explicit runtime resource and event stream rather than chat noise.
- CLI and future dashboard implementations share a portable interaction contract.
- The two default human gates remain, but their review payload becomes bounded and consistent.
- Interfaces must support drill-down without making source artifacts required reading.
- Packet generation requires deterministic semantic validation in addition to JSON shape validation.
- Artifact count is not a product success metric; decision latency, exception count, traceability, and misunderstanding rates are.

