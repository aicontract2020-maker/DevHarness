# Capability Authorization Checkpoint

Status: Approved for implementation
Version: 1.0
Mode: Full
Last updated: 2026-08-31

## Overview

Turn the bounded capabilities in a current Alignment Brief into informed, signed and auditable
developer decisions without allowing an Agent or command caller to redefine what is being approved.

## Boundaries

**Always do:** derive requests from intact current-run artifacts; show the exact operation, target,
scope, reason, risk, authority and expiry; bind decisions to repository, run and revision; fail
closed on stale, forged, missing or conflicting state.

**Never do:** accept a caller-provided capability hash; approve through JSON, pipes or the review
page; treat a pending request as permission; execute consumer commands; mutate the consumer repo.

## Acceptance criteria

### AC-1: Derived request only [MUST]

Given a current `clarifying` Goal Run, when a developer requests one named capability, then the
subject ID and hash are derived from the exact capability object in the checkpoint's intact
onboarding plan; an unknown, stale, wrong-run or caller-defined subject is rejected.

### AC-2: Informed foreground decision [MUST]

Given a valid capability request, when the foreground approval prompt opens, then it displays the
capability, operation, target, complete scope, reason, risk, authority, revision and expiry before
accepting the exact approve or reject phrase.

### AC-3: Signed immutable binding [MUST]

Given a recorded decision, when authorization is evaluated, then only a verified current Supervisor
receipt whose request, run, repository, revision, gate, subject hash, nonce and expiry all match can
produce `approved` or `rejected`.

### AC-4: Honest status model [MUST]

Given the current capability plan and Supervisor state, when status is computed, then every
capability is classified as `unrequested`, `pending`, `approved`, `rejected`, `expired` or `stale`,
and only `approved` represents authority to proceed.

### AC-5: Compact developer review [MUST]

Given a live review page, when it loads an Alignment Brief, then it shows one capability decision
panel with exact bounded details, status counts and the single next command; it does not expose an
approval mutation.

### AC-6: Read boundary remains closed [MUST]

Given the capability review endpoint, when a request has the wrong origin, token, method, run ID or
tampered stored source, then no capability data is returned and no state changes.

### AC-7: Consumer isolation [MUST]

Given request, status, approval and review operations, when consumer Git status is compared before
and after, then no framework state or approval artifact exists in the consumer repository.

### AC-8: Existing generic gates remain compatible [SHOULD]

Given scope, strategy or delivery approval, when their existing callers use a hashed subject, then
the approval request and receipt contracts remain valid without capability presentation data.

## Non-functional requirements

- Computed status is deterministic for an explicit evaluation time.
- The review surface remains GET-only, loopback-only, no-store and token-bound.
- Capability detail is rendered in at most one card per request; the first summary line contains the
  total and counts by decision status.
- Approval request and receipt files remain mode 0600 under Supervisor-owned mode 0700 directories.

## Out of scope

- Executing an approved browser, service, container, database or dependency operation.
- Generating or accepting project configuration.
- Defining acceptance criteria or granting the scope gate.
- Browser-based approval or remote approval.
- Agent teams, implementation, PR, deployment or merge.

## Open questions

None.

