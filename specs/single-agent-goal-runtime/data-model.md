# Data Model: Live Goal Alignment

## Spec Reference

Implements `specs/single-agent-goal-runtime/spec.md` v1.0.1. All objects are closed JSON records:
unknown fields fail validation. No database or consumer migration is introduced; records live under
the existing external Goal Run root.

## Common Closed Types

### ArtifactRef

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | identifier | stable within run |
| `kind` | enum | goal, snapshot, onboarding, agent-runtime-subject, research-query, network-research-subject, analysis-plan, research-source, research-gap, goal-analysis, analysis-validation, alignment-bundle, interaction-packet, developer-answer, diagnostic, isolation-proof |
| `sha256` | sha256 | digest of canonical stored bytes |
| `media_type` | string | approved JSON/text media type |
| `size_bytes` | integer | 0..1 MiB per structured record |
| `storage_key` | string | relative normalized key; no absolute/traversal path |

### AuthorityRef

| Field | Type | Constraints |
|-------|------|-------------|
| `capability` | enum | `agent-runtime` or `network-research` |
| `subject_id` | identifier | exact capability subject |
| `subject_sha256` | sha256 | canonical subject digest |
| `request_id`, `receipt_id` | identifier | Supervisor-issued records |
| `request_sha256`, `receipt_sha256` | sha256 | exact immutable records |
| `approved_at`, `expires_at` | timestamp | approved_at < expires_at |

### HumanDecisionRef

| Field | Type | Constraints |
|-------|------|-------------|
| `gate` | enum | exactly `alignment-answer` |
| `subject_sha256` | sha256 | exact packet/question/option subject |
| `request_id`, `receipt_id` | identifier | Supervisor-issued records |
| `request_sha256`, `receipt_sha256` | sha256 | immutable signed bytes |
| `actor` | actor | exactly the Supervisor-verified foreground human on the receipt |
| `decided_at` | timestamp | inside request window |

### SourceRef

| Field | Type | Constraints |
|-------|------|-------------|
| `artifact_id` | identifier | resolves to current-run ArtifactRef |
| `artifact_sha256` | sha256 | exact digest |
| `location` | object | exactly one of repository `{path,line_start,line_end}`, JSON `{pointer}`, external `{source_id,excerpt_sha256}`, or developer `{answer_id}` |

Repository paths are relative, normalized, inside the pinned snapshot, and line ranges are positive
and ordered. External excerpts must match a ResearchSource. Developer refs must match a current
DeveloperAnswer.

### Finding

Required fields: `id`, `kind`, `summary`, `material_dimensions`, `source_refs`. `kind` is one of
`assumption`, `conflict`, `gap`, `untrusted-instruction`, `failure`; summary is 1..2000 characters;
dimensions are a unique subset of the AC-6 materiality dimensions; source refs contain 1..10 items.

### ProposedItem and ResearchTopic

`ProposedItem` is closed and requires `id`, `text` (1..2000 characters) and 1..10 `source_refs`.
`ResearchTopic` is closed and requires `id`, `purpose` (1..1000 characters), 1..10
`public_identifiers` (each 1..256 characters, manifest/developer-goal derived only) and 1..10
`source_refs`. Neither type may contain policy, authority, URL or query fields.

### DecisionOption and MaterialQuestion

`DecisionOption` is closed and requires `id`, `label` (1..200), `outcome` (1..1000), 1..5 `tradeoffs`
(each 1..500) and boolean `recommended`; exactly one of two or three
options is recommended. `MaterialQuestion` requires `id`, `question`, `options`,
`material_dimensions`, `source_refs`; question is 1..2000 characters, it contains 2..3 options, 1..11
unique material dimensions and 1..10 source refs.

### AreaAssessment

This closed type requires `area`, `proposed_status`, `summary` (1..2000), `source_refs` (1..10). `area` is exactly one of
`repository-bootstrap`, `frontend`, `backend`, `data`, `security`, `integration`, `testing`,
`deployment`, `automation`; each appears exactly once. Status is `applicable`, `not-applicable`,
`conflict` or `gap`. Only the projector assigns final applicability.

### ClaimProposal

This closed type requires `id`, `area`, `text`, `proposed_class`, `source_refs`. Proposed class is one of `detected`,
`documented`, `code-confirmed`, `conflict`, `unverified`, `not-covered`; the model cannot propose
`test-confirmed` or `runtime-observed` in this slice. Text is 1..2000 characters and source refs are
1..10.

### CriterionProposal

This closed type requires `id`, `given`, `when`, `then`, `proof_surface`, `source_refs`. Each text field is non-empty
and at most 2000 characters; proof surface is one of `unit`, `api`, `browser`, `simulator`, `database`,
`deployment`, `automation`, `manual-observation`, and is only a future proof proposal.

### AccessPolicy

Closed fields: consumer `{read:true,write:false,commit_sha}`, `host_read` is the exact ordered set
`runtime-system-libraries`, `adapter-executable`, `provider-proxy-client`; `host_write`
exactly `runtime-attempt-directory`, `supervisor_access:false`, `consumer_environment:false`, provider
transport `{approved,target_descriptor_sha256,proxy_policy_sha256}`, research network
exactly `{approved:false,authority_ref:null}` and `backend` exactly `macos-seatbelt-v1` for real
execution. Research is performed by a runtime gateway outside the Agent sandbox. It also
requires `profile_template_sha256` and `profile_instance_sha256`; the latter is a runtime-derived
instance whose resolved permissions must be a subset of the approved template.

### ResourceLimits

Requires `attempt_deadline_seconds` (60..1800), `max_active_execution_seconds` (60..3600 across all
Agent/research activity), result/stdout/stderr/records/retained/temp/process/RSS and cleanup limits
fixed by AC-14, plus research limits: 5 queries, 5 sources/query, 25 requests, 3 redirects/request,
2 MiB/response, 10 MiB total and 30 seconds/request. Active execution advances only while a
worker/proxy/gateway is active; no process survives a human-wait state. Implementations may choose
lower values but never higher ones.

## Primary Entities

### AgentDescriptor

Runtime-probed adapter identity. It never grants authority.

| Field | Type | Constraints |
|-------|------|-------------|
| `schema_version` | integer | exactly 1 |
| `id`, `version` | identifier/string | stable adapter identity/version |
| `protocol_version` | integer | exactly 1 |
| `profile_id` | identifier | selected adapter-owned profile |
| `model_id` | string | exact adapter-selected provider model |
| `executable_version` | string | probed backing executable version |
| `modes` | enum[] | includes plan, synthesis, validation |
| `features` | closed object | required booleans true |
| `implementation_sha256` | sha256 | adapter source identity |
| `executable_sha256` | sha256 | resolved executable bytes |
| `profile_template_sha256` | sha256 | approved static model/provider/config/sandbox/proxy policy |
| `control_plane_origins` | HTTPS origin[] | 1..5 exact origins |
| `descriptor_sha256` | sha256 | canonical digest excluding this field |

### AlignmentOperation

Immutable logical execution identity; timestamps and attempts do not affect its id.

| Field | Type | Constraints |
|-------|------|-------------|
| `schema_version` | integer | exactly 1 |
| `id` | identifier | digest of semantic fields below |
| `run_id`, `repository_identity`, `commit_sha` | identifiers | exact Goal Run binding |
| `input_checkpoint_sha256` | sha256 | checkpoint accepting current semantic input |
| `original_goal` | ArtifactRef | kind `goal` |
| `developer_answers` | ArtifactRef[] | ordered, unique, kind `developer-answer` |
| `snapshot`, `onboarding` | ArtifactRef | trusted static inputs |
| `agent_descriptor` | AgentDescriptor | exact approved value |
| `agent_authority_subject` | closed object | exactly `{id, sha256}` for approved AgentRuntimeSubject; no mutable receipt |
| `result_contract_sha256` | sha256 | complete output-contract set |
| `limits` | ResourceLimits | aggregate operation budget |

The canonical id hashes every listed field except `id`; it never hashes
`created_at`, attempt number, authority receipt or mutable status. Each invocation binds the exact
then-current receipt. Renewing the same unchanged subject therefore resumes the operation, while a
changed subject creates a new operation. A checkpoint generated by this operation stores its id, so
repeat `advance` resolves the existing operation even though the current checkpoint changed.

### OperationStatus

Mutable projection rebuilt from append-only journal records plus create-only attempt/outbound
accounting ledgers. Fields: `operation_id`, `status`
(`planned`, `waiting-agent-authority`, `waiting-research-authority`, `running`, `question-blocked`, `ready`, `failed`,
`cancelled`, `timed-out`), `active_phase`, `current_attempt_id`, aggregate observations, optional
`analysis_plan_ref`, `research_authority_ref`, `result_bundle_ref`, `checkpoint_sha256`, and terminal
error. Each journal record has a strictly increasing sequence and previous-record digest.

Normative shape: `closed {schema_version:1,operation_id,status,active_phase:null|phase,
current_attempt_id:null|identifier,active_execution_ms:int[0..3600000],agent_attempts:int[0..6],
provider_requests:int[0..120],
total_tokens:int[0..600000],retained_records:int[0..20],retained_bytes:int[0..20971520],
analysis_plan_ref:null|ArtifactRef,research_subject_ref:null|ArtifactRef,
research_authority_epoch:int[0..20],result_bundle_ref:null|ArtifactRef,
checkpoint_sha256:null|sha256,terminal_error:null|StableErrorCode,journal_head_sha256:sha256,
accounting_head_sha256:sha256}`. The accounting head uses the exact formula/path set below. Missing
optional terminal files are omitted; any unlisted entry, symlink, unsafe path, duplicate path or digest
mismatch is an integrity failure. Budgets never come from mutable counters.

### AgentInvocation

Immutable input for one external phase.

| Field | Type | Constraints |
|-------|------|-------------|
| `schema_version` | integer | exactly 1 |
| `id` | identifier | canonical digest excluding `id` and `created_at` |
| `operation_id` | identifier | parent AlignmentOperation |
| `attempt_id`, `attempt_no` | identifier/integer | distinct, attempt_no 1..2 per phase |
| `phase` | enum | `analysis-plan`, `analysis-synthesis`, `analysis-validation` |
| `execution_instance_id` | identifier | runtime-random, distinct across invocations |
| `adapter` | AgentDescriptor | exact operation descriptor |
| `input_artifacts` | ArtifactRef[] | phase-specific, unique and ordered |
| `authorities` | AuthorityRef[] | current exact refs required for this phase |
| `policy` | AccessPolicy | closed boundary |
| `profile_instance_sha256` | sha256 | runtime instance derived as a strict template subset |
| `remaining_limits` | ResourceLimits | no larger than operation remainder |
| `result_contract_sha256` | sha256 | expected phase result |
| `created_at` | timestamp | audit only; excluded from id |

Synthesis inputs include the AnalysisPlan and all fetched ResearchSources or an explicit research-gap
artifact. Validation inputs are source-first: snapshot/source refs precede the producer conclusion.

### AgentAttempt

Normalized terminal receipt. Required: `schema_version`, `id`, `operation_id`, `invocation_id`,
`attempt_no`, `phase`, `execution_instance_id`, `status`, `started_at`, `completed_at`, `duration_ms`,
`termination_reason`, `exit_code`, `limit_observations`, `artifacts`, `cleanup`,
`isolation_proof_sha256`, `profile_instance_sha256`; success additionally requires `result_sha256`. Optional `usage` contains only
generic token counts. Status is succeeded/blocked/failed/cancelled/timed-out. Artifacts contain at most
20 refs; cleanup status is proved within 30 seconds. Validation's execution instance and isolation
proof must differ from every producer instance.

If `cleanup.status=failed`, attempt status is `failed`, termination reason is `cleanup` and no result
is promotable even when both remaining counts are zero. For the Codex descriptor `usage` is required
and must equal the proxy receipt; the provider-neutral field remains optional only for a future
descriptor whose approved subject has no token ceiling.

### AnalysisPlan

Untrusted analyst-plan output. Required: `id`, `invocation_id`, local `affected_areas`, local `claims`,
`assumptions`, `conflicts`, `questions`, `untrusted_instructions`, and `research_topics`. A research
topic contains only `id`, `purpose`, public dependency/topic identifiers and source refs; it contains
no outbound query. Runtime deterministically creates at most five ResearchQueries from these fields.

### ResearchQuery

Required: `id`, `operation_id`, `purpose`, `query` (<=512 chars), `origin_ids` (1..5),
`constructed_from` (goal/public-manifest SourceRefs), `requests` (1..5 ResearchRequestRecipes),
`max_sources` (1..5) and `query_sha256`. The
immutable ordered query set is hashed into the network-authority subject and presented in full before
approval, avoiding a query/authority digest cycle.

`ResearchRequestRecipe` is closed and requires `id`, `adapter` exactly `exact-https-get-v1`, `url`
(exact approved HTTPS URL without credentials/fragment, <=2048 characters), `origin_id`, `method`
exactly `GET`, `header_profile` exactly `public-text-v1`, `body` exactly null, `deadline_seconds`
(1..30), `max_response_bytes` (1..2 MiB), and digest-derived `recipe_sha256`. URL paths/query
parameters are shown in the network approval. They may come from a signed runtime registry recipe or
an Agent suggestion only after explicit developer approval; approval, not the suggestion, grants use.

### ResearchSource

Required: `id`, `operation_id`, `run_id`, `repository_identity`, `commit_sha`, `query_id`,
`network_authority_ref`, authority epoch, reservation/receipt ids and digests, `approved_origin`,
`final_url`, `title`, `retrieved_at`, `content_sha256`, `excerpt`, `excerpt_sha256`,
`research_payload_sha256`, `untrusted:true`. Final URL remains at the exact approved HTTPS origin;
excerpt is sanitized plain text <=8 KiB.

### GoalAnalysis

Untrusted-but-validated synthesis result. Required: `id`, `invocation_id`, `operation_id`,
`refined_outcome`, all nine `affected_areas`, `claims`, `assumptions`, `conflicts`, `non_goals`, every
`questions`, `acceptance_criteria`, `untrusted_instructions`, `research_source_refs` and
`research_gaps`. It never contains final authority, evidence, applicability, materiality or readiness.

### GoalAnalysisValidation

Fresh challenger result. Required: `id`, `invocation_id`, `operation_id`, `producer_analysis_id`,
`citation_checks`, `area_checks`, `question_checks`, `missing_items`, `prompt_injection_findings`,
`verdict`. CitationCheck requires proposal/source ids, exists/supports booleans and maximum supported
class. AreaCheck covers every deterministic area. QuestionCheck binds question id, completeness and
material dimensions. Verdict is valid/conflict/blocked and cannot assign readiness.

### DeveloperAnswer

| Field | Type | Constraints |
|-------|------|-------------|
| `schema_version` | integer | exactly 1 |
| `id` | identifier | canonical digest excluding id |
| `run_id`, `repository_identity`, `commit_sha` | identifiers | current Goal Run binding |
| `packet_sha256` | sha256 | exact current question packet |
| `decision_id`, `option_id` | identifier | exact listed unresolved option |
| `decision_ref` | HumanDecisionRef | exact signed foreground decision |
| `actor` | object | equals the decision receipt's human actor |
| `answered_at` | timestamp | Supervisor-observed time |

The answer subject hashes run/repository/revision, packet digest, decision id and option id. Command
arguments only prepare that subject; they do not constitute a decision. Answers are append-only and
immutable. Exact signed repeats are idempotent; a second option for the same decision is rejected.

### AlignmentBundle

Required fields:

- identity: `schema_version`, `id`, `operation_id`, run/repository/revision;
- inputs: goal, ordered developer answers, descriptor, analysis plan, research sources/gaps, synthesis
  and validation ArtifactRefs;
- deterministic output: refined outcome; all nine area decisions; classified claims; assumptions;
  conflicts; non-goals; ranked material decisions; falsifiable criteria and proposed proof surfaces;
- traceability: one `TraceabilityMapping` per bundle/packet item with item id and 1..10 exact SourceRefs;
- readiness: blocking ids, omitted count, `question-blocked|ready` verdict and policy-version digest.

Its id is the canonical content digest and is the only scope-approval subject.

### InteractionPacketProjection

The existing packet schema is extended additively. Every section item and decision id must appear in
the bundle's traceability mappings. Question packets contain exactly `min(3, material_count)` ranked
decisions, total/omitted counts and one `answer` or `inspect` action. Ready packets contain zero
decisions/blockers and one `approve` action bound to the AlignmentBundle digest. Legacy packets remain
readable but cannot satisfy live-alignment readiness.

The projector converts each validated MaterialQuestion to MaterialDecision without model discretion:
question/options/source refs are copied; `recommended_option_id` is the sole option with
`recommended=true`; `impact=high` when any dimension is irreversible/destructive,
security/privacy/credential, data/schema/migration or role/permission, otherwise medium;
`reversibility=irreversible` for the first dimension, `costly` for data/schema/migration,
architecture/dependency or deployment behavior, otherwise reversible. `why_now` is a fixed template
naming the highest-priority material dimension and cited source ids. Bundle refined outcome,
boundaries, non-goals, areas, criteria, blockers and material decisions all have stable ids and exactly
one matching TraceabilityMapping; packet section/decision ids are a subset of those bundle ids.

## Normative Closed Record Dictionary

This section closes every persisted/interface shape. `closed {}` means JSON object with
`additionalProperties:false`; every shown field is required unless suffixed `?`. `id=H(*)` means the
identifier is `<record-type>-<lowercase SHA-256>` of the canonical object with only `id` removed; the
prefix keeps it inside the common identifier grammar. Canonicalization
uses the existing Supervisor canonical-JSON algorithm; object keys are sorted, arrays retain declared
order, numbers are integers, and undefined/non-JSON values are rejected. `text(N)` is a string of
1..N Unicode scalar values after control/active-markup neutralization. All record arrays are capped so
their canonical containing result remains <=1 MiB.

Every named digest uses `D(type, value, excludedFields) = SHA256(canonical({domain:
"devharness/<type>/v1", value: value-with-excluded-fields-removed}))`. Exact formulas:

- `descriptor_sha256 = D("agent-descriptor", descriptor, ["descriptor_sha256"])`;
- `query_sha256 = D("research-query", query, ["id","query_sha256"])`;
- `recipe_sha256 = D("research-request-recipe", recipe, ["recipe_sha256"])`;
- `query_set_sha256 = D("research-query-set", ordered complete ResearchQuery ArtifactRefs, [])`;
- `accounting_head_sha256 = D("operation-accounting-head", entries, [])`, where `entries` is the
  bytewise-storage-key-sorted array of closed `{storage_key,sha256}` for every existing
  `attempts/*/*/reservation.json`, `attempts/*/*/attempt.json`,
  `outbound/*/*/reservation.json`, `outbound/provider/*/receipt.json`, and every file beneath
  `outbound/research/*/terminal/` (`manifest`, `receipt`, and exactly one `source` or `gap`);
- `CleanupProof.proof_sha256 = D("cleanup-proof", cleanup, ["proof_sha256"])`;
- `ResearchSource.content_sha256` hashes sanitized complete response bytes with domain
  `research-content`; `excerpt_sha256` hashes sanitized excerpt bytes with domain `research-excerpt`;
- `ArtifactRef.sha256` hashes the referenced canonical artifact with its artifact-kind domain;
- `H(*)` uses `D(record-type, record, ["id"])`, except AgentInvocation also excludes `created_at` as
  explicitly declared. No digest field is ever included in its own preimage.

```text
MaterialDimension = irreversible-destructive | security-privacy-credential |
  data-schema-migration | externally-observable-behavior | architecture-dependency |
  role-permission | persistence-rule | external-interface | deployment-behavior |
  acceptance-criterion | explicit-non-goal

SystemArea = repository-bootstrap | frontend | backend | data | security | integration |
  testing | deployment | automation
ArtifactKind = goal | snapshot | onboarding | agent-runtime-subject | research-query |
  network-research-subject | analysis-plan | research-source | research-gap | goal-analysis |
  analysis-validation | alignment-bundle | interaction-packet | developer-answer | diagnostic |
  isolation-proof
StableErrorCode = AGENT_AUTHORITY_REQUIRED | AGENT_AUTHORITY_STALE | ADAPTER_CHANGED |
  ADAPTER_NOT_FOUND | ADAPTER_INCOMPATIBLE | AUTH_UNAVAILABLE | ISOLATION_UNAVAILABLE |
  CANCELLED | TIMEOUT | PROCESS_EXIT | INVALID_OUTPUT | RESOURCE_LIMIT | USAGE_UNAVAILABLE |
  CLEANUP_FAILED | ANALYSIS_FAILED | ANALYSIS_CONFLICT | ANALYSIS_INCOMPLETE |
  ATTEMPT_IN_PROGRESS | ATTEMPT_INTEGRITY | SCOPE_NOT_READY | ANSWER_STALE |
  ANSWER_INVALID | RETRY_EXHAUSTED | ALREADY_COMMITTING | ALREADY_COMPLETED
  | RESEARCH_NOT_AUTHORIZED | ORIGIN_NOT_ALLOWED | PRIVATE_DESTINATION |
  OUTBOUND_DATA_REJECTED | RESEARCH_TIMEOUT | RESEARCH_CONFLICT | RESEARCH_LIMIT

ArtifactRef = closed {
  id: identifier, kind: ArtifactKind, sha256: sha256,
  media_type: application/json | text/plain, size_bytes: int[0..1048576],
  storage_key: normalized-relative-key[1..1024]
}

AuthorityRef = closed {
  capability: agent-runtime | network-research, subject_id: identifier,
  subject_sha256: sha256, request_id: identifier, receipt_id: identifier,
  request_sha256: sha256, receipt_sha256: sha256,
  approved_at: timestamp, expires_at: timestamp
}

HumanDecisionRef = closed {
  gate: alignment-answer, subject_sha256: sha256,
  request_id: identifier, receipt_id: identifier,
  request_sha256: sha256, receipt_sha256: sha256,
  actor: human-actor, decided_at: timestamp
}

SourceLocation = oneOf closed {
  {kind: repository, path: normalized-relative-key, line_start: int[1..1000000000],
   line_end: int[1..1000000000]},
  {kind: json, pointer: json-pointer[1..2048]},
  {kind: external, source_id: identifier, excerpt_sha256: sha256},
  {kind: developer, answer_id: identifier}
}

SourceRef = closed {
  artifact_id: identifier, artifact_sha256: sha256, location: SourceLocation
}

Finding = closed {
  id: identifier, kind: assumption | conflict | gap | untrusted-instruction | failure,
  summary: text(2000), material_dimensions: [MaterialDimension, 0..11 unique],
  source_refs: [SourceRef, 1..10]
}

ProposedItem = closed {id: identifier, text: text(2000), source_refs: [SourceRef, 1..10]}
ReviewItem = closed {id: identifier, text: text(4000), source_refs: [SourceRef, 1..10]}
DecisionOption = closed {id: identifier, label: text(200), outcome: text(1000),
  tradeoffs: [text(500), 1..5], recommended: boolean}
MaterialQuestion = closed {id: identifier, question: text(2000),
  options: [DecisionOption, 2..3], material_dimensions: [MaterialDimension, 1..11 unique],
  source_refs: [SourceRef, 1..10]}
AreaAssessment = closed {area: SystemArea,
  proposed_status: applicable | not-applicable | conflict | gap,
  summary: text(2000), source_refs: [SourceRef, 1..10]}
ClaimProposal = closed {id: identifier, area: SystemArea, text: text(2000),
  proposed_class: detected | documented | code-confirmed | conflict | unverified | not-covered,
  source_refs: [SourceRef, 1..10]}
CriterionProposal = closed {id: identifier, given: text(2000), when: text(2000),
  then: text(2000), proof_surface: unit | api | browser | simulator | database |
  deployment | automation | manual-observation, source_refs: [SourceRef, 1..10]}
ResearchTopic = closed {id: identifier, purpose: text(1000),
  public_identifiers: [text(256), 1..10 unique], source_refs: [SourceRef, 1..10]}

AccessPolicy = closed {
  consumer: closed {read: true, write: false, commit_sha: git-commit},
  host_read: [runtime-system-libraries, adapter-executable, provider-proxy-client in exact order],
  host_write: [runtime-attempt-directory], supervisor_access: false,
  consumer_environment: false,
  provider_transport: closed {approved: true, target_descriptor_sha256: sha256,
    proxy_policy_sha256: sha256},
  research_network: closed {approved: false, authority_ref: null},
  backend: macos-seatbelt-v1, profile_template_sha256: sha256,
  profile_instance_sha256: sha256
}

ResourceLimits = closed {
  attempt_deadline_seconds: int[60..1800], max_active_execution_seconds: int[60..3600],
  max_result_bytes: int[1..1048576], max_stdout_bytes: int[1..10485760],
  max_stderr_bytes: int[1..10485760], max_retained_records: int[1..20],
  max_retained_bytes: int[1..20971520], max_temporary_bytes: int[1..268435456],
  max_processes: int[1..64], max_rss_bytes: int[1..2147483648],
  cleanup_deadline_seconds: int[1..30], max_research_queries: int[0..5],
  max_sources_per_query: int[0..5], max_research_requests: int[0..25],
  max_redirects_per_request: int[0..3], max_research_response_bytes: int[0..2097152],
  max_research_bytes: int[0..10485760], research_request_deadline_seconds: int[0..30],
  max_agent_attempts: int[1..6], max_provider_requests: int[1..120],
  provider_request_deadline_seconds: int[1..120],
  max_total_tokens: int[1..600000]
}

AgentDescriptor = closed {
  schema_version: 1, id: identifier, version: text(128), protocol_version: 1,
  profile_id: identifier, model_id: text(256),
  executable_version: text(256),
  modes: [analysis-plan, analysis-synthesis, analysis-validation in exact order],
  features: closed {structured_output:true, explicit_cancel:true, ephemeral_session:true,
    read_only_tool_policy:true, built_in_web_disable:true, trusted_usage:true},
  implementation_sha256: sha256, executable_sha256: sha256,
  profile_template_sha256: sha256,
  control_plane_origins: [exact-https-origin, 1..5 unique], descriptor_sha256: sha256
}

AlignmentOperation = closed {
  schema_version: 1, id: H(*), run_id: identifier, repository_identity: text(2048),
  commit_sha: git-commit, input_checkpoint_sha256: sha256,
  original_goal: ArtifactRef, developer_answers: [ArtifactRef, 0..20],
  snapshot: ArtifactRef, onboarding: ArtifactRef, agent_descriptor: AgentDescriptor,
  agent_authority_subject: closed {id: identifier, sha256: sha256},
  result_contract_sha256: sha256, limits: ResourceLimits
}

AgentInvocation = closed {
  schema_version: 1, id: H(* excluding created_at), operation_id: identifier,
  attempt_id: identifier, attempt_no: int[1..2],
  phase: analysis-plan | analysis-synthesis | analysis-validation,
  execution_instance_id: identifier, adapter: AgentDescriptor,
  input_artifacts: [ArtifactRef, 3..50 unique by id],
  authorities: [AuthorityRef(capability=agent-runtime), exactly 1], policy: AccessPolicy,
  profile_instance_sha256: sha256, remaining_limits: ResourceLimits,
  result_contract_sha256: sha256, created_at: timestamp
}

AgentAttemptReservation = closed {
  schema_version: 1, id: H(*), operation_id: identifier, attempt_id: identifier,
  attempt_no: int[1..2], phase: analysis-plan | analysis-synthesis | analysis-validation,
  invocation_sha256: sha256, reserved_active_ms: int[60000..1800000],
  reserved_at: timestamp
}

AgentAttempt = closed {
  schema_version: 1, id: H(*), operation_id: identifier, invocation_id: identifier,
  attempt_no: int[1..2], phase: analysis-plan | analysis-synthesis | analysis-validation,
  execution_instance_id: identifier,
  status: succeeded | blocked | failed | cancelled | timed-out,
  started_at: timestamp, completed_at: timestamp, duration_ms: int[0..1800000],
  termination_reason: completed | authority | unsupported | cancelled | timeout | process-exit |
    invalid-output | limit | isolation | integrity | cleanup,
  exit_code: int[-2147483648..2147483647] | null,
  limit_observations: LimitObservations, artifacts: [ArtifactRef, 0..20],
  cleanup: CleanupProof, isolation_proof_sha256: sha256,
  profile_instance_sha256: sha256, result_sha256?: sha256,
  usage?: closed {input_tokens:int[0..600000], output_tokens:int[0..600000],
    total_tokens:int[0..600000]}
}

AgentAttemptOutput = closed {
  status: succeeded | blocked | failed | cancelled | timed-out,
  started_at: timestamp, completed_at: timestamp,
  exit_code: int[-2147483648..2147483647] | null,
  termination_reason: completed | authority | unsupported | cancelled | timeout | process-exit |
    invalid-output | limit | isolation | integrity | cleanup,
  result_path: private-absolute-path | null,
  usage: closed {input_tokens:int[0..600000], output_tokens:int[0..600000],
    total_tokens:int[0..600000]},
  adapter_diagnostics: [closed {code:StableErrorCode, summary:text(1000)}, 0..20]
}

AnalysisPlan = closed {
  schema_version: 1, id: H(*), invocation_id: identifier, operation_id: identifier,
  affected_areas: [AreaAssessment, exactly 9 unique by area],
  claims: [ClaimProposal, 0..100], assumptions: [Finding, 0..50],
  conflicts: [Finding, 0..50], questions: [MaterialQuestion, 0..20],
  untrusted_instructions: [Finding, 0..50], research_topics: [ResearchTopic, 0..5]
}

ResearchRequestRecipe = closed {
  id: identifier, adapter: exact-https-get-v1, url: exact-https-url[1..2048],
  origin_id: identifier, method: GET, header_profile: public-text-v1, body: null,
  deadline_seconds: int[1..30], max_response_bytes: int[1..2097152],
  recipe_sha256: sha256
}

ResearchQuery = closed {
  schema_version: 1, id: H(*), operation_id: identifier, purpose: text(1000),
  query: text(512), origin_ids: [identifier, 1..5 unique],
  constructed_from: [SourceRef, 1..10], requests: [ResearchRequestRecipe, 1..5],
  max_sources: int[1..5], query_sha256: sha256
}

ResearchSource = closed {
  schema_version: 1, id: H(*), operation_id: identifier, run_id: identifier,
  repository_identity: text(2048), commit_sha: git-commit, query_id: identifier,
  network_authority_ref: AuthorityRef(capability=network-research), approved_origin: exact-https-origin,
  authority_epoch: int[1..20], reservation_id: identifier, reservation_sha256: sha256,
  request_receipt_id: identifier, request_receipt_sha256: sha256,
  final_url: exact-https-url[1..2048], title: text(500), retrieved_at: timestamp,
  content_sha256: sha256, excerpt: text(8192), excerpt_sha256: sha256,
  research_payload_sha256: sha256, untrusted: true
}

ResearchGatewayContext = closed {
  schema_version: 1, operation_id: identifier, query_id: identifier,
  recipe_sha256: sha256, authority_epoch: int[1..20],
  authority: AuthorityRef(capability=network-research),
  subject_sha256: sha256, remaining_requests: int[1..25],
  remaining_bytes: int[1..10485760]
}

OutboundRequestReservation = closed {
  schema_version: 1, id: H(*), operation_id: identifier,
  channel: provider | research, ordinal: int[1..120],
  attempt_id: identifier | null, query_id: identifier | null,
  authority_capability: agent-runtime | network-research,
  authority_receipt_sha256: sha256, authority_epoch: int[0..20],
  request_sha256: sha256, recipe_sha256: sha256 | null,
  reserved_input_tokens: int[0..600000], reserved_output_tokens: int[0..600000],
  reserved_tokens: int[0..600000], reserved_response_bytes: int[0..2097152],
  reserved_active_ms: int[0..30000],
  reserved_at: timestamp
}

OutboundRequestReceipt = closed {
  schema_version: 1, id: H(*), reservation_id: identifier,
  reservation_sha256: sha256, status: completed | failed | interrupted | outcome-unknown,
  completed_at: timestamp, response_status: int[0..599] | null,
  response_bytes: int[0..2097152], active_ms: int[0..120000],
  response_sha256: sha256 | null, final_url: exact-https-url[1..2048] | null,
  research_payload_sha256: sha256 | null,
  usage: closed {input_tokens:int[0..600000], output_tokens:int[0..600000],
    total_tokens:int[0..600000]} | null,
  diagnostic_code: StableErrorCode | null
}

ResearchResultManifest = closed {
  schema_version: 1, id: H(*), operation_id: identifier,
  reservation_id: identifier, reservation_sha256: sha256,
  outcome: success | failure, receipt_sha256: sha256,
  source_sha256: sha256 | null, gap_sha256: sha256 | null,
  research_payload_sha256: sha256 | null, created_at: timestamp
}

GoalAnalysis = closed {
  schema_version: 1, id: H(*), invocation_id: identifier, operation_id: identifier,
  refined_outcome: ReviewItem, affected_areas: [AreaAssessment, exactly 9 unique by area],
  claims: [ClaimProposal, 0..100], assumptions: [Finding, 0..50],
  conflicts: [Finding, 0..50], boundaries: [ReviewItem, 0..50],
  non_goals: [ProposedItem, 0..50], questions: [MaterialQuestion, 0..20],
  acceptance_criteria: [CriterionProposal, 1..50],
  untrusted_instructions: [Finding, 0..50],
  research_source_refs: [ArtifactRef, 0..20], research_gaps: [ResearchGap, 0..50]
}

GoalAnalysisValidation = closed {
  schema_version: 1, id: H(*), invocation_id: identifier, operation_id: identifier,
  producer_analysis_id: identifier, citation_checks: [CitationCheck, 0..100],
  area_checks: [AreaCheck, exactly 9 unique by area],
  question_checks: [QuestionCheck, 0..20 unique by question_id],
  missing_items: [Finding, 0..50], prompt_injection_findings: [Finding, 0..50],
  verdict: valid | conflict | blocked
}

DeveloperAnswer = closed {
  schema_version: 1, id: H(*), run_id: identifier, repository_identity: text(2048),
  commit_sha: git-commit, packet_sha256: sha256, decision_id: identifier,
  option_id: identifier, decision_ref: HumanDecisionRef, actor: human-actor,
  answered_at: timestamp
}

LimitObservations = closed {
  wall_ms: int[0..1800000], stdout_bytes: int[0..10485760],
  stderr_bytes: int[0..10485760], result_bytes: int[0..1048576],
  retained_records: int[0..20], retained_bytes: int[0..20971520],
  temporary_bytes_peak: int[0..268435456], process_peak: int[0..64],
  rss_bytes_peak: int[0..2147483648], provider_requests: int[0..120],
  total_tokens: int[0..600000]
}

CleanupProof = closed {
  oneOf:
    {status: complete, started_at: timestamp, completed_at: timestamp,
     duration_ms: int[0..30000], remaining_processes: 0,
     temporary_paths_remaining: 0, proof_sha256: sha256}
    {status: failed, started_at: timestamp, completed_at: timestamp,
     duration_ms: int[0..30000], remaining_processes: int[0..64],
     temporary_paths_remaining: int[0..20], proof_sha256: sha256}
}

IsolationProof = closed {
  id: H(*), backend: macos-seatbelt-v1, profile_template_sha256: sha256,
  profile_instance_sha256: sha256, snapshot_sha256: sha256,
  probe_codes: [consumer-read-allowed, consumer-write-tracked-denied,
    consumer-write-untracked-denied, consumer-write-ignored-denied, outside-read-denied,
    supervisor-read-denied, attempt-write-allowed, direct-network-denied,
    nested-tool-network-denied, nested-tool-token-absent, parent-proxy-protocol-bounded,
    child-process-owned, cleanup-observable in exact order], nested_tool_network: denied,
  parent_proxy_probe_status: 200, consumer_before_sha256: sha256,
  consumer_after_sha256: sha256, proved_at: timestamp
}

ResearchOriginCandidate = closed {
  id: H(*), origin: exact-https-origin,
  source: developer-input | signed-runtime-registry | agent-suggestion, source_sha256: sha256
}

AgentRuntimeSubject = closed {
  schema_version: 1, id: H(*), repository_identity: text(2048), commit_sha: git-commit,
  descriptor_sha256: sha256, implementation_sha256: sha256, executable_sha256: sha256,
  profile_template_sha256: sha256, profile_id: identifier, model_id: text(256),
  control_plane_origins: [exact-https-origin, 1..5 unique],
  phases: [analysis-plan, analysis-synthesis, analysis-validation in exact order],
  max_attempts_per_phase: 2, max_agent_attempts: 6, max_provider_requests: 120,
  provider_request_deadline_seconds: 120,
  max_active_execution_seconds: int[60..3600], max_total_tokens: int[1..600000],
  consumer_write: false, reversibility: revocable-before-next-external-action
}

NetworkResearchSubject = closed {
  schema_version: 1, id: H(*), operation_id: identifier, query_set_sha256: sha256,
  queries: [ArtifactRef, 1..5], origins: [ResearchOriginCandidate, 1..10],
  max_queries: int[1..5], max_sources_per_query: int[1..5],
  max_requests: int[1..25], max_redirects_per_request: int[0..3],
  max_response_bytes: int[1..2097152], max_total_bytes: int[1..10485760],
  request_deadline_seconds: int[1..30],
  reversibility: revocable-before-next-request
}

CitationCheck = closed {
  id: H(*), proposal_id: identifier, source_ref: SourceRef, exists: boolean, supports: boolean,
  max_supported_class: detected | documented | code-confirmed | conflict | unverified | not-covered,
  finding_ids: [identifier, 0..10 unique]
}

AreaCheck = closed {
  id: H(*), area: SystemArea, applicable: boolean, covered: boolean, conflict: boolean,
  source_refs: [SourceRef, 1..10], finding_ids: [identifier, 0..10 unique]
}

QuestionCheck = closed {
  id: H(*), question_id: identifier, complete: boolean,
  material_dimensions: [MaterialDimension, 1..11 unique],
  source_refs: [SourceRef, 1..10], finding_ids: [identifier, 0..10 unique]
}

TraceabilityMapping = closed {
  item_id: identifier, item_kind: section-item | decision | criterion | non-goal |
    claim | area | blocker, source_refs: [SourceRef, 1..10]
}

ReviewItem = closed {
  id: identifier, text: text(4000), source_refs: [SourceRef, 1..10]
}

AreaDecision = closed {
  id: H(*), area: SystemArea, status: applicable | not-applicable | conflict | gap,
  summary: text(2000), claim_ids: [identifier, 0..50 unique], source_refs: [SourceRef, 1..10]
}

ClassifiedClaim = closed {
  id: identifier, area: SystemArea, text: text(2000),
  status: detected | documented | code-confirmed | test-confirmed | runtime-observed |
    conflict | unverified | not-covered,
  source_refs: [SourceRef, 1..10], validator_check_ids: [identifier, 1..10 unique]
}

MaterialDecision = closed {
  id: identifier, question: text(2000), why_now: text(1000), impact: medium | high,
  reversibility: reversible | costly | irreversible, recommended_option_id: identifier,
  options: [DecisionOption, 2..3], material_dimensions: [MaterialDimension, 1..11 unique],
  source_refs: [SourceRef, 1..10]
}

ResearchGap = closed {
  id: identifier, query_id: identifier, reason: not-authorized | denied | expired |
    timeout | limit | unavailable | outcome-unknown | conflict, summary: text(1000),
  source_refs: [SourceRef, 1..10]
}

OperationJournalRecord = closed {
  schema_version: 1, id: H(*), operation_id: identifier, sequence: int[1..100],
  previous_sha256: sha256 | null, type: operation-created | phase-started | phase-finished |
    agent-authority-paused | agent-authority-attached | research-subject-created |
    research-authority-attached | research-authority-denied |
    research-gap-recorded | cancellation-fenced | result-prepared | result-committed |
    operation-failed, occurred_at: timestamp,
  data: closed type-specific ids/digests/status only,
  actor: runtime | supervisor-verified-foreground-human
}

OperationLease = closed {
  schema_version: 1, operation_id: identifier, owner_id: identifier,
  boot_id: text(256), pid: int[1..2147483647], process_birth_id: text(256),
  acquired_at: timestamp, wall_expires_at: timestamp, heartbeat_sequence: int[0..1000000],
  heartbeat_at: timestamp
}

PreparedManifest = closed {
  schema_version: 1, id: H(*), transaction_id: identifier, operation_id: identifier,
  expected_current_sequence: int[1..1000000], expected_current_sha256: sha256,
  target_sequence: int[2..1000001], target_checkpoint_sha256: sha256,
  files: [closed {storage_key: relative-key, sha256: sha256, size_bytes: int[0..20971520]}, 1..1000000],
  total_size_bytes: int[1..1073741824],
  created_at: timestamp
}

CommitIntent = closed {
  schema_version: 1, id: H(*), operation_id: identifier, transaction_id: identifier,
  prepared_manifest_sha256: sha256, expected_current_sequence: int[1..1000000],
  expected_current_sha256: sha256, target_sequence: int[2..1000001],
  target_checkpoint_sha256: sha256, intent_at: timestamp
}

CommittedReceipt = closed {
  schema_version: 1, id: H(*), operation_id: identifier, transaction_id: identifier,
  commit_intent_sha256: sha256, checkpoint_sha256: sha256,
  current_pointer_sha256: sha256, committed_at: timestamp
}

TerminalFence = closed {
  schema_version: 1, id: H(*), operation_id: identifier,
  kind: cancel | commit, created_at: timestamp,
  expected_journal_head_sha256: sha256,
  prepared_manifest_sha256: sha256 | null,
  requested_by: actor
}
```

Conditional rules are normative: a succeeded AgentAttempt/AgentAttemptOutput requires
`termination_reason=completed`, zero exit code, complete cleanup, required trusted usage and a
result/result path; every non-success forbids a promoted result. `descriptor_sha256`, `query_sha256`,
`recipe_sha256`, cleanup/isolation proof digests and all `H(*)` identifiers are recomputed before use.
Timestamp pairs must be ordered, token totals equal input plus output, every option list has exactly
one recommended item, and every `line_end >= line_start`. These are runtime integrity checks in
addition to structural JSON Schema validation.

`TerminalFence(kind=cancel)` requires `prepared_manifest_sha256=null`; `kind=commit` requires a valid
prepared manifest digest and runtime actor. `CleanupProof(status=complete)` requires both remaining
counts zero; any failed cleanup forces the attempt rule above. All control records use atomic
no-replace publication; lease is the sole atomic-replace exception.

`OutboundRequestReservation(channel=provider)` requires non-null attempt, null query/recipe,
`agent-runtime` capability, epoch 0, positive token reservation and zero reserved response bytes;
reserved tokens equal reserved input plus output. The
proxy reserves a conservative input upper bound of request UTF-8 bytes plus the enforced
`max_output_tokens` before forwarding; provider reserved active time is zero because the enclosing
AgentAttemptReservation already reserves its full deadline. `channel=research`
requires null attempt, non-null query/recipe,
`network-research` capability, epoch 1..20, all three token fields zero and the recipe's maximum response
bytes/30-second deadline; its ordinal is <=25. A completed provider receipt requires trusted usage, null final URL/research
payload and a response digest. A completed research receipt requires usage null, final URL, response
digest and `research_payload_sha256 = D("research-payload", {final_url,title,content_sha256,
excerpt_sha256}, [])`.
Aggregate accounting uses actual durable usage/bytes/active time only for a completed receipt with all
required trustworthy measurements. Failed/interrupted/missing/outcome-unknown requests retain their
full reservation regardless of partial observed fields. Active-time accounting uses terminal
AgentAttempt duration when present; because AgentAttemptReservation is created before worker start, a
missing terminal attempt consumes its full deadline, including startup, tools and request gaps.
Gateway requests use completed receipt `active_ms` or full reserved active time otherwise. Unused
reservation is released only after the
receipt is durable. Work may continue only when this worst-case accounting remains below every
approved ceiling; the request is never resent.

Every ResearchSource must reference the exact research reservation/receipt; its authority epoch,
final URL, response/content digest and research-payload digest must match those records. A mismatched
or absent link is an integrity failure and the source cannot enter synthesis.

A research result is never published as independent files. Success stages
`{receipt,source,manifest(outcome=success)}`; known failure or crash recovery stages
`{receipt,gap,manifest(outcome=failure)}`. After fsync, the whole same-filesystem directory is atomically
renamed to `terminal` and its parent is fsynced. Recovery sees exactly one valid three-record variant or
none. A crash before promotion discards staging, charges the full reservation, creates an
`outcome-unknown` receipt/gap transaction and never replays the request. Success requires non-null
source/payload and null gap; failure requires null source/payload and non-null gap.

The exact `OperationJournalRecord.data` `oneOf` variants are:

```text
operation-created = closed {operation_sha256}
phase-started = closed {phase, attempt_id, attempt_no, invocation_sha256}
phase-finished = closed {phase, attempt_id, attempt_no, attempt_sha256,
  status:succeeded|blocked|failed|cancelled|timed-out}
research-subject-created = closed {subject_id, subject_sha256, query_set_sha256}
agent-authority-paused = closed {subject_sha256, phase, prior_receipt_sha256, expired_at}
agent-authority-attached = closed {subject_sha256, phase, request_id, request_sha256,
  receipt_id, receipt_sha256, expires_at}
research-authority-attached = closed {subject_sha256, epoch:int[1..20],
  request_id, request_sha256, receipt_id, receipt_sha256, expires_at}
research-authority-denied = closed {subject_sha256, request_id, request_sha256,
  receipt_id, receipt_sha256, decided_at}
research-gap-recorded = closed {gap_id, gap_sha256, query_id, reason}
cancellation-fenced = closed {fence_sequence:int[1..100], requested_by:actor, requested_at}
result-prepared = closed {transaction_id, prepared_manifest_sha256,
  expected_current_sha256, target_checkpoint_sha256}
result-committed = closed {transaction_id, committed_receipt_sha256, checkpoint_sha256}
operation-failed = closed {code:StableErrorCode, phase?, attempt_id?, diagnostic_sha256?}
```

All untyped names above use their previously defined primitive/enum. Journal variants contain no free
prose. The implementation JSON Schema uses `oneOf` keyed by the outer `type`; a mismatched variant or
extra field fails validation.

Array bounds for model results are fixed: nine AreaAssessments; 0..100 claims; 0..50 each assumptions,
conflicts, non-goals, untrusted instructions and gaps; 0..20 questions; 1..50 criteria; 0..5 research
topics/queries; 0..20 retained ResearchSources (the lower aggregate record ceiling wins); exactly one CitationCheck per claim with a confirmed candidate
class, nine AreaChecks and exactly one QuestionCheck per question. Each SourceRef array is 1..10.

AlignmentBundle is precisely `closed {schema_version:1,id:H(*),operation_id,run_id,
repository_identity,commit_sha,goal_ref,developer_answer_refs[0..20],agent_descriptor,
analysis_plan_ref,research_source_refs[0..20],research_gaps[0..50],goal_analysis_ref,
validation_ref,refined_outcome:ReviewItem,boundaries[0..50 ReviewItem],
area_decisions[exactly 9],classified_claims[0..100],
assumptions[0..50],conflicts[0..50],non_goals[0..50 ReviewItem],
material_decisions[0..20 MaterialDecision],
acceptance_criteria[1..50],traceability[1..500],blocking_ids[0..100],omitted_count:int[0..100],
verdict:question-blocked|ready,policy_version_sha256}`. Every named value uses the closed common type
above; no raw Agent text or optional provider field is permitted.

## Integrity and Secret Handling

- Every cross-record run, repository, revision, operation, phase, authority and digest must match.
- Producer and validator invocation/execution-instance/isolation-proof identities must differ.
- Final claim class cannot exceed direct source support; `not-applicable` needs deterministic absence
  or a current DeveloperAnswer.
- Raw Agent output exists only in the private temporary attempt directory. Before promotion, the
  runtime parses bounded bytes, neutralizes active/control content, rejects unknown fields, compares
  every string in memory against non-empty inherited/provider credential values, applies credential
  and private-key pattern detection, and fails closed on any match. Only the sanitized canonical
  result is persisted; raw bytes are deleted during cleanup.
- Agent results, research and repository prose never become execution evidence or authority.

## Storage and Recovery

```text
operations/<operation-id>/operation.json
operations/<operation-id>/journal/<sequence>.json
operations/<operation-id>/attempts/<phase>/<attempt-no>/reservation.json
operations/<operation-id>/attempts/<phase>/<attempt-no>/invocation.json
operations/<operation-id>/attempts/<phase>/<attempt-no>/attempt.json
operations/<operation-id>/attempts/<phase>/<attempt-no>/result.json
operations/<operation-id>/outbound/<channel>/<ordinal>/reservation.json
operations/<operation-id>/outbound/provider/<ordinal>/receipt.json
operations/<operation-id>/outbound/research/<ordinal>/terminal/manifest.json
operations/<operation-id>/outbound/research/<ordinal>/terminal/receipt.json
operations/<operation-id>/outbound/research/<ordinal>/terminal/source.json | gap.json
operations/<operation-id>/lease.json
operations/<operation-id>/staging/<transaction-id>/*
operations/<operation-id>/prepared/<transaction-id>/manifest.json
operations/<operation-id>/prepared/<transaction-id>/checkpoint/*
operations/<operation-id>/terminal-fence.json
operations/<operation-id>/commit-intent.json
operations/<operation-id>/committed.json
checkpoints/<sequence>/artifacts/artifact-alignment-bundle.json
checkpoints/<sequence>/artifacts/artifact-developer-answer-<id>.json
```

Operation, attempt, journal, promoted preparation, intent and receipt paths use create-only semantics.
Lease replacement uses the verified stale-owner quarantine protocol in the orchestration contract.
Commit intent binds the full PreparedManifest, expected current pointer and exact next checkpoint.
Restart reconciliation completes one missing deterministic promote/intent/pointer/receipt step or
blocks on contradiction; it never regenerates checkpoint bytes or reruns an Agent merely because a
commit receipt is missing.

The AC-14 256 MiB temporary and 20 MiB/20-record retained ceilings meter the current Agent operation's
attempt scratch and newly promoted Agent-derived artifacts. PreparedManifest may also enumerate the
existing Goal Run history copied by the current checkpoint layout; those pre-existing immutable files
do not count again as new Agent records. The complete prepared checkpoint has a separate 1 GiB hard
ceiling, and the manifest proves: newly added Agent artifact count <=20, newly added bytes <=20 MiB,
attempt scratch peak <=256 MiB, and total checkpoint bytes <=1 GiB. Any violation fails before the
commit fence.

## Migration

No database or consumer migration. `agent-runtime` and optional `reversibility` are additive schema
fields; legacy stored capabilities/packets remain readable. New live Agent requests require the new
fields. Runs without `operations/` are legacy static runs and are never auto-invoked.
