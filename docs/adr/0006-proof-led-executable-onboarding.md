# ADR 0006: Use proof-led executable onboarding

Status: Accepted
Date: 2026-08-29

## Context

Developers cannot safely delegate goals when the agent's repository understanding comes from
partial documentation or shallow static inspection. Requiring review of every generated
analysis file does not scale, while automatically running installers, databases and browsers
without scoped authority is unsafe.

## Decision

DevHarness uses `onboard` as a single front door. It first creates a read-only,
revision-bound plan containing a Claim Ledger, domain coverage, conflicts, limitations and a
bounded capability/authority request. Runtime drivers later add test-confirmed and
runtime-observed evidence. They cannot promote detected signals by prose.

Repository understanding, system/database/security models, approved design strategy,
verification depth and parallel execution are versioned contracts with deterministic policy
checks. Developers see one compact brief and review by exception; detailed artifacts remain
available for drill-down.

## Consequences

- Existing repositories expose missing documentation, contradictions and untestable surfaces
  before feature implementation.
- Database, security and full feature flows cannot be accidentally reduced to an API check.
- Capability approval is grouped and scoped rather than requested repeatedly.
- Onboarding remains honest while executable drivers are incomplete: it reports
  `needs-evidence`.
- The framework accepts additional contract surface before adding orchestration breadth.
