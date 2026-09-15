# Domain Knownness Summary

Status: Draft
Version: 1.0
Mode: Full
Last updated: 2026-09-01

## Overview

Extend the repository-understanding digest so the developer can see, for the three highest-value application domains, how much is known, how much remains unknown, and where conflicts remain. The goal is to make database, frontend, and backend understanding reviewable at a glance, with one extra layer for their most important subdomains.

## Boundaries

**Always do:** keep the output revision-bound and read-only; derive domain-knownness from the existing claim ledger; keep database, frontend, and backend visible even when they are only partially applicable.

**Never do:** treat detection as proof; hide conflicts inside generic warnings; execute consumer commands; install software; infer missing runtime behavior.

## Acceptance criteria

### AC-1: Domain-knownness counts [MUST]

Given an onboarding plan with database, frontend, or backend claims, when the digest is produced, then each of those domains reports deterministic known, unknown, conflict, and total counts.

### AC-1b: Subdomain-knownness counts [MUST]

Given the same plan, when the digest is produced, then database reports schema, migrations, constraints, queries, and ownership counts; frontend reports routes, state, and user-flow counts; backend reports API-contract, orchestration, and failure-path counts.

### AC-2: Minimal review surface [MUST]

Given the rendered understanding brief or review packet, when a developer scans it, then the three domain counts and their subdomain counts are visible without opening raw artifacts.

### AC-3: Stable derivation [MUST]

Given the same plan, when the digest is calculated twice, then the domain-knownness counts do not change.

### AC-4: Schema-safe extension [MUST]

Given the onboarding-plan contract, when the new domain-knownness field is emitted, then the schema remains valid and existing consumers continue to work.

### AC-5: No runtime authority [SHOULD]

Given the new domain summary, when onboarding runs, then it still performs no installation, launch, browser, simulator, or database access.

## Out of scope

- New runtime proof drivers.
- System-model expansion beyond the summary.
- Project-repository mutation.
