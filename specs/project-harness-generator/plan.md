# Technical Plan: Project Harness Generator and Owned Service Lifecycle

## Spec Reference

Implements: `specs/project-harness-generator/spec.md`

## Architecture Overview

Extend the accepted project declaration with explicit services and verification jobs, then compile it with a repository snapshot into an immutable project-harness manifest. Store manifests under the existing external project data directory only after `build --write`. Verification resolves a job's single required service, starts it inside the same isolated worktree, performs a loopback HTTP readiness probe, runs the short-lived command, and tears down the owned process before producing an expanded receipt.

## Component Breakdown

### Project and harness contracts

- **Responsibility:** Define lifecycle declarations, compiled manifest, service records, and hash bindings.
- **Location:** `packages/schema/schemas/v1/`
- **Accepts:** JSON-compatible project declaration and compiled artifacts.
- **Returns:** Strict validation results.
- **AC Coverage:** AC-1, AC-2, AC-3, AC-6, AC-E1, AC-E3.

### Harness compiler

- **Responsibility:** Resolve command references, validate local targets, derive blockers, hash canonical inputs, and optionally store an atomic external manifest.
- **Location:** `packages/project/src/harness.mjs`
- **Accepts:** Repository snapshot, validated configuration, external data root.
- **Returns:** Deterministic project-harness manifest and external path.
- **AC Coverage:** AC-1, AC-2, AC-3, AC-E1, AC-E3.

### External data store

- **Responsibility:** Address and atomically write project harnesses alongside receipts without entering consumer repositories.
- **Location:** `packages/runtime/src/data-store.mjs`
- **Accepts:** Repository identity, harness ID, contract-valid manifest.
- **Returns:** Stable external paths.
- **AC Coverage:** AC-1, AC-2.

### Lifecycle verification controller

- **Responsibility:** Start one configured service, wait for loopback HTTP readiness, gate the verification command, capture logs, and guarantee bounded shutdown.
- **Location:** `packages/runtime/src/verify.mjs`
- **Accepts:** Revision-bound verification plan with zero or one required service.
- **Returns:** Expanded contract-valid receipt with hashed evidence.
- **AC Coverage:** AC-4, AC-5, AC-E2, AC-E3.

### CLI and doctor integration

- **Responsibility:** Expose `build` dry-run/`--write`, show blockers, and count only current exact lifecycle proof.
- **Location:** `packages/cli/src/cli.mjs`, `packages/project/src/doctor.mjs`
- **Accepts:** User options, snapshot, configuration, manifests, receipts.
- **Returns:** Text/JSON plans and readiness report.
- **AC Coverage:** AC-1, AC-2, AC-3, AC-6.

## Technology Choices

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Manifest serialization | Canonical `JSON.stringify` over ordered objects | Zero dependency and deterministic hashing |
| Readiness driver | Node built-in `fetch` to loopback HTTP | Cross-platform enough for v0; no shell parsing |
| Service ownership | Detached child process group | Allows group TERM/KILL and prevents orphan grandchildren |
| Persistence | Existing external project storage with temp-file rename | Preserves consumer separation and atomicity |
| Scope | One required service per verification job | Proves the lifecycle before introducing orchestration complexity |

## Contracts

- `contracts/project-harness.md`: source declaration to compiled manifest rules.
- `contracts/lifecycle-verification.md`: startup, readiness, command gate, evidence, and teardown ordering.
- JSON Schema files are the machine-enforced public contracts.

## AC Coverage Map

| AC | Component(s) | Contract(s) |
|----|--------------|-------------|
| AC-1 | Harness compiler, CLI | `project-harness.md` |
| AC-2 | Harness compiler, data store, CLI | `project-harness.md` |
| AC-3 | Harness compiler, CLI | `project-harness.md` |
| AC-4 | Lifecycle controller | `lifecycle-verification.md` |
| AC-5 | Lifecycle controller | `lifecycle-verification.md` |
| AC-6 | Doctor, receipt contract | Both |
| AC-E1 | Project contract, compiler | `project-harness.md` |
| AC-E2 | Lifecycle controller | `lifecycle-verification.md` |
| AC-E3 | Compiler, verification planner | Both |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Shell service leaves grandchildren | Medium | High | Detached process group, TERM then KILL, exit confirmation, failing teardown verdict |
| Readiness URL becomes SSRF surface | Medium | High | Parse with URL API; allow only HTTP loopback without credentials/query/fragment |
| Config change reuses stale receipt | Medium | High | Bind manifest and lifecycle hashes; doctor compares exact current declarations |
| Service writes generated files | Medium | Medium | Evaluate Git dirty state after teardown and fail the receipt |
| Dry-run mutates external state | Low | High | Pure compiler; persistence invoked only behind explicit `--write` |

## Out of Scope (Technical)

- No browser driver or evidence collector in this slice.
- No containers, port allocator, service graph, or parallel startup.
- No consumer repository writes beyond the already separate `init --write` boundary.

