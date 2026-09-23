# ADR 0007: Supervisor-issued provenance

Status: Accepted

## Context

Revision-bound command receipts detected stale code and artifact tampering, but any process able to write matching JSON could still fabricate them. Approval schemas also contained declarative human fields, while the state machine accepted caller booleans. These were false-trust paths.

## Decision

Use a pinned Ed25519 Supervisor identity, canonical domain-separated signatures, create-only external storage, sealed evidence drivers and a Supervisor-owned foreground TTY. Only verified signed manifests may promote readiness. Scope and delivery transitions require an exact current signed approval receipt; booleans are ignored.

The first evidence driver accepts only an intact current configured `test` receipt and emits only `test-result`. Unsupported proof stays unavailable.

## Consequences

- Legacy receipts remain useful execution diagnostics but are not authority.
- Agent-authored JSON, self-declared human actors, changed subjects/HEADs, expiry, duplicate decisions and signature mutation fail closed.
- The private key and foreground control channel become high-value capabilities that workers must never receive.
- Same-OS-user isolation is not solved by signatures; doctor blocks on `supervisor-isolation` until a Supervisor-owned sandbox proof exists. On macOS, `prove-isolation` issues a host-scoped Seatbelt attestation (not consumer-revision-bound).
