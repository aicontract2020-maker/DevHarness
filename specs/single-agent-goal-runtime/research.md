# Research: Single-Agent Goal Runtime

Status: Gate R approved by developer · Date: 2026-08-31  
Question: How does DevHarness currently advance a Goal Run, and where can a first real coding-agent invocation be inserted without weakening its trust and consumer-repository boundaries?

## Findings

### F-1 — Goal intake is durable but deliberately does not invoke an Agent

`goal` requires a clean committed repository, creates a revision-bound run and stores its first
event and blocked scorecard outside the consumer repository. The CLI explicitly describes this
command as non-agent execution. (`packages/cli/src/cli.mjs:252-276`,
`packages/cli/src/cli.mjs:57-58`)

### F-2 — `advance` currently has one static advance path

The public `advance` command accepts only a run in `received`, performs discovery/readiness and
onboarding, creates a static understanding checkpoint, then stops in `clarifying`. A second call is
rejected. That one path records two state transitions: `received -> discovering -> clarifying`.
(`packages/cli/src/cli.mjs:295-349`, `packages/project/src/alignment.mjs:138-150`,
`packages/cli/test/cli.test.mjs:348-404`)

### F-3 — The state model already names the complete intended lifecycle

The deterministic state machine contains discovery, clarification, research, specification, scope
approval, planning, staffing, execution, verification, repair, review, delivery and terminal states.
Only the scope and delivery transitions have additional trusted-approval/readiness predicates today.
(`packages/core/src/state-machine.mjs:3-42`, `packages/core/src/state-machine.mjs:61-104`)

### F-4 — The event vocabulary already covers Agent-era milestones

The append-only event contract includes questions, research, artifacts, plans, staffing, task
dispatch/completion, evidence, criteria, review, repair, budgets and terminal events. Event-stream
validation requires contiguous sequence numbers, one run identity, unique IDs and monotonic time.
Event `data` accepts any object, so the contract does not yet provide event-type-specific semantic
payload validation.
(`packages/schema/schemas/v1/run-event.schema.json:25-49`,
`packages/schema/schemas/v1/run-event.schema.json:54-56`, `packages/core/src/event-stream.mjs:1-44`)

### F-5 — Replay trusts event semantics only for a narrow subset

Goal Run replay currently mutates the snapshot for state transitions, gate decisions and terminal
events. Other valid event types are retained in the stream but do not alter snapshot fields. Replay
checks transition topology through `allowedTransitions`; it does not re-run the trusted scope and
delivery predicates implemented by `evaluateTransition`.
(`packages/core/src/goal-run.mjs:82-119`, `packages/core/src/state-machine.mjs:49-104`)

### F-6 — Checkpoint persistence is atomic, locked and artifact-bound

Every checkpoint validates the full combined event stream, reconstructed snapshot, scorecard,
interaction packet and artifact hashes. It writes into a staging directory, atomically promotes the
checkpoint and advances a small current pointer while holding a create-only append lock.
(`packages/runtime/src/goal-run-store.mjs:220-285`)

### F-7 — The current Alignment Brief is intentionally non-approvable

Static alignment records the original goal, repository snapshot and onboarding plan; missing runtime
proof and missing acceptance criteria remain blocking. The packet exposes inspect/cancel actions but
no approval action, then transitions `received -> discovering -> clarifying`.
(`packages/project/src/alignment.mjs:35-46`, `packages/project/src/alignment.mjs:93-124`,
`packages/project/src/alignment.mjs:138-150`)

### F-8 — Human interaction is bounded, with incomplete decision traceability

Interaction packets support Alignment Brief, Decision Queue, Progress Pulse and Delivery Brief.
They allow at most three decisions, require source-artifact mappings for section items, and require
exactly one recommended action. Ready alignment/delivery packets must request an explicit gate
approval. Decision objects themselves have no source-reference field, and current policy checks
traceability for section items only.
(`packages/schema/schemas/v1/interaction-packet.schema.json:33-45`,
`packages/schema/schemas/v1/interaction-packet.schema.json:112-161`,
`packages/core/src/interaction-policy.mjs:23-48`,
`packages/core/src/interaction-policy.mjs:70-98`)

### F-9 — Agent adapters are documented intent, not an executable milestone capability

The README reserves `adapters/agents` for Codex, Claude Code, Cursor and future adapters. The
Milestone 2 status explicitly lists agent invocation, live evidence, clarification, research and
requirements as remaining work. The architecture already assigns adapters capability discovery;
start/continue/interrupt/cancel; context/artifact delivery; workspace/tool policy; and structured
result/usage reporting.
(`README.md:139-160`, `docs/mvp.md:58-67`, `docs/architecture.md:240-250`)

### F-10 — Existing isolated execution is a verifier, not an Agent worker

The verification runtime compiles only developer-declared commands, binds them to a clean revision
and external worktree, restricts inherited environment keys and captures process output. Its allowed
command kinds are build/test/lint/typecheck/verify; it is not an open-ended Agent executor.
(`packages/runtime/src/verify.mjs:20-20`, `packages/runtime/src/verify.mjs:49-127`,
`packages/runtime/src/verify.mjs:162-200`)

### F-11 — Scheduling contracts exist without worker dispatch

Task resource conflicts and safe waves can be planned, but durable leases, concurrent worker
dispatch, integration execution and recovery are still future runtime layers.
(`docs/verification-and-parallel-execution.md:31-52`,
`docs/verification-and-parallel-execution.md:65-67`)

### F-12 — Same-user Supervisor isolation is a declared blocker

Foreground TTY approval is not independent authentication, and an unrestricted same-user worker
could reach Supervisor material. The current design requires a separate OS identity or equivalent
capability sandbox before production-grade autonomous delivery.
(`README.md:66-66`, `docs/supervisor-provenance.md:61-75`)

### F-13 — Feature-complete proof cannot yet be issued for every platform

The current runtime can own a local service and execute an isolated command, but sealed browser,
simulator, database, deployment, load and canary collectors remain pending. A first Agent slice
therefore cannot honestly claim that arbitrary feature delivery is complete.
(`docs/verification-and-parallel-execution.md:5-29`,
`docs/supervisor-provenance.md:71-76`)

### F-14 — Current contracts separate rich runtime artifacts from developer review

The review page consumes event-backed scorecards and compact interaction packets rather than raw
Agent files. Product rules require detailed artifacts to remain runtime memory and audit evidence,
with the developer normally seeing bounded briefs and exceptions.
(`README.md:74-120`, `AGENTS.md:16-25`)

### F-15 — The capability vocabulary has no Agent-runtime authority

The shared capability contract enumerates dependency, network, process, container, browser,
simulator, database, credential, version-control, deployment and destructive authorities, but no
Agent-runtime capability. Current authority policy requires an independent current-revision human
receipt for explicit, human-only or high-risk requests.
(`packages/schema/schemas/v1/common.schema.json:87-101`,
`packages/core/src/authority-policy.mjs:3-23`)

### F-16 — Checkpoint append locks have no stale-owner recovery

Checkpoint persistence takes a create-only lock and always removes it in the local `finally` path.
The lock contains no owner/lease metadata, so a process crash between creation and cleanup can leave
a lock that later advances cannot distinguish from active work.
(`packages/runtime/src/goal-run-store.mjs:220-229`,
`packages/runtime/src/goal-run-store.mjs:259-285`)

## Relevant Files
| Area | Current responsibility |
|------|------------------------|
| `packages/cli/src/cli.mjs` | Goal intake, one static advance, status and explicit authority commands (`packages/cli/src/cli.mjs:250-379`) |
| `packages/core/src/goal-run.mjs` | Goal creation, event construction and deterministic replay (`packages/core/src/goal-run.mjs:21-119`) |
| `packages/core/src/state-machine.mjs` | Allowed lifecycle transitions and approval predicates (`packages/core/src/state-machine.mjs:3-112`) |
| `packages/project/src/alignment.mjs` | Static understanding checkpoint and first Alignment Brief (`packages/project/src/alignment.mjs:20-150`) |
| `packages/runtime/src/goal-run-store.mjs` | Atomic append-only run/checkpoint persistence (`packages/runtime/src/goal-run-store.mjs:101-285`) |
| `packages/runtime/src/verify.mjs` | Declared-command isolated verification lifecycle (`packages/runtime/src/verify.mjs:49-200`) |
| `packages/schema/schemas/v1/` | Portable run, event, task, evidence and interaction contracts (`packages/schema/schemas/v1/run-event.schema.json:1-58`) |
| `apps/review-ui/` | Compact developer Decision Surface (`README.md:74-100`) |

## Existing Constraints Discovered

- Adapter output cannot be treated as trusted evidence or authority; runtime validation and
  Supervisor-issued proof remain separate. (`AGENTS.md:10-25`)
- Agent-specific process details must stay behind an adapter boundary. (`AGENTS.md:27-35`)
- Runtime state, outputs and workspaces remain outside the consumer by default.
  (`constitution.md:7-15`, `constitution.md:31-35`)
- Commands discovered from a repository are not automatically authorized to execute.
  (`constitution.md:9-11`, `constitution.md:59-65`)
- The first implementation should be single-Agent and must not add multi-Agent scheduler breadth.
  (`docs/mvp.md:58-95`, `docs/mvp.md:160-162`)
- Automatic merge and deployment remain excluded from v0. (`constitution.md:61-61`)

## Information Flow Today

1. `goal` discovers and pins a clean repository revision, creates `run.created`, a blocked
   scorecard and external run storage. (`packages/cli/src/cli.mjs:250-276`)
2. `advance` reloads and revalidates that run/revision, then derives readiness and onboarding from
   static repository discovery. (`packages/cli/src/cli.mjs:295-317`)
3. The alignment projector writes three source artifacts, a compact non-approvable packet and six
   new events. (`packages/project/src/alignment.mjs:35-39`,
   `packages/project/src/alignment.mjs:101-145`)
4. The store validates and atomically promotes the checkpoint. (`packages/runtime/src/goal-run-store.mjs:220-281`)
5. `status` and the read-only review service reload the current snapshot, scorecard and packet.
   (`packages/cli/src/cli.mjs:279-292`, `packages/runtime/src/goal-run-store.mjs:164-199`)

## Conflicts
- `[CONFLICT]` README product language describes clarification, research, planning, implementation
  and evidence-backed PR preparation as what DevHarness does, while the executable boundary says
  Agent invocation and later governed transitions remain unimplemented. The README marks the system
  as a prototype, but the first-screen promise can still be read as current behavior.
  (`README.md:3-11`, `README.md:50-72`, `docs/mvp.md:58-67`)

## Not Investigated
- A production OS-level worker-isolation implementation for macOS, Linux and Windows.
- GitHub PR mutation and CI subscription behavior, which are outside the first Agent invocation slice.
- Exact portability behavior of Claude Code and Cursor CLI surfaces.
- Mobile, desktop and hosted/cloud Agent runtimes.

## Open Questions for the Spec
1. Should the first slice stop after a live, structured, still-non-approvable Agent analysis, or also
   generate acceptance criteria that make scope approval available?
2. The current capability vocabulary does not contain Agent invocation. Should a read-only Agent use
   a new explicit `agent-runtime` capability or reuse the broader `process-execution` capability?
3. Must v0 invoke a locally installed Agent CLI, or may it call a hosted API directly?
4. Which adapter facts are portable contract fields, and which process/session details remain
   private adapter artifacts?
5. How should timeout, cancellation and malformed structured output become durable non-terminal
   blocked/decision states without trusting Agent prose?
