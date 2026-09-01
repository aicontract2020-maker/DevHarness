# Contract: Live Alignment Orchestration v1

## Purpose

Define public commands, state transitions, deterministic readiness and developer packets. AC
coverage: AC-1 through AC-16.

## Static Advance

```text
devharness advance --repo PATH --run RUN_ID --agent ADAPTER_ID --agent-profile PROFILE_ID
```

Preconditions: run state `received`; clean matching revision; selected adapter-owned profile is known;
adapter probe succeeds without model
invocation. The resulting onboarding plan adds one exact capability:

```json
{
  "id": "agent-runtime",
  "capability": "agent-runtime",
  "operation": "analyze-goal-read-only",
  "target": "<agent-runtime-subject-sha256>",
  "scope": ["repository:<identity>", "revision:<sha>", "descriptor:<sha256>", "executable:<sha256>", "profile-template:<sha256>", "provider-origin:<exact-origin>", "no-consumer-write"],
  "reason": "Produce and independently validate a live Alignment Brief.",
  "risk": "high",
  "authority": "human-only",
  "reversibility": "Revocable before each external attempt; historical outputs remain labeled.",
  "decision": "pending"
}
```

The closed `AgentRuntimeSubject` hashed by `target` is:

```json
{
  "schema_version": 1,
  "id": "agent-runtime-subject-...",
  "repository_identity": "...",
  "commit_sha": "...",
  "descriptor_sha256": "...",
  "implementation_sha256": "...",
  "executable_sha256": "...",
  "profile_template_sha256": "...",
  "profile_id": "codex-readonly-analysis-v1",
  "model_id": "approved-model-id",
  "control_plane_origins": ["https://exact.provider.example"],
  "phases": ["analysis-plan", "analysis-synthesis", "analysis-validation"],
  "max_attempts_per_phase": 2,
  "max_agent_attempts": 6,
  "max_provider_requests": 120,
  "provider_request_deadline_seconds": 120,
  "max_active_execution_seconds": 3600,
  "max_total_tokens": 600000,
  "consumer_write": false,
  "reversibility": "revocable-before-next-external-action"
}
```

The id is the canonical digest of every other field. Arrays are unique and in the shown canonical
order. No additional field is allowed. An Agent attempt is one `codex exec`; a provider request is one
proxy-observed HTTP round trip inside an attempt. The approval view displays both ceilings, phases,
active time, token ceiling, provider origins and reversibility rather than only the subject id.

The enclosing signed approval request supplies `requested_at` and `expires_at`. The capability
presentation displays both. Existing v1 capabilities without `reversibility` remain readable, but a
new `agent-runtime` or `network-research` request is invalid without it. The descriptor subject binds
adapter implementation, executable and profile-template digests, exact control-plane origins and
selected provider/model profile. The command is authorized by this exact human approval rather than
by a discovered consumer command.

The checkpoint remains `clarifying`, non-approvable and compatible with existing capability review.
If no adapter is selected, current static-only behavior remains available but cannot proceed live.

## Live Advance

```text
devharness advance --repo PATH --run RUN_ID
```

Preconditions:

- state is `clarifying`;
- current snapshot exactly matches run identity/revision and is clean;
- selected adapter descriptor still exactly matches the approved `agent-runtime` target;
- one current approved agent-runtime receipt exists;
- network authority is optional at operation start; if absent the gateway is disabled until an exact
  runtime-constructed query set is approved;
- no completed valid invocation already maps to the same pre-invocation input.

The orchestrator then:

1. Claims or reconciles the stable AlignmentOperation and its lease.
2. Runs enforcement/resource preflight.
3. Runs a `goal-analyst-plan` attempt that proposes local findings and public research topics.
4. Runtime constructs exact non-sensitive queries; when material research is needed it publishes a
   separate network authority request and stops. Once approved, it executes the queries under the
   operation budget. If explicitly denied, synthesis resumes with a sourced research gap and readiness
   remains blocked whenever the gap is required.
5. Runs a fresh `goal-analyst-synthesis` invocation over local sources and sanitized research refs.
6. Runs a fresh `goal-validator` invocation with a distinct execution instance and source-first input.
7. Applies deterministic citation, claim-class, domain, prompt-injection, materiality and readiness
   policy.
8. Commits an operation result journal, source records and one AlignmentBundle, appends the checkpoint,
   then reconciles the journal to the checkpoint pointer.

Authority and revision are atomically revalidated before each Agent attempt and each network request.
Expiry prevents the next external action but does not invalidate an already completed historical
attempt. Each Agent attempt has a 1–30 minute deadline. Plan, gateway, synthesis and validation share
a 3600-second active-execution budget and aggregate artifact/process/token ceilings. Human-wait states
run no worker/proxy/gateway process and consume no active time; they may remain durable indefinitely.

If Agent authority expires between phases, the operation appends `agent-authority-paused`, enters
`waiting-agent-authority`, stores the exact subject/current phase and starts no process. A newly signed
receipt for the byte-identical subject appends `agent-authority-attached` and resumes that phase with a
new invocation bound to the new receipt. A changed subject/descriptor terminates the old operation as
stale and requires a new operation; expiry is never reported as an execution failure.

The immutable ResearchQuery set has append-only authority epochs. Renewal may attach epoch N+1 only
when the subject/query-set/origins are byte-identical; each HTTP request and ResearchSource binds the
actual epoch receipt. A denial records gaps and proceeds to synthesis. Expiry before any/next request
pauses as `waiting-research-authority`; a same-subject renewal resumes, while a human denial of renewal
records remaining queries as gaps and resumes. Timeout/limit/source failure retains completed sources,
records incomplete queries as gaps and proceeds. A different query set requires a new operation.

## State Outcomes

| Condition | Resulting state | Packet/verdict | Recommended action |
|-----------|-----------------|----------------|--------------------|
| Agent authority missing/stale | `clarifying` | existing brief/action-required | request/renew capability |
| Unsupported isolation/adapter/auth | `clarifying` | decision queue/blocked | inspect remediation |
| Attempt failed/timed out | `clarifying` | decision queue/failed or blocked | retry once or cancel |
| Operation cancelled | `cancelled` | progress pulse/cancelled | start a new Goal Run if work is still wanted |
| Material question/conflict/gap | `clarifying` | alignment brief/action-required | answer highest-priority decision |
| Complete validated understanding | `awaiting_scope_approval` | alignment brief/ready | request scope approval |

Successful ready progression records topology:

```text
clarifying -> researching -> specifying -> awaiting_scope_approval
```

Question-blocked analysis records artifacts/interactions but no state transition beyond
`clarifying`. Event payloads contain only stable IDs/digests/status, never raw Agent prose.

## Deterministic Projector

Inputs: original developer goal, live repository snapshot, onboarding plan, producer analysis,
validator analysis, optional ResearchSources and current developer decisions.

Rules:

- The original goal and explicit human decisions are the only normative product sources.
- Applicable domains come from trusted inventory/goal-impact rules; producer `not-applicable` has no
  authority.
- A claimed source path is normalized inside consumer root, cannot be a symlink escape and must exist
  at the pinned revision.
- `documented` comes only from prose; `code-confirmed` only from direct implementation/config;
  `test-confirmed`/`runtime-observed` cannot be created in this slice.
- Producer/validator disagreement on material content becomes `conflict`.
- Untrusted source instructions are never accepted as outcome, non-goal, criterion or policy.
- Materiality uses the exact dimensions and priority order from AC-6.
- Every applicable domain needs coverage; every ready criterion is falsifiable Given/When/Then with
  at least one source ref and proposed proof surface.

## Interaction Packet

Question-blocked packet:

- exactly `min(3, material_count)` decisions in deterministic order;
- every decision and section item has a traceability mapping;
- omitted count includes all non-surfaced findings/questions;
- exactly one recommended `answer` or `inspect` action;
- never an `approve` action.

Ready packet:

- sections: refined outcome, confirmed project/system understanding, boundaries/non-goals,
  acceptance criteria and proof gaps;
- zero unresolved decisions/blocking items;
- `attention.reasons` includes `gate-approval`;
- exactly one recommended `approve` action;
- canonical AlignmentBundle digest is the scope subject.

## Answering Decisions

```text
devharness answer --repo PATH --run RUN_ID --packet PACKET_SHA256 \
  --decision DECISION_ID --option OPTION_ID
```

Allowed only when the current packet is question-blocked and contains the exact unresolved decision
and option. The supplied packet digest must equal the current packet digest; stale packets, free-form
answers, unknown options, cross-run answers and answers after revision change are rejected. The
arguments first create a Supervisor-signed `alignment-answer` request whose subject is the exact
run/repository/revision/packet/decision/option digest. They do not themselves answer it. The command
then shows the selected label, trade-offs and source links in a foreground TTY confirmation, rejects
JSON/bypass flags and non-TTY input, and obtains a Supervisor-signed foreground decision receipt with
bounded expiry. Only that receipt can create a closed `DeveloperAnswer`; its actor must match the
Supervisor-verified foreground human
receipt. The runtime emits `question.answered` and atomically appends a new `clarifying` checkpoint. It
never rewrites the earlier question packet.

The next `advance` includes the ordered DeveloperAnswer digests in a new stable operation key. Every
answer is normative input, and the Agent must reassess affected claims/criteria; unresolved decisions
remain blocked. Repeating the exact answer returns the existing answer/checkpoint. A different answer
to the same decision requires a separately designed supersession feature and is rejected in v1.

## Scope Request

```text
devharness request-scope --repo PATH --run RUN_ID
```

Allowed only in `awaiting_scope_approval`. It loads the current ready AlignmentBundle, recomputes its
canonical digest and creates a Supervisor `scope` request. Callers never supply the subject id/hash.
Foreground `approve` records the immutable decision. Planning/execution remains outside this feature.

## Idempotency and Recovery

The stable operation key includes: run id, repository identity/revision, the checkpoint at which the
semantic input was accepted, ordered developer-answer digests, exact Agent-authority subject digest,
complete adapter descriptor, result-contract digest and operation limits. Creation
timestamps, attempt numbers and the not-yet-produced research plan are excluded. After the plan phase,
the exact immutable ResearchQuery set and network-authority receipt are attached through append-only
operation journal records; they cannot be replaced within that operation. A later checkpoint produced
by the operation stores `operation_id`, so repeated `advance` resolves the existing operation instead
of deriving from the later checkpoint.

Every AgentInvocation still hashes its exact current Agent-authority receipt. Renewal of the same
unchanged subject can resume a paused operation; a changed subject/descriptor cannot. This separates
logical idempotency from time-bounded permission to perform the next external action.

Provider/research request counts are the number of create-only OutboundRequestReservations, not a
mutable status field. Each reservation precedes network I/O and binds the exact attempt/query and
authority receipt/epoch. A crash with no receipt consumes budget and is never automatically resent;
recovery records `outcome-unknown` before deciding whether a new bounded attempt/request is allowed.

Each external execution has `attempt_no`, `phase` and a distinct `attempt_id`. Attempt 1 is automatic.
`devharness retry --repo PATH --run RUN_ID --operation OPERATION_ID` creates attempt 2 only for the
failed phase when the current operation is terminal failed/timed-out and
inputs/authority/revision remain exact. There is no automatic retry in v1, so the contract's maximum
of one automatic retry is respected. At most two attempt numbers exist per phase. A cancelled
operation is permanently terminal because its fence is immutable; restarting after cancellation
requires a new Goal Run.
`devharness cancel --repo PATH --run RUN_ID --operation OPERATION_ID` does not acquire the worker's
lease. It atomically creates a shared create-only `terminal-fence.json` with kind `cancel`. The commit
path races by creating the same file with kind `commit`; only one `O_EXCL` create can win. The active
lease owner, worker, proxy and gateway watch the fence (poll interval <=250 ms plus abort signal) and
invoke adapter cancellation immediately when cancel wins. Every next external action checks the fence.
If commit won, cancel reports `ALREADY_COMMITTING` and recovery can reconstruct intent from the
prepared manifest referenced by the fence; if cancel won, no commit/action may begin and process-tree
cleanup completes within 30 seconds. Cancelling an already committed result returns
`ALREADY_COMPLETED`. Exact repeated cancellation returns the existing cancel fence.

The store uses create-only `operation.json`, numbered attempt directories and a prepared transaction:

1. Write the complete next checkpoint bytes—events with fixed ids/timestamps, run snapshot, scorecard,
   packet and every artifact—beneath a same-filesystem staging directory. Its closed manifest binds the
   operation, expected current sequence/digest, target sequence and every file digest.
2. Fsync every file and staging directory, atomically rename it to `prepared/<transaction-id>`, and
   fsync the parent. A crash before promote leaves removable staging; a promoted preparation is enough
   to recreate intent without regenerating any Agent output.
3. Attempt the shared O_EXCL linearization point by publishing `terminal-fence.json(kind=commit)` with
   the prepared-manifest digest. If cancel already won, stop and never commit. A crash after preparation
   but before a fence may resume this contest; a commit fence without intent is sufficient to rebuild
   the next exact step from the immutable preparation.
4. Create/fsync `commit-intent.json` with the prepared-manifest digest, exact expected predecessor and
   target digest; fsync its parent.
5. Acquire the Goal Run append lock, compare-and-swap the current pointer against the expected
   predecessor, publish the prepared checkpoint bytes without regeneration, move the pointer and fsync
   each affected parent directory.
6. Create/fsync `committed.json` containing observed checkpoint/pointer digests and fsync its parent.

Every journal/control publication uses the same safe primitive: write complete bytes to a unique file
in the destination directory, fsync the file, atomically publish with no-replace semantics, then fsync
the parent directory. Mutable lease heartbeats use temp-file fsync plus atomic replace plus parent
fsync. A truncated final-name control file is therefore never a valid intermediate state.

On restart, recovery validates all prepared bytes and completes only the missing deterministic step.
A predecessor mismatch fails closed; no stale result is appended. Partial staging is removed only
after proving no live owner. The existing Goal Run `.append.lock` and the operation lease share one
recoverable owner record: boot id, PID, process birth identity, wall-clock expiry and heartbeat
sequence. Monotonic deadlines are used only within the same live process/boot. A lock is quarantined
and reacquired only after boot/PID-birth checks prove the recorded owner cannot still exist and the
wall-clock expiry passed.

- Completed intact operation: replay/read without Agent call.
- In-progress with live owner: report progress, do not duplicate.
- Expired lease with no matching live process: mark current attempt failed, clean, permit only bounded retry.
- Missing/corrupt record: block with integrity remediation; never overwrite history.
- Expired authority: historical display allowed, new external action denied.
- Changed semantic input: new operation identity and new authority when its approved subject changed.

## Error Codes

| Code | State | Developer-visible action |
|------|-------|--------------------------|
| `AGENT_AUTHORITY_REQUIRED` | clarifying | request capability |
| `AGENT_AUTHORITY_STALE` | clarifying | request replacement |
| `ADAPTER_CHANGED` | clarifying | review new exact target |
| `ANALYSIS_FAILED` | clarifying | retry once or inspect |
| `ANALYSIS_CONFLICT` | clarifying | answer/review material conflict |
| `ANALYSIS_INCOMPLETE` | clarifying | inspect missing applicable domains |
| `ATTEMPT_IN_PROGRESS` | unchanged | show Progress Pulse |
| `ATTEMPT_INTEGRITY` | clarifying | inspect; no overwrite/retry; begin a new run only after external repair |
| `SCOPE_NOT_READY` | unchanged | resolve packet blockers |
| `ANSWER_STALE` | unchanged | reload current packet before answering |
| `ANSWER_INVALID` | unchanged | choose one listed option |
| `RETRY_EXHAUSTED` | unchanged | inspect or cancel Goal Run |
| `ALREADY_COMMITTING` | unchanged | wait for deterministic commit reconciliation |
| `ALREADY_COMPLETED` | unchanged | inspect the committed packet |

## Compatibility

Existing static Goal Runs remain readable. Existing `advance` from `received` remains static. The new
live path is opt-in through adapter selection and exact approval. No legacy run is auto-invoked,
auto-approved or migrated. Phase/attempt/authority detail is stored only in the closed
`OperationJournalRecord` variants. Goal Run checkpoints use only the existing `question.asked`,
`question.answered`, `research.recorded`, `artifact.written`, `interaction.published`,
`attention.requested`, `attention.resolved`, `state.transitioned` and `run.cancelled` event types;
this feature does not extend the run-event enum.
