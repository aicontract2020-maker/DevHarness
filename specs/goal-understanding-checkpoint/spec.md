# Goal Understanding Checkpoint

Status: Approved for implementation
Version: 1.0
Mode: Full
Last updated: 2026-08-31

## Overview

Advance a newly received Goal Run through read-only repository discovery and publish one compact,
traceable Alignment Brief that tells the developer what is known, what is unproved and why scope
approval is not yet available.

## Boundaries

**Always do:** bind every result to the run repository and revision; preserve an append-only event
history; trace visible claims to stored artifacts; fail closed on stale or incomplete understanding.

**Never do:** modify the consumer repository; execute consumer commands; install dependencies;
start a service; invent acceptance criteria; issue or record a scope approval from static detection.

## Acceptance criteria

### AC-1: Safe single-step advance [MUST]

Given a `received` Goal Run and its unchanged clean committed repository, when `advance --run ID`
runs, then it performs read-only discovery and reaches `clarifying`; a dirty tree, changed revision,
wrong repository or later state is rejected before publication.

### AC-2: Revision-bound understanding artifacts [MUST]

Given a valid advance, when discovery finishes, then the exact repository snapshot and onboarding
plan are schema-valid, hash-addressed and stored outside the consumer repository.

### AC-3: Honest compact Alignment Brief [MUST]

Given static understanding only, when the packet is compiled, then it shows the original outcome,
confirmed project facts, highest-priority gaps and missing acceptance definition; every visible item
maps to a hashed source artifact and omitted detail is counted.

### AC-4: Approval remains unavailable [MUST]

Given unproved runtime, database, security or acceptance facts, when the brief is published, then its
verdict requires action, it contains no approve action or approval request, and policy rejects a
ready Alignment Brief that lacks explicit gate-approval attention.

### AC-5: Atomic event-backed checkpoint [MUST]

Given multiple transition and artifact events, when the checkpoint is published, then one atomic
pointer makes the complete event stream, replayed snapshot, scorecard, packet and artifacts current;
an incomplete orphan checkpoint is ignored.

### AC-6: Review page presents the current checkpoint [MUST]

Given a run with a current interaction packet, when the authenticated review page refreshes, then it
shows the Alignment Brief sections, action status, source count, omitted count and current run state.

### AC-7: Existing read security remains enforced [MUST]

Given the new interaction endpoint, when a request has the wrong origin, token, method, run ID or an
invalid stored packet, then no packet is returned and no mutation is possible.

### AC-8: Consumer isolation [MUST]

Given a complete advance and review read, when Git status is compared before and after, then the
consumer working tree is unchanged.

### AC-9: Legacy intake remains readable [SHOULD]

Given a sequence-one run created before checkpoint pointers existed, when it is loaded, then its
event, snapshot and scorecard remain readable and its interaction endpoint returns not found.

## Non-functional requirements

- Checkpoint directories use mode 0700 and JSON files use mode 0600.
- One checkpoint contains a complete event stream so recovery needs one immutable directory plus one
  atomic pointer.
- The Alignment Brief exposes at most four compact sections and no more than five gap items.
- The review endpoint remains loopback-only, GET-only, no-store and bounded by the existing token.

## Out of scope

- Executing capability requests or collecting E2–E4 runtime proof.
- Asking or answering material product questions.
- Generating acceptance criteria, requirements, a plan, tasks or code.
- Creating, approving or rejecting the scope gate.
- Agent teams, parallel execution, pull requests, deployment or merge.

## Open questions

None.
