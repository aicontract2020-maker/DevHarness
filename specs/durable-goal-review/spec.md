# Durable Goal Run Review

Status: Approved for implementation
Version: 1.0
Mode: Full
Last updated: 2026-08-31

## Overview

Let a developer create a real durable Goal Run, inspect it after process interruption, and connect
the developer review page to current run scorecards without writing runtime state into the target
repository or exposing it to unrelated browser pages.

## Assumptions resolved

- The first stored run begins at goal intake and is blocked until later understanding, scope and
  evidence stages produce their artifacts.
- The review transport is local and read-only. A hosted control plane is not required.
- A goal starts only from a clean committed repository revision.
- The sample scorecard remains available when no live runtime is connected.

## Boundaries

**Always do:** bind runs to repository identity and revision; restore from validated events; keep
state external; validate every returned scorecard; authenticate local review reads; show data source.

**Never do:** execute an agent from goal intake; infer acceptance criteria from the goal; expose
runtime data to arbitrary origins; let the page approve, mutate or repair a run; hide invalid runs.

## Acceptance criteria

### AC-1: Durable goal intake [MUST]

Given a clean committed repository and a non-empty goal, when the developer starts a Goal Run, then
one schema-valid snapshot, creation event and blocked initial scorecard are atomically stored outside
the repository with private file permissions.

### AC-2: Event-backed recovery [MUST]

Given a stored run, when the snapshot is reloaded after process interruption, then the result is
reconstructed from a contiguous validated event stream and any contradictory snapshot is rejected.

### AC-3: Safe duplicate and corrupt handling [MUST]

Given an existing run identifier, malformed event, symlink or tampered scorecard, when storage is
created or listed, then the unsafe item is rejected or omitted and never replaces valid state.

### AC-4: Compact run status [MUST]

Given a stored run identifier, when the developer asks for status, then the current state, revision,
review verdict, blocking count and one next action are returned without reading raw artifacts.

### AC-5: Authenticated local review transport [MUST]

Given a local review service, when a browser requests run data, then reads succeed only with the
process-issued token and exact configured page origin; other origins, missing tokens, mutation
methods and path traversal are denied.

### AC-6: Live run selection [MUST]

Given two valid stored runs, when the page connects to the local review service, then it lists both,
loads the selected scorecard and refreshes current data at least every five seconds.

### AC-7: Honest disconnected and initial states [MUST]

Given no live service or a newly created run with no acceptance evidence, when the page renders,
then it visibly distinguishes sample from runtime data and the new run remains blocked with zero
proof coverage rather than appearing executable or complete.

### AC-8: Consumer repository isolation [MUST]

Given goal creation, status and review reads, when the workflow completes, then the consumer Git
working tree is byte-for-byte unchanged.

### AC-9: Read response bound [SHOULD]

Given up to 100 stored runs on a local filesystem, when the run index is requested, then the service
returns at most 100 summaries and no raw event or artifact bodies.

## Non-functional requirements

- Runtime JSON files use mode 0600 and directories use mode 0700.
- Review responses use `no-store`; the access token has at least 256 bits of entropy.
- The service binds only to a loopback address and returns at most 100 run summaries.
- Polling is fixed at five seconds and stops when the page unmounts.

## Out of scope

- Agent invocation, clarification, research, planning, implementation or repair.
- Scope or delivery approval from the web page.
- Hosted storage, remote access, authentication accounts or collaboration.
- Pull requests, merge, deployment and production monitoring.
- Editing or deleting stored runs.

## Open questions

None.
