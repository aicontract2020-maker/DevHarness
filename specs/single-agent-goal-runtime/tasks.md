# Task List: Single-Agent Goal Runtime — Live Goal Alignment

Status: Gate 3 approved by developer  
Date: 2026-09-01

## Plan Reference

Implements `specs/single-agent-goal-runtime/plan.md` after Gate 2 approval. The approved
`contracts/` are frozen. Each implementation task has an immediately preceding test task,
touches at most three files and is one reviewable commit. During a test-first commit the new
targeted test may be red; all pre-existing regression tests must remain green. Its paired
implementation commit must make both targeted and regression suites green.

## Tasks

### A. Contract Enforcement and Portable Records

- [x] **TASK-001** [S] Test JSON Schema features required by the approved contracts
  - Modifies: `packages/schema/test/system-contracts.test.mjs`
  - Tests: AC-2, AC-4a, AC-10, AC-12, AC-14; `data-model.md` § Normative Closed Record Dictionary
  - Covers: `oneOf`, conditions, `not`, string/object limits, fragment validation and unknown keys
  - Depends on: none

- [x] **TASK-002** [M] Implement the missing validator semantics
  - Modifies: `packages/schema/src/validator.mjs`
  - Plan/contract: § Portable Agent contracts; `data-model.md` § Normative Closed Record Dictionary
  - Satisfies: AC-2, AC-4a, AC-10, AC-12, AC-14
  - Depends on: TASK-001

- [x] **TASK-003** [M] Test shared types plus closed Agent and analysis records
  - Creates: `packages/schema/test/agent-alignment-contracts.test.mjs`
  - Tests: AC-2, AC-3, AC-4, AC-4a, AC-11, AC-12, AC-14, AC-15
  - Covers: shared ArtifactRef/AuthorityRef/SourceRef/policy/limits, descriptor, invocation, attempt, plan, analysis, validation, boundaries and provider-key rejection
  - Depends on: TASK-002

- [x] **TASK-004** [M] Implement shared types plus closed Agent and analysis schemas
  - Creates: `packages/schema/schemas/v1/live-alignment-common.schema.json`, `packages/schema/schemas/v1/agent-runtime.schema.json`, `packages/schema/schemas/v1/goal-analysis.schema.json`
  - Plan/contract: § Portable Agent contracts; `contracts/agent-adapter.md` §§ AgentDescriptor–AgentAttemptOutput
  - Satisfies: AC-2, AC-3, AC-4, AC-4a, AC-11, AC-12, AC-14, AC-15
  - Depends on: TASK-003

- [x] **TASK-005** [M] Test closed operation, journal, lease and accounting records
  - Creates: `packages/schema/test/alignment-operation-contracts.test.mjs`
  - Tests: AC-2, AC-10, AC-11, AC-14
  - Covers: journal variants, attempts, reservations, receipts, fences, manifests, commit records and lease owners
  - Depends on: TASK-004

- [x] **TASK-006** [M] Implement closed operation and accounting schemas
  - Creates: `packages/schema/schemas/v1/alignment-operation.schema.json`, `packages/schema/schemas/v1/operation-journal-record.schema.json`, `packages/schema/schemas/v1/operation-accounting.schema.json`
  - Plan/contract: § Persistence; `contracts/live-alignment.md` § Idempotency and Recovery
  - Satisfies: AC-2, AC-10, AC-11, AC-14
  - Depends on: TASK-005

- [x] **TASK-007** [M] Test closed research, answer and bundle records
  - Creates: `packages/schema/test/alignment-result-contracts.test.mjs`
  - Tests: AC-3, AC-4, AC-4a, AC-5, AC-6, AC-7, AC-8, AC-9, AC-12
  - Covers: authority epochs, URL recipes, source/gap terminals, immutable answers and material decisions
  - Depends on: TASK-004

- [x] **TASK-008** [M] Implement closed research and result schemas
  - Creates: `packages/schema/schemas/v1/research-records.schema.json`, `packages/schema/schemas/v1/developer-answer.schema.json`, `packages/schema/schemas/v1/alignment-bundle.schema.json`
  - Plan/contract: §§ Controlled research gateway, Independent validator/projector; `contracts/isolation-and-research.md` §§ Research Request–Research Result
  - Satisfies: AC-3, AC-4, AC-4a, AC-5, AC-6, AC-7, AC-8, AC-9, AC-12
  - Depends on: TASK-007

- [x] **TASK-009** [S] Test canonical digests and cross-record integrity
  - Creates: `packages/runtime/test/alignment-integrity.test.mjs`
  - Tests: AC-1, AC-2, AC-4, AC-9, AC-10, AC-12, AC-14
  - Covers: domain separation, exclusions, accounting-head paths, ID/hash/authority/revision joins and unsafe entries
  - Depends on: TASK-004, TASK-006, TASK-008

- [x] **TASK-010** [M] Implement canonical records and cross-record validation
  - Creates: `packages/runtime/src/canonical-records.mjs`, `packages/runtime/src/alignment-integrity.mjs`
  - Plan/contract: § Persistence; `data-model.md` §§ canonical digest, Integrity and Secret Handling
  - Satisfies: AC-1, AC-2, AC-4, AC-9, AC-10, AC-12, AC-14
  - Depends on: TASK-009

- [x] **TASK-011** [S] Test hostile-output and secret sanitization
  - Creates: `packages/runtime/test/untrusted-output.test.mjs`
  - Tests: AC-4a, AC-11, AC-12, AC-14
  - Covers: exact credential/env matches, private-key/token patterns, controls, active markup, bounds and raw non-promotion
  - Depends on: TASK-002

- [x] **TASK-012** [M] Implement the raw-Agent-output promotion boundary
  - Creates: `packages/runtime/src/untrusted-output.mjs`
  - Plan/contract: § Worker boundary; `contracts/agent-adapter.md` §§ Prompt Envelope, AgentAttemptOutput
  - Satisfies: AC-4a, AC-11, AC-12, AC-14
  - Depends on: TASK-011

- [x] **TASK-013** [S] Test additive authority compatibility
  - Creates: `packages/schema/test/live-alignment-authority-compatibility.test.mjs`
  - Tests: AC-1, AC-8, AC-9, AC-10, AC-15
  - Covers: `agent-runtime`, `network-research`, `alignment-answer`, reversibility and legacy approvals
  - Depends on: TASK-002

- [x] **TASK-014** [S] Add authority values without changing legacy meanings
  - Modifies: `packages/schema/schemas/v1/common.schema.json`, `packages/schema/schemas/v1/approval-request.schema.json`, `packages/schema/schemas/v1/approval-receipt.schema.json`
  - Plan/contract: § Compatibility and Migration; `contracts/live-alignment.md` §§ Static Advance, Answering Decisions
  - Satisfies: AC-1, AC-8, AC-9, AC-10, AC-15
  - Depends on: TASK-013

### B. Portable Adapters

- [x] **TASK-015** [S] [P] Test the adapter registry and lifecycle
  - Creates: `packages/runtime/test/agent-adapter.test.mjs`
  - Tests: AC-1, AC-2, AC-10, AC-11, AC-14, AC-15
  - Covers: probe without model call, digests, unsupported adapter, start/cancel/result and injection
  - Depends on: TASK-004, TASK-010

- [x] **TASK-016** [S] Implement the portable adapter registry
  - Creates: `packages/runtime/src/agent-adapter.mjs`
  - Plan/contract: § Agent registry and adapter protocol; `contracts/agent-adapter.md` §§ Interface, Validation and Errors
  - Satisfies: AC-1, AC-2, AC-10, AC-11, AC-14, AC-15
  - Depends on: TASK-015

- [x] **TASK-017** [M] Test Codex argv, probe, cancellation and output
  - Creates: `packages/runtime/test/codex-adapter.test.mjs`
  - Tests: AC-2, AC-3, AC-4a, AC-11, AC-12, AC-14, AC-15
  - Covers: exact argv, ignored customization, disabled tools/network, empty env, malformed output and timeout
  - Depends on: TASK-012, TASK-016

- [x] **TASK-018** [M] Implement the Codex v1 adapter
  - Creates: `adapters/agents/codex/index.mjs`, `adapters/agents/index.mjs`
  - Modifies: `packages/runtime/src/agent-adapter.mjs`
  - Plan/contract: § Codex adapter; `contracts/agent-adapter.md` §§ Prompt Envelope, AgentAttemptOutput, Codex v1 Invocation
  - Satisfies: AC-2, AC-3, AC-4a, AC-11, AC-12, AC-14, AC-15
  - Depends on: TASK-017

- [x] **TASK-019** [S] Test two adapters against identical portable invocations
  - Creates: `packages/runtime/test/agent-adapter-conformance.test.mjs`
  - Tests: AC-2, AC-3, AC-4, AC-10, AC-12, AC-15
  - Covers: Codex and an injected scripted adapter yield the same descriptor, invocation, normalized-attempt and error semantics
  - Depends on: TASK-018

- [x] **TASK-020** [S] Implement the injected conformance test adapter
  - Creates: `packages/runtime/test/fixtures/scripted-agent-adapter.mjs`
  - Plan/contract: § Agent registry and adapter protocol; `contracts/agent-adapter.md` § Interface
  - Satisfies: AC-2, AC-3, AC-4, AC-10, AC-12, AC-15
  - Depends on: TASK-019

### C. Durable Operation Runtime

- [x] **TASK-021** [M] [P] Test conservative reservation accounting
  - Creates: `packages/runtime/test/operation-accounting.test.mjs`
  - Tests: AC-10, AC-11, AC-14
  - Covers: reserve-before-action, conservative charge/release, all ceilings and accounting replay
  - Depends on: TASK-006, TASK-010

- [x] **TASK-022** [M] Implement create-only operation accounting
  - Creates: `packages/runtime/src/operation-accounting.mjs`
  - Plan/contract: § Worker boundary; `contracts/isolation-and-research.md` §§ Resource Limits, Operation Budget and Ownership
  - Satisfies: AC-10, AC-11, AC-14
  - Depends on: TASK-021

- [x] **TASK-023** [S] Test append-only journal publication and replay
  - Creates: `packages/runtime/test/operation-journal-store.test.mjs`
  - Tests: AC-10, AC-11, AC-12
  - Covers: variants, sequence/CAS, no-replace/fsync, corruption, unsafe entries and replay
  - Depends on: TASK-006, TASK-010

- [x] **TASK-024** [M] Implement the operation journal store
  - Creates: `packages/runtime/src/operation-journal-store.mjs`
  - Plan/contract: § Persistence; `contracts/live-alignment.md` § Idempotency and Recovery
  - Satisfies: AC-10, AC-11, AC-12
  - Depends on: TASK-023

- [x] **TASK-025** [M] Test lease ownership and commit/cancel fencing
  - Creates: `packages/runtime/test/operation-lease.test.mjs`
  - Tests: AC-10, AC-11, AC-14
  - Covers: boot/PID-birth, heartbeat, stale proof, O_EXCL race, 250 ms watch and permanent cancel
  - Depends on: TASK-024

- [x] **TASK-026** [M] Implement leases and the shared terminal fence
  - Creates: `packages/runtime/src/operation-lease.mjs`
  - Plan/contract: § Persistence; `contracts/live-alignment.md` § Idempotency and Recovery
  - Satisfies: AC-10, AC-11, AC-14
  - Depends on: TASK-025

- [x] **TASK-027** [M] Test prepared checkpoints and recovery
  - Creates: `packages/runtime/test/alignment-operation-store.test.mjs`
  - Tests: AC-2, AC-10, AC-11, AC-14
  - Covers: every stage/intent/fence/CAS/receipt crash point, predecessor mismatch and exact-byte reuse
  - Depends on: TASK-022, TASK-024, TASK-026

- [x] **TASK-028** [M] Implement crash-safe operation transactions
  - Creates: `packages/runtime/src/alignment-operation-store.mjs`
  - Plan/contract: § Goal store; `contracts/live-alignment.md` § Idempotency and Recovery
  - Satisfies: AC-2, AC-10, AC-11, AC-14
  - Depends on: TASK-027

### D. Isolation, Provider Transport and Research

- [x] **TASK-029** [M] [P] Test snapshots and macOS Seatbelt narrowing
  - Creates: `packages/runtime/test/macos-seatbelt.test.mjs`
  - Tests: AC-2, AC-12, AC-13, AC-14
  - Covers: private home/scratch, read-only snapshot, tracked/ignored/untracked write denial, denied Supervisor/unrelated reads, exact before/after inventory, violation records, loopback network and fail-closed hosts
  - Depends on: TASK-010, TASK-012

- [x] **TASK-030** [M] Implement analysis views and macOS probes
  - Creates: `packages/runtime/src/macos-seatbelt.mjs`
  - Plan/contract: § Worker boundary; `contracts/isolation-and-research.md` §§ Access Policy, Enforcement Probe, Consumer Integrity
  - Satisfies: AC-2, AC-12, AC-13, AC-14
  - Depends on: TASK-029

- [x] **TASK-031** [M] Test worker ownership, budgets and cleanup
  - Creates: `packages/runtime/test/agent-worker.test.mjs`
  - Tests: AC-2, AC-10, AC-11, AC-12, AC-13, AC-14
  - Covers: process tree, resource/output limits, sanitization, tracked/ignored/untracked write attempts and records, full consumer-inventory equality, fence abort and cleanup deadline
  - Depends on: TASK-016, TASK-022, TASK-026, TASK-030

- [x] **TASK-032** [M] Implement the bounded Agent worker
  - Creates: `packages/runtime/src/agent-worker.mjs`
  - Plan/contract: § Worker boundary; `contracts/isolation-and-research.md` §§ Resource Limits, Consumer Integrity
  - Satisfies: AC-2, AC-10, AC-11, AC-12, AC-13, AC-14
  - Depends on: TASK-031

- [x] **TASK-033** [M] Test the parent-owned provider proxy
  - Creates: `packages/runtime/test/provider-proxy.test.mjs`
  - Tests: AC-1, AC-4a, AC-10, AC-11, AC-12, AC-14
  - Covers: exact origin, dummy child credential, parent secret, reservations, redirects, bounds and usage
  - Depends on: TASK-022, TASK-026, TASK-032

- [x] **TASK-034** [M] Implement provider credential injection outside the Agent
  - Creates: `packages/runtime/src/provider-proxy.mjs`
  - Plan/contract: § Worker boundary; `contracts/isolation-and-research.md` § Provider Transport vs. Research Network
  - Satisfies: AC-1, AC-4a, AC-10, AC-11, AC-12, AC-14
  - Depends on: TASK-033

- [x] **TASK-035** [S] [P] Test exact-HTTPS research policy
  - Creates: `packages/runtime/test/research-policy.test.mjs`
  - Tests: AC-4a, AC-9, AC-12, AC-14
  - Covers: query construction, authority epoch, DNS/private/local denial, redirects and outbound data
  - Depends on: TASK-008, TASK-010, TASK-014

- [x] **TASK-036** [S] Implement deterministic research request policy
  - Creates: `packages/runtime/src/research-policy.mjs`
  - Plan/contract: § Controlled research gateway; `contracts/isolation-and-research.md` §§ Research origins, Research Request
  - Satisfies: AC-4a, AC-9, AC-12, AC-14
  - Depends on: TASK-035

- [x] **TASK-037** [M] Test gateway I/O, terminal triplets and recovery
  - Creates: `packages/runtime/test/research-gateway.test.mjs`
  - Tests: AC-4a, AC-9, AC-10, AC-11, AC-12, AC-14
  - Covers: reserve before I/O, exact GET, sanitized excerpt, atomic source/gap terminal and no replay
  - Depends on: TASK-022, TASK-026, TASK-036

- [x] **TASK-038** [M] Implement the controlled research gateway
  - Creates: `packages/runtime/src/research-gateway.mjs`
  - Plan/contract: § Controlled research gateway; `contracts/isolation-and-research.md` §§ Research Request–Operation Budget
  - Satisfies: AC-4a, AC-9, AC-10, AC-11, AC-12, AC-14
  - Depends on: TASK-037

### E. Deterministic Understanding and Human Packet

- [x] **TASK-039** [M] [P] Test claims, coverage, materiality and readiness
  - Creates: `packages/core/test/alignment-policy.test.mjs`
  - Tests: AC-3, AC-4, AC-4a, AC-5, AC-6, AC-7, AC-8, AC-12
  - Covers: claim ceilings, applicability, citations, conflicts/injection, ordering and no self-approval
  - Depends on: TASK-004, TASK-008, TASK-010, TASK-012

- [x] **TASK-040** [M] Implement deterministic alignment verdicts
  - Creates: `packages/core/src/alignment-policy.mjs`
  - Plan/contract: § Independent validator/projector; `contracts/live-alignment.md` §§ State Outcomes–Scope Request
  - Satisfies: AC-3, AC-4, AC-4a, AC-5, AC-6, AC-7, AC-8, AC-12
  - Depends on: TASK-039

- [x] **TASK-041** [M] Test the extended interaction contract and policy
  - Creates: `packages/core/test/live-alignment-interaction-policy.test.mjs`
  - Modifies: `packages/schema/test/contracts.test.mjs`
  - Tests: AC-4, AC-6, AC-7, AC-8, AC-10, AC-11
  - Covers: cancelled verdict, bundle-bound approval, traceability, bounded sections and legacy packets
  - Depends on: TASK-008, TASK-040

- [x] **TASK-042** [M] Implement alignment packet validation and policy
  - Modifies: `packages/schema/schemas/v1/interaction-packet.schema.json`, `packages/core/src/interaction-policy.mjs`
  - Plan/contract: § Goal Run integration; `contracts/live-alignment.md` §§ Interaction Packet, Scope Request
  - Satisfies: AC-4, AC-6, AC-7, AC-8, AC-10, AC-11
  - Depends on: TASK-041

- [x] **TASK-043** [M] Test bundle and compact-packet projection
  - Creates: `packages/project/test/live-alignment.test.mjs`
  - Tests: AC-3, AC-4, AC-4a, AC-5, AC-6, AC-7, AC-8, AC-12
  - Covers: outcome, boundaries, domains, criteria, decisions, sources, answers and packet bounds
  - Depends on: TASK-040, TASK-042

- [x] **TASK-044** [M] Implement validated bundle and packet projection
  - Creates: `packages/project/src/live-alignment.mjs`
  - Plan/contract: § Independent validator/projector; `contracts/live-alignment.md` §§ Deterministic Projector–Answering Decisions
  - Satisfies: AC-3, AC-4, AC-4a, AC-5, AC-6, AC-7, AC-8, AC-12
  - Depends on: TASK-043

### F. Resumable Orchestration

- [x] **TASK-045** [S] Test local phases and legal transitions
  - Creates: `packages/runtime/test/alignment-phase-machine.test.mjs`
  - Tests: AC-2, AC-8, AC-10, AC-11, AC-14
  - Covers: all phases, authority waits, attempts, retry, terminal cancel and post-expiry publication
  - Depends on: TASK-006, TASK-010

- [x] **TASK-046** [S] Implement deterministic phase transitions
  - Creates: `packages/runtime/src/alignment-phase-machine.mjs`
  - Plan/contract: § Live-alignment orchestrator; `contracts/live-alignment.md` §§ Live Advance, State Outcomes, Recovery
  - Satisfies: AC-2, AC-8, AC-10, AC-11, AC-14
  - Depends on: TASK-045

- [x] **TASK-047** [M] Test operation start, planning and research pauses
  - Creates: `packages/runtime/test/live-alignment-planning.test.mjs`
  - Tests: AC-1, AC-2, AC-4a, AC-9, AC-10, AC-11, AC-12, AC-14, AC-15
  - Covers: stable operation, snapshot, authority, planning, query set, renew/deny and source retention
  - Depends on: TASK-020, TASK-028, TASK-032, TASK-034, TASK-038, TASK-046

- [x] **TASK-048** [M] Implement start, planning and research phases
  - Creates: `packages/runtime/src/live-alignment.mjs`
  - Plan/contract: § Live-alignment orchestrator; `contracts/live-alignment.md` §§ Static Advance, Live Advance
  - Satisfies: AC-1, AC-2, AC-4a, AC-9, AC-10, AC-11, AC-12, AC-14, AC-15
  - Depends on: TASK-047

- [x] **TASK-049** [M] Test synthesis, fresh validation and publication
  - Creates: `packages/runtime/test/live-alignment-synthesis.test.mjs`
  - Tests: AC-2, AC-3, AC-4, AC-4a, AC-5, AC-6, AC-7, AC-8, AC-10, AC-11, AC-12, AC-14, AC-15
  - Covers: distinct invocation, disagreement, sanitizer, projector, sources and expiry-safe commit
  - Depends on: TASK-044, TASK-048

- [x] **TASK-050** [M] Implement synthesis, validation and publication
  - Modifies: `packages/runtime/src/live-alignment.mjs`
  - Plan/contract: §§ Live orchestrator, Independent validator/projector; all `contracts/live-alignment.md`
  - Satisfies: AC-2, AC-3, AC-4, AC-4a, AC-5, AC-6, AC-7, AC-8, AC-10, AC-11, AC-12, AC-14, AC-15
  - Depends on: TASK-049

- [x] **TASK-051** [M] Test retry, cancellation and restart
  - Creates: `packages/runtime/test/live-alignment-recovery.test.mjs`
  - Tests: AC-10, AC-11, AC-13, AC-14, AC-16
  - Covers: failed-phase retry, no auto retry, attempt ceiling, lease recovery, races and no consumer changes
  - Depends on: TASK-050

- [x] **TASK-052** [M] Implement retry, cancellation and reconciliation
  - Modifies: `packages/runtime/src/live-alignment.mjs`, `packages/runtime/src/alignment-operation-store.mjs`
  - Plan/contract: § Live orchestrator; `contracts/live-alignment.md` § Idempotency and Recovery
  - Satisfies: AC-10, AC-11, AC-13, AC-14, AC-16
  - Depends on: TASK-051

### G. Goal Run and CLI Integration

- [x] **TASK-053** [M] Test exact Agent authority binding
  - Creates: `packages/runtime/test/live-alignment-authority.test.mjs`
  - Tests: AC-1, AC-2, AC-9, AC-10, AC-11, AC-14, AC-15
  - Covers: descriptor/profile/model/origins/phases/budgets, narrowing, stale values and renewal
  - Depends on: TASK-014, TASK-020, TASK-052

- [x] **TASK-054** [M] Integrate static Agent selection and authorization
  - Modifies: `packages/project/src/onboard.mjs`, `packages/runtime/src/capability-authorization.mjs`
  - Plan/contract: § Goal Run integration; `contracts/live-alignment.md` § Static Advance
  - Satisfies: AC-1, AC-2, AC-9, AC-10, AC-11, AC-14, AC-15
  - Depends on: TASK-053

- [x] **TASK-055** [M] Test authenticated answers and stale refusal
  - Creates: `packages/runtime/test/alignment-answer.test.mjs`
  - Tests: AC-4, AC-6, AC-8, AC-10, AC-12
  - Covers: exact packet/question/option, TTY, signed receipt, immutable answer, replay and forgery refusal
  - Depends on: TASK-014, TASK-044, TASK-052

- [x] **TASK-056** [M] Implement Supervisor-attested answers
  - Creates: `packages/runtime/src/alignment-answer.mjs`
  - Modifies: `packages/runtime/src/supervisor-approval.mjs`
  - Plan/contract: § Goal Run integration; `contracts/live-alignment.md` § Answering Decisions
  - Satisfies: AC-4, AC-6, AC-8, AC-10, AC-12
  - Depends on: TASK-055

- [x] **TASK-057** [M] Test checkpoint publication and derived scope
  - Creates: `packages/runtime/test/live-alignment-goal-store.test.mjs`
  - Tests: AC-2, AC-4, AC-6, AC-7, AC-8, AC-10, AC-11, AC-16
  - Covers: exact artifacts, answer resume and existing events only: `question.answered`, `research.recorded`, `artifact.written`, `interaction.published`, `state.transitioned`, `run.cancelled`; each live-event projection has an exact data-field allowlist and rejects unknown keys, secrets and Agent prose
  - Depends on: TASK-028, TASK-052, TASK-056

- [x] **TASK-058** [M] Integrate with the Goal Run checkpoint store
  - Modifies: `packages/runtime/src/goal-run-store.mjs`
  - Plan/contract: § Goal Run integration; `contracts/live-alignment.md` §§ State Outcomes, Scope Request, Recovery; implements the closed live-event data projector before append
  - Satisfies: AC-2, AC-4, AC-6, AC-7, AC-8, AC-10, AC-11, AC-16
  - Depends on: TASK-057

- [x] **TASK-059** [M] Test the complete CLI surface
  - Modifies: `packages/cli/test/cli.test.mjs`
  - Tests: AC-1, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-15, AC-16
  - Covers: advance/status, authorities, answer, retry/cancel, scope, foreground approval and no delivery commands
  - Depends on: TASK-054, TASK-056, TASK-058

- [x] **TASK-060** [M] Expose live alignment through the CLI
  - Modifies: `packages/cli/src/cli.mjs`
  - Plan/contract: § Goal Run integration; `contracts/live-alignment.md` §§ Static Advance, Live Advance, Answers, Errors
  - Satisfies: AC-1, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-15, AC-16
  - Depends on: TASK-059

### H. Developer Review and End-to-End Proof

- [x] **TASK-061** [S] Test review-client mapping
  - Modifies: `apps/review-ui/test/review-client.test.mjs`
  - Tests: AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-12
  - Covers: outcomes, coverage, evidence/conflicts/unknowns, decisions, labels and no secrets
  - Depends on: TASK-044, TASK-060

- [x] **TASK-062** [S] Implement review-client mapping for the live brief
  - Modifies: `apps/review-ui/lib/review-client.mjs`, `apps/review-ui/lib/review-client.d.mts`
  - Plan/contract: § Human review; `contracts/live-alignment.md` § Interaction Packet
  - Satisfies: AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-12
  - Depends on: TASK-061

- [x] **TASK-063** [M] Write real-browser review-page functional/system tests
  - Creates: `apps/review-ui/test/live-alignment-page.e2e.mjs`
  - Modifies: `apps/review-ui/package.json`, `apps/review-ui/package-lock.json`
  - Tests: AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-12
  - Covers: production build, browser rendering, question/ready fixtures, source navigation, responsive view, console/network errors and screenshots/traces
  - Depends on: TASK-062

- [x] **TASK-064** [M] Implement the live Alignment Brief page
  - Modifies: `apps/review-ui/app/page.tsx`
  - Plan/contract: § Human review; `contracts/live-alignment.md` § Interaction Packet
  - Satisfies: AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-12
  - Depends on: TASK-063

- [x] **TASK-065** [M] Prove provider-neutral full-pipeline conformance
  - Creates: `packages/runtime/test/live-alignment-adapter-conformance.test.mjs`
  - Tests: AC-2, AC-3, AC-4, AC-4a, AC-6, AC-7, AC-8, AC-10, AC-12, AC-15
  - Covers: the same goal, snapshot and answers with separately approved adapter-bound authorities yield semantic equivalence in normalized status, trust classes, event meanings and developer packets while asserting descriptor, authority, operation, invocation and attempt IDs/digests are necessarily different
  - Depends on: TASK-020, TASK-050, TASK-058, TASK-060

- [x] **TASK-066** [M] Add fake-Agent end-to-end acceptance proof
  - Creates: `packages/runtime/test/live-alignment-e2e.test.mjs`
  - Tests: AC-1 through AC-16
  - Covers: static advance → authority → analysis → research → answer/resume → ready scope with consumer filesystem equality
  - Depends on: TASK-020, TASK-060, TASK-064, TASK-065

- [x] **TASK-067** [M] Add crash/race/hostile-input system proof
  - Creates: `packages/runtime/test/live-alignment-adversarial.test.mjs`
  - Tests: AC-4a, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-16
  - Covers: durable crash points, cancel race, killed services, unknown requests, injection, secret canaries, symlinks and budgets
  - Depends on: TASK-066

- [x] **TASK-068** [S] Add opt-in real-Codex macOS smoke proof
  - Creates: `packages/runtime/test/live-alignment-codex-smoke.test.mjs`
  - Tests: AC-2, AC-3, AC-11, AC-12, AC-13, AC-14, AC-15
  - Covers: registered Codex adapter, enforcement first, explicit opt-in, no default CI credentials, consumer immutability and cleanup
  - Depends on: TASK-018, TASK-020, TASK-032, TASK-034, TASK-060, TASK-067

- [x] **TASK-069** [S] Document the bounded v0 workflow and evidence
  - Modifies: `README.md`
  - Creates: `specs/single-agent-goal-runtime/walkthrough.md`
  - Satisfies: AC-1 through AC-16
  - Includes: hosts, authorities, review-by-exception, retry/cancel, browser proof, smoke test and delivery exclusion
  - Depends on: TASK-068

## Gate 3 Verification

- 32 explicit test→implementation pairs run through TASK-064; TASK-065–068 add cross-adapter,
  full-flow, adversarial and real-adapter proof after component implementation.
- Structural schema, cross-record integrity and hostile-output sanitization have separate owners.
- Adapter tests live under the root test glob; Codex is registered, while the scripted adapter is
  injected only in tests and never expands the production registry or authority surface.
- Goal Run integration reuses the existing event vocabulary; no frozen contract is invented.
- No task changes a consumer repository or enables implementation, PR, merge, deploy or production mutation.

## Legend

- `[S]` Small — under 1 hour
- `[M]` Medium — 1–3 hours
- `[P]` Parallelizable — no shared write dependency with another `[P]` task at the same level
