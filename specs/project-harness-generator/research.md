# Research: Project Harness Generator

Status: Reconciled after implementation
Date: 2026-08-29

## Problem Summary

DevHarness can discover repositories, validate a tracked declaration, and run short-lived commands in isolated worktrees. It does not yet compile that declaration into a revision-bound project harness or prove lifecycle ownership for long-running services.

## Relevant Files

| File | Current role | Key entry point |
|------|--------------|-----------------|
| `packages/project/src/init.mjs` | Proposes the tracked project declaration from discovery | `proposeProjectConfig()` — `packages/project/src/init.mjs:15` |
| `packages/project/src/config.mjs` | Reads strict JSON-compatible YAML and validates it | `readProjectConfig()` — `packages/project/src/config.mjs:6` |
| `packages/project/src/harness.mjs` | Compiles declarations and snapshots into a stable project harness | `compileProjectHarness()` — `packages/project/src/harness.mjs:52` |
| `packages/project/src/doctor.mjs` | Derives readiness from discovery and current receipts | `evaluateReadiness()` — `packages/project/src/doctor.mjs:186` |
| `packages/runtime/src/data-store.mjs` | Keys external state by repository identity and validates evidence integrity | `projectDataDirectory()` — `packages/runtime/src/data-store.mjs:19` |
| `packages/runtime/src/verify.mjs` | Plans and executes isolated commands and owned services | `createVerificationPlan()` — `packages/runtime/src/verify.mjs:49` |
| `packages/cli/src/cli.mjs` | Enforces dry-run and explicit execution boundaries | `runCli()` — `packages/cli/src/cli.mjs:80` |
| `packages/schema/schemas/v1/project-config.schema.json` | Defines the accepted consumer declaration | root contract — `packages/schema/schemas/v1/project-config.schema.json:1` |
| `packages/schema/schemas/v1/verification-receipt.schema.json` | Defines revision-bound command evidence | root contract — `packages/schema/schemas/v1/verification-receipt.schema.json:1` |

## Information Flow

1. Discovery resolves the requested path to the Git top-level and records the exact HEAD and dirty state — `packages/project/src/discover.mjs:312`.
2. Initialization turns discovered platforms and commands into a proposed tracked declaration — `packages/project/src/init.mjs:15`.
3. Configuration loading accepts only canonical JSON syntax and validates the project-config contract — `packages/project/src/config.mjs:6`.
4. Harness compilation validates semantic references, resolves command and lifecycle hashes, and emits deterministic blockers — `packages/project/src/harness.mjs:52`.
5. Verification resolves an external data root and compiled harness before creating an execution plan — `packages/runtime/src/verify.mjs:49`.
6. Execution creates a detached external worktree, owns required service processes, gates verification on readiness, and enters teardown through `finally` — `packages/runtime/src/verify.mjs:356`, `packages/runtime/src/verify.mjs:393`.
7. Doctor compares receipts with the exact current command, declaration, verification relationship, lifecycle, artifacts, and revision — `packages/project/src/doctor.mjs:17`.

## Key Findings

### F-1: Configuration now supports explicit lifecycle vocabulary

The project declaration defines an optional harness section with services and verification relationships while keeping older v1 declarations valid — `packages/schema/schemas/v1/project-config.schema.json:7`, `packages/schema/schemas/v1/project-config.schema.json:61`.

### F-2: Launch commands are deliberately non-executable

The verifier accepts only build, test, lint, typecheck, and verify command kinds; launch commands fail planning with a lifecycle-driver requirement — `packages/runtime/src/verify.mjs:20`, `packages/runtime/src/verify.mjs:83`.

### F-3: Runtime storage already has the correct ownership boundary

Project state is stored under an external root using a SHA-256 key derived from repository identity — `packages/runtime/src/data-store.mjs:15`, `packages/runtime/src/data-store.mjs:19`.

### F-4: Receipts model both the short-lived command and required services

The receipt contract binds a compiled harness and service lifecycle records in addition to global teardown — `packages/schema/schemas/v1/verification-receipt.schema.json:7`, `packages/schema/schemas/v1/verification-receipt.schema.json:48`, `packages/schema/schemas/v1/verification-receipt.schema.json:60`.

### F-5: Doctor derives launch proof from verification receipts with services

Doctor selects receipts with service records and still requires the full exact current-config predicate — `packages/project/src/doctor.mjs:17`, `packages/project/src/doctor.mjs:69`.

### F-6: The CLI already establishes the mutation convention

`init` and `build` require `--write`, while `verify` requires `--execute`; the help and dispatch paths preserve these separate boundaries — `packages/cli/src/cli.mjs:15`, `packages/cli/src/cli.mjs:80`.

## Existing Constraints Discovered

- Public artifacts are strict, versioned JSON Schema contracts loaded from one registry — `packages/project/src/contracts.mjs:8`.
- Project-harness writes use restrictive modes and a temporary-file rename — `packages/runtime/src/data-store.mjs:54`.
- Receipt trust is lost when an artifact size or SHA-256 no longer matches — `packages/runtime/src/data-store.mjs:76`.
- The runtime passes only a small OS environment allowlist plus declared project keys to child processes — `packages/runtime/src/verify.mjs:145`.
- Service and worktree cleanup occurs in `finally`, including failed readiness and command paths — `packages/runtime/src/verify.mjs:393`.

## Prior Art in This Codebase

- Revision-bound verification planning and receipt generation provide the base isolation/evidence mechanism — `packages/runtime/src/verify.mjs:49`.
- Project-config proposal, strict parsing, and harness compilation form the source-to-compiled-artifact boundary — `packages/project/src/init.mjs:15`, `packages/project/src/config.mjs:6`, `packages/project/src/harness.mjs:52`.
- Capability scoring distinguishes detected mechanisms from current exact proof — `packages/project/src/doctor.mjs:186`.

## Resolved Questions from the Spec

- Health endpoints require explicit developer declarations; compiler blockers replace guesses.
- Lifecycle proof attaches automatically to configured verification jobs.
- Readiness probes are limited to credential-free loopback HTTP.

## Not Investigated

- Browser trace and screenshot collection; it depends on lifecycle but is a later platform-pack concern.
- Dependency installation/bootstrap commands; executing package managers introduces a separate authority boundary.
- Container-specific cleanup and project-name isolation; v0 proves runtime-owned local processes first.
