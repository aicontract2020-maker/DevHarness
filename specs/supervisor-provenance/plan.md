# Plan: Supervisor Provenance

## Components

1. **Contracts** — supervisor identity, evidence manifest, approval request and signed approval
   receipt with domain-separated canonical payloads. Covers AC-SP-2/3/5/6/8.
2. **Immutable Supervisor store** — fixed external project paths, `wx` writes, random temporary
   names, no overwrite, lstat/realpath containment and signature verification. Covers AC-SP-2/8.
3. **Sealed driver registry** — code-owned descriptors; first `command-test@1` implementation can
   derive only test-result evidence from a Supervisor-created valid receipt. Covers AC-SP-1/3/10.
4. **Supervisor session** — owns key and issuance; worker-facing callers can request work but have
   no generic signing or approval method. Covers AC-SP-1/5/6.
5. **Trusted context migration** — load pinned signed manifests/receipts internally and brand them;
   doctor/delivery/understanding stop consuming caller receipt/evidence arrays. Covers AC-SP-4/7.
6. **Foreground approval UX** — pending request brief + exact interactive decision; JSON mode is
   read-only and non-interactive approval fails. Covers AC-SP-5/6/9.

## Security decisions

- Ed25519 signatures; SHA-256 canonical JSON with explicit `devharness.<kind>.v1\0` domain.
- Private signing material never enters consumer worktrees or agent environment.
- A signed command-test manifest is unit/integration evidence only; it cannot satisfy web behavior.
- Old receipts are inputs to Supervisor verification, never authority by themselves.
- Trusted root is selected by the Supervisor process, never goal input or consumer config.

## Risks

- File permissions do not isolate an unrestricted same-user agent. Mitigation: explicit isolation
  capability gate and fail closed until worker sandbox proof exists.
- Circular package dependencies. Mitigation: cryptographic/canonical primitives in core; state and
  issuers in runtime; project layer consumes verified summaries.
- Approval UX can be faked by an injected callback. Mitigation: production entry owns the TTY/UI;
  test callbacks remain in a test-only session factory and cannot load production keys.

