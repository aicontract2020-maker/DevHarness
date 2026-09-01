# Technical Plan: Live Goal Alignment

Status: Gate 2 amendment approved by developer  
Date: 2026-09-01  
Spec: `specs/single-agent-goal-runtime/spec.md` v1.0.1

## Architecture Overview

Extend the existing two-step Goal Run rather than introduce a second orchestrator. The first
`advance` remains static and now binds a selected Agent adapter descriptor plus an exact
`agent-runtime` capability request. After approval, a second `advance` creates one stable alignment
operation with bounded attempts, runs analysis planning, optional controlled research, synthesis and
an independent validation invocation behind a fail-closed worker boundary, and projects the records
into either a question-blocked or scope-ready Alignment Brief. A developer can answer a surfaced
decision inside the same Goal Run; the next `advance` resumes from that immutable answer. Provider
transport, optional research traffic and consumer-project access remain three separate policy
channels.

## Execution Flow

```text
goal (received)
  -> advance --agent codex --agent-profile codex-readonly-analysis-v1
       -> adapter probe (no model invocation)
       -> static discovery + onboarding + exact agent-runtime request
       -> clarifying / non-approvable brief
  -> request-capability agent-runtime -> foreground approval
  -> advance
       -> rebuild current snapshot + validate exact authorities
       -> derive immutable operation id and first attempt ids
       -> worker-isolation preflight
       -> analyst research plan (read-only, web tools disabled)
       -> when research is material: publish exact query/origin authority request and pause
  -> optional approve network-research -> advance resumes same operation
       -> allow-listed research gateway
       -> analyst synthesis (fresh invocation over local + sanitized research sources)
       -> fresh independent validator invocation
       -> deterministic coverage / materiality / traceability projector
       -> question-blocked brief OR scope-ready brief
       -> atomic checkpoint append
  -> question blocked: answer -> new checkpoint -> advance again
  -> request-scope (only for ready brief) -> foreground approval
```

No consumer command, source edit, pull request or feature-verification claim occurs in this flow.

## Component Breakdown

### 1. Portable Agent contracts

- **Responsibility:** Define adapter descriptor, immutable invocation, normalized attempt receipt,
  goal-analysis and independent-validation records.
- **Location:** `packages/schema/schemas/v1/agent-*.schema.json`,
  `packages/schema/schemas/v1/goal-analysis*.schema.json`
- **Accepts:** Portable IDs, hashes, policies, source references and bounded final results.
- **Returns:** Strict JSON documents with no provider-specific keys or secret values.
- **AC Coverage:** AC-2, AC-3, AC-4, AC-4a, AC-5, AC-10, AC-11, AC-12, AC-14, AC-15.

### 2. Agent registry and adapter protocol

- **Responsibility:** Resolve a named adapter, probe its installed executable/capabilities without
  invoking a model, validate descriptor compatibility, and normalize start/cancel/result behavior.
- **Location:** `packages/runtime/src/agent-adapter.mjs`
- **Accepts:** Adapter name plus injected registry/process services.
- **Returns:** Validated `AgentAdapter` or a structured unsupported/blocking result.
- **AC Coverage:** AC-1, AC-2, AC-10, AC-11, AC-14, AC-15.

### 3. Codex adapter

- **Responsibility:** Implement the first adapter using non-interactive structured output, an
  ephemeral session, ignored user customization and rules, read-only command sandbox, bounded
  process I/O and explicit cancellation. Built-in web access is disabled; approved research enters
  only as a DevHarness source artifact. A runtime-owned loopback provider proxy injects credentials
  outside the Agent process; the child receives no real provider secret.
- **Location:** `adapters/agents/codex/index.mjs`
- **Accepts:** Portable invocation, private execution context and output schema path.
- **Returns:** Normalized attempt metadata plus a final structured output file; raw reasoning/events
  are consumed for status/usage and discarded.
- **AC Coverage:** AC-2, AC-3, AC-4a, AC-11, AC-12, AC-14, AC-15.

### 4. Worker boundary and resource monitor

- **Responsibility:** Create a temporary analysis view, enforce consumer non-writing and default-deny
  access, expose only the exact provider authentication/transport channel, monitor the full process
  tree, atomically reserve every provider request before forwarding, sanitize bounded logs, verify
  consumer content before/after and guarantee cleanup.
- **Location:** `packages/runtime/src/agent-worker.mjs`
- **Accepts:** Invocation, adapter, repository snapshot and private runtime paths.
- **Returns:** Integrity-checked attempt receipt and bounded artifacts, or a fail-closed result.
- **AC Coverage:** AC-2, AC-10, AC-11, AC-12, AC-13, AC-14.

The first production backend is macOS. It launches the Agent inside a generated Seatbelt profile
using `/usr/bin/sandbox-exec`, a private empty home, a read-only immutable analysis snapshot, one
writable attempt directory, denied access to the consumer/Supervisor/other user paths and network
limited to a runtime-owned loopback provider proxy. The parent proxy alone holds the real provider
credential and forwards only the selected descriptor's exact HTTPS control-plane origin. Human
approval binds a static profile-template digest; each operation derives and records a dynamic instance
digest whose permissions must be a strict subset. The probe compiles and adversarially exercises the
exact instance before every operation. If this deprecated but
locally available backend, profile, proxy binding or resource monitor cannot prove the contract, the
real adapter is unsupported and never starts. Tests use an injected fake boundary; other operating
systems fail closed until they add an equivalent backend.

### 5. Controlled research gateway

- **Responsibility:** Retrieve only explicitly approved HTTPS origins, deny private/local targets and
  cross-origin redirects, reserve every exact GET recipe before network I/O, emit only sanitized cited
  extracts, and prevent repository/environment content from entering outbound requests.
- **Location:** `packages/runtime/src/research-gateway.mjs`
- **Accepts:** Exact approved origins and non-sensitive query strings from a validated research plan.
- **Returns:** Bounded source records with final URL, title, retrieval time, digest and excerpt.
- **AC Coverage:** AC-4a, AC-9, AC-12, AC-14.

Provider API traffic required to invoke the selected adapter is declared inside `agent-runtime` and
is not research authority. The Agent cannot use that channel for arbitrary web access. When no
research authority exists, the gateway is absent and analysis records the missing research explicitly.

### 6. Live-alignment orchestrator

- **Responsibility:** Derive a stable operation from trusted runtime inputs, validate authority,
  enforce idempotency, run plan/research/synthesis/validation attempts, and convert all terminal paths
  into durable records without directly trusting Agent classifications.
- **Location:** `packages/runtime/src/live-alignment.mjs`
- **Accepts:** Current run, current checkpoint, live snapshot, onboarding artifact, verified
  Supervisor receipts and adapter registry.
- **Returns:** New events, run snapshot, scorecard, interaction packet and source artifacts ready for
  atomic append.
- **AC Coverage:** AC-1 through AC-15.

### 7. Independent analysis validator and projector

- **Responsibility:** Run a fresh validator invocation, independently derive applicable domains from
  trusted inventory, verify cited locations and claim-class ceilings, detect source conflicts and
  prompt injection, rank material decisions deterministically, and produce the compact brief.
- **Location:** `packages/project/src/live-alignment.mjs`,
  `packages/core/src/alignment-policy.mjs`
- **Accepts:** Producer result, validator result, live snapshot and original developer goal.
- **Returns:** Validated goal-analysis bundle and question-blocked or scope-ready Alignment Brief.
- **AC Coverage:** AC-3, AC-4, AC-4a, AC-5, AC-6, AC-7, AC-8, AC-12.

Neither producer nor validator can directly assign final runtime claim status, applicability,
materiality, readiness or authority. Deterministic policy computes those fields and fails closed when
the two analyses disagree on a material claim.

### 8. Goal Run and approval integration

- **Responsibility:** Add stage-aware `agent-runtime` authorization, make second `advance` resumable,
  bind every decision and answer to source mappings, recover only demonstrably stale operation
  leases, and derive a scope request from the current ready brief rather than caller-supplied hashes.
- **Location:** `packages/cli/src/cli.mjs`, `packages/project/src/onboard.mjs`,
  `packages/runtime/src/capability-authorization.mjs`, `packages/runtime/src/goal-run-store.mjs`,
  `packages/core/src/interaction-policy.mjs`
- **Accepts:** CLI intent and trusted current run state.
- **Returns:** Exact authority request, durable checkpoint, compact status, immutable developer
  answer and derived scope request.
- **AC Coverage:** AC-1, AC-4, AC-6, AC-7, AC-8, AC-10, AC-15.

## Technology Choices

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime language | Existing Node.js ES modules and built-ins | Constitution requires it; no new runtime dependency |
| Portable shapes | JSON Schema 2020-12 within current validator subset | Existing contract registry and fixtures remain authoritative |
| First adapter | Locally installed Codex CLI, probed at runtime | Provides non-interactive JSONL, output-schema, final-output and read-only modes without coupling core |
| Output handoff | Schema-constrained final JSON file, never stdout prose | Separates status stream from portable result and allows exact size/hash validation |
| Invocation | Child process with stdin prompt and explicit argv array | Avoids shell interpretation and command injection |
| First isolation backend | macOS Seatbelt + immutable snapshot + loopback credential proxy | Delivers one concrete enforceable host path while every unsupported host fails closed |
| Research | Runtime-owned HTTPS gateway; Agent web tools disabled | Separates provider transport from source retrieval and enforces destination/data policy |
| Persistence | Existing external atomic checkpoint store | Preserves resumability and consumer separation |
| Human review | Existing interaction packet and review page | Avoids a parallel UI or raw artifact review workflow |

## Integration Points

- **Supervisor approvals:** existing signed requests/receipts remain the only authority source.
- **Repository discovery:** live snapshot supplies repository identity, revision, inventory and
  deterministic applicable-domain inputs.
- **Goal store:** current pointer and artifacts remain the durable source; a completed operation is
  indexed by immutable semantic input hash, contains numbered attempts and attaches its later exact
  research plan through an append-only journal.
- **Review API/UI:** existing interaction endpoint renders new sections/decisions. This slice adds the
  authenticated CLI `answer` mutation; a browser write endpoint remains out of scope.
- **Codex authentication:** private adapter context may expose only the provider authentication path
  and provider control-plane transport declared in `agent-runtime`; values never enter artifacts.

## AC Coverage Map

| AC | Component(s) | Contract(s) |
|----|--------------|-------------|
| AC-1 | registry, Goal Run integration | `contracts/live-alignment.md`, `contracts/isolation-and-research.md` |
| AC-2 | invocation contracts, adapter, worker | `contracts/agent-adapter.md`, `contracts/isolation-and-research.md` |
| AC-3 | contracts, orchestrator, projector | `contracts/agent-adapter.md`, `contracts/live-alignment.md` |
| AC-4 | validator/projector, Goal Run integration | `contracts/live-alignment.md` |
| AC-4a | adapter, research gateway, projector | `contracts/isolation-and-research.md`, `contracts/live-alignment.md` |
| AC-5 | validator/projector | `contracts/live-alignment.md` |
| AC-6 | validator/projector, review integration | `contracts/live-alignment.md` |
| AC-7 | validator/projector, approval integration | `contracts/live-alignment.md` |
| AC-8 | validator/projector | `contracts/live-alignment.md` |
| AC-9 | research gateway | `contracts/isolation-and-research.md` |
| AC-10 | orchestrator, Goal store | `contracts/agent-adapter.md`, `contracts/live-alignment.md` |
| AC-11 | adapter, worker, orchestrator | `contracts/agent-adapter.md`, `contracts/isolation-and-research.md` |
| AC-12 | adapter, worker, gateway, projector | all three contracts |
| AC-13 | worker | `contracts/isolation-and-research.md` |
| AC-14 | adapter, worker, gateway | `contracts/agent-adapter.md`, `contracts/isolation-and-research.md` |
| AC-15 | contracts, registry, orchestrator | `contracts/agent-adapter.md`, `contracts/live-alignment.md` |
| AC-16 | all | `contracts/live-alignment.md` |

## Compatibility and Migration

- New schemas are additive. Existing Goal Runs and packets without Agent artifacts remain readable.
- `agent-runtime` is appended to the capability enum; existing capability documents remain valid.
- `alignment-answer` is appended to the approval-gate enum. Live-alignment phase detail remains in
  the exact `OperationJournalRecord` variants; Goal Run checkpoints reuse the existing
  `question.asked`, `question.answered`, `research.recorded`, `artifact.written`,
  `interaction.published`, `attention.requested`, `attention.resolved`, `state.transitioned` and
  `run.cancelled` events. The run-event enum is unchanged and old requests/events remain valid.
- `reversibility` is optional for legacy capability records but required by policy for new
  `agent-runtime` and `network-research` requests.
- `advance` preserves current first-call behavior when no adapter is selected, but live alignment
  requires an explicit adapter selection in the static checkpoint.
- Decision traceability becomes mandatory only for newly generated live-alignment packets; legacy
  stored packets remain readable through schema-valid compatibility handling.
- No consumer repository migration and no database migration are required.

## Test Strategy

1. Schema fixtures cover valid/invalid portable documents, extra provider keys, secret-like fields,
   size/count boundaries and cross-record identity/hash mismatches.
2. Fake adapter contract tests cover probe/start/cancel, producer/validator separation, malformed
   output, timeout, exit, idempotency, retries and adapter drift.
3. Worker adversarial tests attempt consumer writes (tracked/ignored/untracked), unrelated reads,
   Supervisor reads, network use, fork bombs within safe fixtures, output overflow and memory/process
   limits; unsupported host enforcement must block before Agent start.
4. Research gateway tests cover exact-origin allowlists, DNS/private-address rejection, redirects,
   outbound-body restrictions, citation fields, content limits, crash-after-reservation no-replay and
   failure behavior.
5. Projector tests cover all domains, claim ceilings, unsupported citations, source conflicts,
   prompt injection, materiality ordering, omitted counts, questions and ready scope packets.
6. Goal integration tests cover two-step advance, question/answer/resume, stale-answer refusal,
   forged/non-TTY answer refusal, authority renewal/denial/partial research, crash recovery at every
   staging/intent/CAS/receipt boundary, retry/cancel races, historical replay and
   derived scope requests without mutating a temporary consumer Git repository.
7. A real Codex smoke test is opt-in and runs only after the enforcement probe passes; normal CI uses
   the fake adapter and never consumes network/account credentials.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| macOS backend is unavailable/deprecated or cannot enforce a profile | High | High | Exact Seatbelt/proxy probe blocks real invocation; other hosts remain explicitly unsupported |
| Provider CLI flags or event formats drift | Medium | High | Probe exact version/capabilities; argv builder tests; normalized final file is authoritative |
| Provider authentication exposure reaches worker tools | Medium | High | Parent loopback proxy injects credential; child receives only a dummy token and proxy endpoint |
| Prompt injection alters scope or hides conflict | High | High | Fixed policy, tagged untrusted sources, deterministic projector and fresh independent validator |
| Validator repeats producer errors | Medium | High | Fresh invocation, source-first context, claim-class ceiling, disagreement blocks, human scope gate |
| Research leaks source or follows unsafe redirect | Medium | High | Runtime-only allowlisted gateway, no arbitrary request bodies, DNS/IP recheck on every redirect |
| Process tree escapes cleanup or exhausts host | Medium | High | Group ownership, continuous resource monitor, bounded streams/scratch, forced kill and cleanup proof |
| Operation reruns after crash | Medium | High | Stable semantic operation key, numbered attempts, intent/commit journal and checkpoint reconciliation |
| Legacy interaction packets become unreadable | Low | High | Additive contract fields and version-aware policy; regression fixtures for stored v1 packets |
| Agent output looks authoritative in UI | Medium | High | Preserve claim classes, label Agent analysis, never issue E2/E3 evidence from alignment |
| Agent or same-user process forges a developer answer | Medium | High | Exact Supervisor-signed foreground TTY decision; CLI parameters alone never create an answer |
| Dynamic sandbox path/port invalidates prior approval | High | High | Approve static template digest; prove every runtime instance is a strict narrowing |
| Human research approval wait exhausts execution time | High | Medium | Stop all processes while waiting and meter active execution separately from durable wait |

## Out of Scope (Technical)

- Write-capable workspaces, implementation task prompts and repair loops.
- Multi-Agent parallel scheduling or stable cross-provider adapter API declaration.
- Real-surface verification, delivery proof, PR mutation, CI subscription, merge and deploy.
- Hosted Supervisor and production-grade independent human authentication.
