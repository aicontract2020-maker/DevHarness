# Supervisor provenance and human gates

## Why it exists

An Agent can write JSON, claim that a command passed, set `scopeApproved: true`, or label itself as a human. None of those statements proves who performed an action. DevHarness therefore separates worker proposals from Supervisor authority.

The Supervisor owns four things that workers must not own:

- A pinned Ed25519 signing identity.
- A fixed external, create-only artifact store.
- A sealed registry of evidence drivers.
- The foreground human control channel.

## Test evidence flow

```text
configured test
  -> isolated real execution
  -> integrity-checked legacy receipt
  -> sealed command-test driver
  -> signed evidence manifest
  -> trusted context
  -> doctor / understanding policy
```

The signed manifest binds repository identity, current HEAD, clean workspace expectation, exact command and declaration hashes, criterion hash, driver/version/implementation hash, recipe hash, receipt hash, artifact hashes, result, time and issuer. Changing any field invalidates the signature.

`command-test@1` emits only `test-result`. A successful Playwright command is still not browser proof by itself.

`command-system@1` also emits only `test-result` (E2) for `verify` receipts and forbids inventing browser/network observations from stdout.

`command-browser@1` accepts only `verify` receipts that already carry real-surface `screenshot` or `browser-snapshot` plus `network` artifacts captured while owned services were up. It emits those E3 evidence types from the receipt artifacts and fails closed if they are missing — it never invents browser proof from command stdout alone.

## Human approval flow

```text
canonical subject
  -> signed pending request
  -> compact foreground brief
  -> exact request-specific TTY phrase
  -> immutable signed decision receipt
  -> trusted context
  -> scope / delivery state gate
```

Create a request:

```bash
npm run devharness -- request-approval \
  --repo ../some-project \
  --run run-123 \
  --gate scope \
  --subject scope-v3 \
  --subject-sha 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

Then decide it in the foreground terminal:

```bash
npm run devharness -- approve \
  --repo ../some-project \
  --request approval-request-...
```

The receipt format binds the exact request hash, nonce, run, repository, relevant HEAD, gate, subject, decision, actor, decision time and expiry. A changed subject or HEAD, expired request, future timestamp, duplicate/conflicting decision, invalid signature, JSON input, pipe, `--yes` or caller boolean fails closed.

Foreground TTY presence is not yet independent human authentication: an Agent able to allocate or control a PTY could answer the prompt. Until an authenticated control mechanism and worker isolation are implemented, approval receipts must not be treated as production-grade human authority. This is a blocking milestone issue, not an implicit trust assumption.

## Storage and isolation

Supervisor files are outside the consumer repository, namespaced by repository identity and written with create-only semantics. Loaders reject malformed contracts, signature failures, truncation, symlinks and directory escapes.

For local development and test sandboxes, the Supervisor root can be redirected with `DEVHARNESS_SUPERVISOR_DIR` to a writable path. The default remains the fixed user-level anchor so the production-local contract stays unchanged unless a developer explicitly overrides it.

Cryptography does not solve same-user process isolation. If a worker can read the Supervisor key or control its process/environment, it can impersonate the Supervisor. On macOS, `devharness prove-isolation` runs Supervisor-owned Seatbelt probes via `sandbox-exec`, attests a host-scoped isolation proof under the Supervisor root, and lets doctor promote `supervisor-isolation` only when key/state/environment/control denials are verified. Proofs expire and fail closed when missing, stale, or tampered. They are intentionally not revision-bound to a consumer tip: isolation is a runtime Supervisor boundary property.

## Deliberate limitations

- Sealed `command-browser@1` covers revision-bound real-surface screenshot/browser-snapshot + network for verify receipts that captured those artifacts; no sealed API, database, review, deployment, load or canary driver yet.
- No remote Supervisor, hardware-backed key, key rotation or multi-host trust.
- No full goal daemon or automatic merge.
- Delivery remains fail closed until signed real-surface evidence and a signed review report exist.
