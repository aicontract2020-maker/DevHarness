# Technical Plan: Runtime Proof Review

## Spec Reference

Implements `specs/runtime-proof-review/spec.md`.

## Architecture

Extend the existing receipt rather than create a parallel log format. Add a deterministic,
read-only review projection over integrity-checked receipts. Treat worktree preparation and HTTP
warmup as explicit lifecycle phases. Add a sealed E2 system-command driver for passing `verify`
receipts without expanding its evidence claims to E3.

## Components

1. **Receipt association and classification** — optional plan input becomes required for public
   execution; receipts add `goal_run_id`, preparation/warmup records and a stable outcome reason.
   Covers AC-1, AC-4, AC-5, AC-6.
2. **Verification review projector** — `packages/runtime/src/verification-review.mjs` consumes only
   `listValidReceipts()`, returns bounded deterministic summaries. Covers AC-2, AC-E1.
3. **Review API and UI** — fixed `/api/review/verifications` endpoint and compact panel. Covers AC-3,
   AC-E1.
4. **Sealed system-command driver** — shares receipt binding/storage mechanics but has distinct
   semantics and an E2-only observation. Covers AC-7.
5. **Workspace/lifecycle extensions** — initialize recorded submodules and run safe loopback warmups
   before commands. Covers AC-4, AC-5.
6. **Scheduling boundary** — preserve existing conflict validation; document that this increment
   does not create a worker executor. Covers AC-8.

## Contract

`contracts/verification-review.md` defines the new review projection and endpoint. Existing schemas
are extended additively for receipt association and lifecycle observations.

## AC Coverage

| AC | Components | Tests |
|---|---|---|
| AC-1 | Receipt association | CLI + runtime verification |
| AC-2 | Projector | runtime projector tests |
| AC-3 | Review API/UI | server, client, build tests |
| AC-4 | Workspace preparation | runtime integration tests |
| AC-5 | HTTP warmup | harness + runtime tests |
| AC-6 | Outcome classification | runtime integration tests |
| AC-7 | System-command driver | supervisor evidence tests |
| AC-8 | Existing scheduling policy | scheduler regression tests |
| AC-E1 | Projector/API/UI | corruption and unavailable-state tests |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Review projection accidentally trusts prose | High | Derive only structural facts from schema-valid intact receipts |
| Submodule preparation performs hidden network work | High | Require existing dependency-install authority and record failure; never fall back silently |
| Warmup becomes arbitrary command execution | High | Permit only existing safe credential-free loopback HTTP check contract |
| E2 system evidence is mistaken for E3 behavior proof | High | Distinct driver semantics and explicit forbidden evidence types |
| Receipt schema extension invalidates fixtures | Medium | Additive optional fields for historical receipts; require goal id only on public CLI execution |
| Parallel execution races shared state | High | No worker executor in this increment; preserve conflict-safe scheduling gate |

## Out of Scope

- Parsing arbitrary framework text into trusted test counts.
- Direct network traces, screenshots or database observations as E3 evidence.
- Consumer product changes.

