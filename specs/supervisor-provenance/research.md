# Research: Supervisor Provenance

Date: 2026-08-30 · Ceremony: L

## Current system

- Verification plans bind live repository identity, HEAD, compiled harness and exact command,
  then execute in a detached worktree with owned service teardown
  (`packages/runtime/src/verify.mjs:49`, `packages/runtime/src/verify.mjs:356`).
- Receipts contain hashes and artifact sizes, but the general writer and loader establish only
  structural/integrity checks, not who executed the command
  (`packages/runtime/src/data-store.mjs:51`, `packages/runtime/src/data-store.mjs:89`).
- Doctor accepts receipts from its caller; exact config matching helps replay safety but a caller
  that fabricates matching bytes can still mint build/test readiness
  (`packages/project/src/doctor.mjs:18`, `packages/project/src/doctor.mjs:208`).
- Behavior and understanding currently fail closed because the module-private WeakSet context
  contains no evidence or approvals (`packages/core/src/trusted-context.mjs:3`,
  `packages/core/src/trusted-context.mjs:63`).
- Evidence records self-declare producer and type; no executed driver identity, implementation
  hash, recipe hash or issuer attestation exists
  (`packages/schema/schemas/v1/evidence-record.schema.json:7`).
- Approval receipts bind repo/HEAD/gate/subject hash, but human/source are still declarative and
  there is no request, nonce, issuer key or signature
  (`packages/schema/schemas/v1/approval-receipt.schema.json:7`).
- Scope and delivery transitions still trust caller booleans
  (`packages/core/src/state-machine.mjs:78`).
- CLI has no supervisor/human gate, and its caller-selectable data directory cannot become a
  trusted approval root (`packages/cli/src/cli.mjs:16`, `packages/cli/src/cli.mjs:61`).

## Threat boundary

Consumer code, worker agents, caller JSON, environment claims and caller-selected paths are
untrusted. A foreground Supervisor owns the signing identity, fixed external state, driver
registry and human-control channel. Workers receive neither its private key nor a generic writer.

If workers share unrestricted OS identity, filesystem and process access with Supervisor, Node
modules and signatures cannot prove human presence. v0 therefore requires a worker sandbox that
does not expose Supervisor state/control; absence of that isolation is a blocker, never a pass.

## Decision

Introduce signed, domain-separated supervisor artifacts and immutable content-addressed storage.
The first evidence driver may attest only a verified `test` command as `test-result`; it must not
claim browser, network or database behavior. Human approval begins from a signed pending request
and is decided through a foreground control callback; no `--yes`, piped stdin or worker API.

Doctor, delivery and understanding must consume only artifacts verified against the pinned
Supervisor public identity. Old command receipts remain integrity-only inputs.

## Not investigated

- OS keychain/FIDO/WebAuthn implementations.
- Browser, simulator and disposable-database driver output formats.
- Remote Supervisor transport and multi-host key rotation.

