# Research: Capability Authorization

Status: Complete
Last updated: 2026-08-31

## Current system

- Onboarding already creates bounded capability requests with operation, target, scope, reason,
  risk, authority and a pending decision. `packages/project/src/onboard.mjs:10`
- The current Alignment Brief stores the exact onboarding plan as a hashed source artifact outside
  the consumer repository. `packages/project/src/alignment.mjs:20`
- Supervisor approval requests and immutable receipts already support the `capability` gate and bind
  run, repository, revision, subject hash, nonce and expiry. `packages/runtime/src/supervisor-approval.mjs:14`
- Approval currently accepts caller-provided subject IDs and hashes, so it does not prove that a
  capability subject came from the current Goal Run. `packages/cli/src/cli.mjs:311`
- The foreground approval prompt currently shows only a subject ID and hash, not the concrete
  operation, target, scope, risk or reason. `packages/runtime/src/supervisor-approval.mjs:91`
- Goal Run checkpoints contain the source artifacts needed to derive the exact capability subject,
  but expose no safe artifact loader. `packages/runtime/src/goal-run-store.mjs:124`
- The review service is intentionally read-only and already authenticates exact-origin, token-bound
  GET requests. `packages/runtime/src/review-server.mjs:36`

## Conflicts and gaps

- [CONFLICT] The constitution says approval cannot be expanded by an Agent, while the generic
  `request-approval` command currently lets its caller choose a capability subject and hash.
- [CONFLICT] A cryptographically correct approval is not an informed approval if the developer sees
  only an opaque hash.
- [GAP] No current read model combines the onboarding capability request with signed request and
  receipt status.
- [GAP] Current status and review UI cannot distinguish unrequested, pending, approved, rejected,
  expired or stale capability authorization.

## Decision

Derive capability approval subjects only from the current checkpoint's intact onboarding artifact.
Present the exact bounded request during foreground approval. Publish a read-only, computed
authorization view for CLI status and the review page. Do not execute consumer code in this phase.

## Not investigated

- Browser, simulator and disposable-database driver implementation.
- Mapping approved capabilities onto project-harness commands.
- Independent OS authentication of the person at the foreground terminal.

