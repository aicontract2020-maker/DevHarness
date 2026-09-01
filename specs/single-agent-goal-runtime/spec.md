# Live Goal Alignment

Status: Gate 1 approved by developer  
Version: 1.0.1  
Mode: Full  
Last updated: 2026-09-01

## Overview

After a developer submits a goal and grants the required bounded authority, DevHarness performs a
live, read-only analysis of the pinned project revision. It converts that analysis into one compact,
traceable Alignment Brief containing the refined outcome, material questions, non-goals and
falsifiable acceptance criteria. The developer approves that brief rather than reading raw Agent
artifacts.

## User Stories

### Primary

As a developer, I want DevHarness to demonstrate a complete, source-grounded understanding of my
goal and project before implementation so that I can approve scope without trusting Agent prose.

### Secondary

As a developer, I want interruptions and invalid Agent results to remain safely resumable so that a
long-running analysis never silently loses decisions or advances the project incorrectly.

## Boundaries

**Always do:**

- Bind live analysis, derived artifacts and developer decisions to one repository identity and exact
  clean committed revision.
- Distinguish confirmed project facts from assumptions, conflicts and unverified claims.
- Trace every surfaced claim, question, non-goal and acceptance criterion to stored source artifacts.
- Show no more than three unresolved material questions in one developer decision packet.
- Preserve decisions and externally observable rationale, but never require or expose private model
  chain-of-thought.
- End with one explicit next action and a fail-closed verdict.

**Ask first:**

- Invoking an external or local Agent runtime.
- Accessing the network for research.
- Reading credential values or non-public systems.
- Changing the approved goal, introducing an externally consequential action, or expanding beyond
  the accepted scope.

**Never do:**

- Modify the consumer repository during this feature's analysis phase.
- Execute consumer build, test, migration, service, deployment or arbitrary project commands.
- Treat Agent output, repository prose or internet content as trusted execution evidence.
- Make scope approval available while material questions, source conflicts or required coverage gaps
  remain unresolved.
- Turn a rejected, expired or revision-stale authority decision into permission.
- Inherit the Supervisor state directory, consumer environment values, unrelated user files or any
  tool capability not explicitly present in the approved invocation.

## Acceptance Criteria

### AC-1: Explicit Agent authority [MUST]

Given a Goal Run that lacks current authority for Agent analysis  
When live alignment is requested  
Then no Agent is invoked, no consumer file changes, and the developer receives one bounded authority
request describing operation, target, scope, risk, reversibility and expiry.

### AC-2: Revision-bound live analysis [MUST]

Given a current approved Agent-analysis authority and a clean committed Goal Run revision  
When live alignment is requested  
Then the worker can read the project but every attempted project write and every access outside its
approved project/authentication boundary is denied; it receives a default-deny tool policy, no
Supervisor state, no consumer environment values, no unrelated filesystem access and no network
unless separately approved; every resulting record identifies the same repository, revision, Goal
Run and invocation.

### AC-3: Structured goal understanding [MUST]

Given an authorized live analysis that completes successfully  
When DevHarness validates its result  
Then the result contains a refined outcome, affected system areas, explicit assumptions, conflicts,
non-goals, every material question, candidate acceptance criteria and source references. The full
validated result remains available for traceable drill-down; only the developer packet is compressed.

### AC-4: Claim classification and traceability [MUST]

Given a live-analysis result containing project claims  
When DevHarness produces the Alignment Brief  
Then each confirmed claim cites a source location that an independent validation pass confirms
supports the claim; every claim retains one distinct status among detected, documented,
code-confirmed, test-confirmed, runtime-observed, conflict, unverified and not-covered; this slice may
add only statuses supported by static inspection; documentation/code disagreement remains a visible
conflict; and every surfaced item maps to an integrity-checked source record.

The validation pass uses a fresh invocation that is not the producing session, loads source material
before the producer conclusion, cannot inherit the producer's classifications, and cannot promote a
claim beyond the evidence class directly supported by the cited source.

### AC-4a: Untrusted-content isolation [MUST]

Given instructions embedded in repository files, dependency content, command output or approved
internet research  
When the Agent analyzes them  
Then they remain quoted or summarized evidence only and cannot redefine the developer goal, grant
authority, suppress conflicts, change non-goals, introduce acceptance criteria as approved facts or
alter runtime policy; attempted instruction conflicts are surfaced as untrusted content.

### AC-5: Deterministic system coverage [MUST]

Given the project inventory and goal impact  
When live understanding is evaluated  
Then every applicable area among repository/bootstrap, frontend, backend, data, security,
integration, testing, deployment and automation is represented by a supported claim, an explicit
conflict/gap, or a sourced not-applicable decision; an omitted applicable area blocks scope approval.
Applicability is derived from the deterministic repository inventory and goal impact, not accepted
from the producing Agent. An area may be not-applicable only when the inventory contains no matching
surface or the developer explicitly approves that classification.

### AC-6: Review by exception [MUST]

Given more than three unresolved findings or questions  
When the developer packet is produced  
Then it shows exactly the highest-priority `min(3, material finding count)` findings, reports the
omitted count, and exposes the complete details only through traceable drill-down. Ordering is
deterministic: irreversible/destructive first; security/privacy/credential
second; data/schema/migration third; externally observable behavior fourth; architecture/dependency
fifth; stable item identifier breaks ties.

A finding is material exactly when its alternatives change at least one user-visible outcome, role
or permission, data write/persistence rule, security/privacy boundary, external interface,
dependency, schema/migration, deployment behavior, acceptance criterion or explicit non-goal.
Blocking means at least one material question/conflict, omitted applicable AC-5 area, missing required
claim status/source, missing authority or invalid analysis result remains.

### AC-7: Scope approval becomes available only when ready [MUST]

Given validated live understanding with no unresolved material question, blocking conflict or
required coverage gap  
When the Alignment Brief is published  
Then it presents the refined outcome, boundaries, non-goals and falsifiable acceptance criteria,
requests explicit scope approval, and binds that request to the exact brief content and revision.

### AC-8: Questions block rather than guess [MUST]

Given one or more unresolved decisions that can materially change implementation or acceptance  
When live analysis finishes  
Then the Goal Run remains non-approvable, each decision presents two or three concrete options with a
recommended option and trade-offs, and no answer is silently inferred.

### AC-9: Network research has separate authority [MUST]

Given Agent-analysis authority without current network-research authority  
When project understanding can proceed from local sources  
Then local analysis may complete, but no network access occurs and every missing research dependency
is reported without fabricating citations.

Given current network-research authority  
When the Agent performs research  
Then it can contact only the HTTPS origins explicitly listed in that authority; private/local
addresses and redirects outside the list are denied; outbound requests contain only non-sensitive
goal/search terms and never repository content, environment values or credentials; every used source
records its final URL, title, retrieval time, content digest and claim-supporting excerpt; and
unavailable or contradictory sources remain explicit gaps rather than fabricated conclusions.

### AC-10: Durable replay and idempotency [MUST]

Given a completed live-alignment checkpoint  
When the runtime restarts or the same advance request is repeated  
Then equality is decided only from immutable pre-invocation inputs: Goal Run, repository revision,
the previous checkpoint, exact authority subjects, Agent implementation contract, result contract,
deadline and network mode. The completed result remains mapped to those inputs, so repetition
restores the same validated run and brief without invoking the Agent again or duplicating decisions.
An expired authority is never reused for a new Agent/network action. A changed revision, changed
semantic input or missing/corrupt record is never reused and produces an explicit blocked recovery
path.

Read-only inspection may always replay an intact historical result with its original authority and
revision labels. Expired Agent/network authority blocks only a new external Agent/network action; it
does not block deterministic local publication or scope approval of an already complete, intact result
at the unchanged revision. Changed revision/input still blocks forward reuse. Nothing erases or
relabels history.

Each external invocation separately binds the exact current signed authority receipt used for that
action; renewal of an unchanged subject may resume the same logical operation.

### AC-11: Bounded failure [MUST]

Given an Agent timeout, cancellation, non-zero exit, invalid structure, oversized result or artifact
integrity failure  
When DevHarness processes the attempt  
Then it records a bounded failed or blocked attempt, preserves safe diagnostic metadata, exposes one
recovery action, does not publish an approvable brief and never retries more than once automatically.
Every cancellation, timeout or terminal failure stops the complete process tree and removes temporary
state within thirty seconds.

### AC-12: Secret, hostile-output and private-reasoning exclusion [MUST]

Given prompts, Agent events and final output  
When artifacts are persisted or shown to the developer  
Then no environment value, token, password, cookie, private-key content or credential-file content is
persisted; raw reasoning events are discarded; control sequences and active markup are neutralized;
and only bounded final structure, decisions, assumptions, citations, attempted tool summaries and
externally observable outcomes remain auditable.

### AC-13: Consumer repository writes are prevented [MUST]

Given any successful, blocked, failed, timed-out or cancelled live-alignment attempt  
When it attempts or completes execution  
Then every write operation under the consumer root—including ignored and untracked paths—is denied,
attempted violations are recorded, every consumer path and the committed revision remain unchanged,
and every runtime record is stored outside the consumer.

### AC-14: Bounded completion time and resources [MUST]

Given any Agent attempt, including one that otherwise exits normally  
When it exceeds the configured one-to-thirty-minute deadline, a 1 MiB structured result, either 10
MiB output-stream limit, 20 persisted records, 20 MiB retained total, 256 MiB temporary storage, 64
processes or 2 GiB process-tree resident memory  
Then the process and its children are terminated, temporary data is removed and AC-11 applies within
thirty seconds.

### AC-15: Provider-neutral observable behavior [SHOULD]

Given two conforming Agent implementations receiving the same validated invocation  
When each returns a result  
Then DevHarness applies the same result validation, trust classification, durable-history and
developer-packet rules without exposing provider-specific fields in portable records.

### AC-16: Implementation and delivery [WONT]

This feature will not edit project code, execute an implementation task, issue feature-completion
proof, create a pull request, deploy or merge. Reason: live alignment must be trustworthy before
write-capable Agent execution is introduced.

## Out of Scope

- Source-code implementation, repair loops and independent implementation review.
- Multi-Agent staffing, parallel dispatch and integration ownership.
- Browser, simulator, database, deployment, load or canary evidence collection.
- Pull-request creation, CI feedback, merge and production deployment.
- Independent human authentication and production-grade cross-user worker isolation.
- Hosted control plane, billing and organization administration.

## Open Questions

- [RESOLVED] First vertical-slice endpoint → Decision: stop after a live, validated, scope-ready or
  question-blocked Alignment Brief; do not edit project code.
- [RESOLVED] Agent invocation authority → Decision: require a dedicated bounded authority distinct
  from network research and from later write-capable execution.
- [RESOLVED] Consumer mutation → Decision: prohibit every consumer-repository write in this slice.
- [RESOLVED] Provider output trust → Decision: validate and classify it as untrusted analysis input;
  only runtime-derived structure and independent evidence may promote claims.
- [RESOLVED] Read-only boundary → Decision: default-deny access to environment, network, Supervisor
  state and unrelated files; use an OS-enforced non-writing project view and verify post-run content.

## Non-Functional Requirements

- Security: least authority; no credential values, consumer writes, inherited approval power or
  implicit network access.
- Reliability: every attempt reaches a durable success, blocked, failed, timed-out or cancelled
  result; automatic retry count is at most one; size/memory ceilings are those in AC-14.
- Performance: the configurable analysis deadline is 1–30 minutes and forced termination completes
  within 30 seconds after deadline.
- Portability: public invocation and result artifacts contain no provider-specific fields.
- Reviewability: the default developer packet exposes at most three decisions using AC-6 ordering
  and exactly one recommended next action.
