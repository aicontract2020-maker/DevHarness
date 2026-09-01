# Spec: Supervisor Provenance

Status: Approved for implementation by continuation instruction · Version: 1 · Mode: Full

## Outcome

DevHarness can distinguish Supervisor-issued execution/approval from agent-authored JSON, while
remaining fail closed for proof mechanisms that do not yet have registered real drivers.

## Boundaries

- Always bind trusted artifacts to repository identity, relevant revision, canonical subject,
  issuer identity and immutable storage.
- Ask the developer only through the foreground Supervisor control channel.
- Never expose a generic signer/writer, trust caller-selected roots, or promote a command exit code
  into browser/database/system evidence.

## Acceptance criteria

- **AC-SP-1 [MUST]** Given arbitrary schema-valid JSON/files, when a caller passes them to public
  readiness APIs, then no trusted evidence or approval is created.
- **AC-SP-2 [MUST]** Given a new Supervisor state, when initialized, then one pinned Ed25519 public
  identity and protected private key are created externally; conflicting re-initialization fails.
- **AC-SP-3 [MUST]** Given a verified current `test` receipt, when the sealed command-test driver
  attests it, then a signed manifest binds repo, HEAD, command/harness hashes, driver/version,
  criterion hashes and artifact hashes; any mutation/replay fails verification.
- **AC-SP-4 [MUST]** Given build/test/behavior readiness, when doctor evaluates it, then only a
  verified Supervisor manifest may promote it; legacy or fabricated receipts remain non-passing.
- **AC-SP-5 [MUST]** Given a canonical pending approval request, when an authenticated foreground
  human decision is recorded, then a signed immutable receipt binds request hash, nonce, run,
  repo, relevant HEAD, gate, subject and expiry.
- **AC-SP-6 [MUST]** Given self-declared human fields, non-interactive input, a changed subject/HEAD,
  expiry, duplicate/conflicting decisions or invalid signature, then approval remains invalid.
- **AC-SP-7 [MUST]** Given scope/delivery state transitions, caller booleans alone cannot cross a
  gate; a current verified approval receipt is required.
- **AC-SP-8 [MUST]** Given restart, tampering, symlink/path escape, truncated files or duplicate IDs,
  trusted loading deterministically rejects unsafe artifacts and never overwrites immutable state.
- **AC-SP-9 [SHOULD]** CLI/status output shows issuer fingerprint, artifact/receipt ID and concise
  reason when provenance is unavailable, without exposing keys or secrets.
- **AC-SP-10 [WONT]** This milestone does not claim browser, network, simulator, database,
  deployment or production evidence.
- **AC-SP-11 [WONT]** This milestone does not implement the full goal daemon, remote control plane,
  automatic merge or same-OS-user isolation.

## Assumptions surfaced

- Supervisor and workers are separate security principals/capability sandboxes in the intended
  runtime. Without that, readiness reports `supervisor-isolation-unproved`.
- The first driver establishes provenance plumbing, not real-surface behavior readiness.
- Human Gate C remains required before this milestone is considered adopted.

