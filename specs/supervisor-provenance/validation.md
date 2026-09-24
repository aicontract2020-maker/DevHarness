# Validation: Supervisor Provenance

Date: 2026-09-04  
Commit: uncommitted workspace

This milestone is validated by targeted tests, the read-only doctor path, and an
example-consumer dogfood run that stayed fail-closed when the consumer repository was not
in a clean committed baseline.

## Traceability matrix

| AC | Test evidence | Implementation evidence | Status |
|----|---------------|-------------------------|--------|
| AC-SP-1 | `packages/runtime/test/supervisor-store.test.mjs:130-151`, `packages/runtime/test/review-server.test.mjs:156-228` | `packages/runtime/src/supervisor-store.mjs:218-259`, `packages/runtime/src/review-server.mjs:38-121` | PASS |
| AC-SP-2 | `packages/runtime/test/supervisor-store.test.mjs:76-95` | `packages/runtime/src/supervisor-store.mjs:174-191` | PASS |
| AC-SP-3 | `packages/runtime/test/supervisor-store.test.mjs:106-151` | `packages/runtime/src/supervisor-store.mjs:194-226` | PASS |
| AC-SP-4 | `packages/runtime/test/verification-review.test.mjs:26-80`, `docs/doctor.md:37-48` | `packages/runtime/src/verification-review.mjs:65-100`, `packages/project/src/doctor.mjs:254-263` | PASS |
| AC-SP-5 | `packages/runtime/test/supervisor-store.test.mjs:181-222` | `packages/runtime/src/supervisor-approval.mjs:27-86` | PASS |
| AC-SP-6 | `packages/runtime/test/supervisor-store.test.mjs:181-224`, `packages/runtime/src/supervisor-approval.mjs:115-168` | `packages/runtime/src/supervisor-store.mjs:214-226` | PASS |
| AC-SP-7 | `packages/runtime/test/capability-authorization.test.mjs:173-223` | `packages/runtime/src/capability-authorization.mjs:80-177`, `packages/cli/src/cli.mjs:777-818,903-958` | PASS |
| AC-SP-8 | `packages/runtime/test/supervisor-store.test.mjs:153-179` | `packages/runtime/src/supervisor-store.mjs:229-258` | PASS |
| AC-SP-9 | `packages/cli/src/cli.mjs:777-818,903-958`, `docs/interaction-model.md:55-92` | `packages/cli/src/cli.mjs:777-818,903-958` | PASS |
| AC-SP-10 | `specs/supervisor-provenance/spec.md:40-41` | `docs/supervisor-provenance.md:73-78` | OUT OF SCOPE |
| AC-SP-11 | `specs/supervisor-provenance/spec.md:42-43` | `docs/supervisor-provenance.md:73-78` | OUT OF SCOPE |

## What the tests proved

- Supervisor identity initialization is pinned, idempotent, and protected by the
  filesystem contract. The key material is only created once, and conflict or
  symlink-style rewrites are rejected.
- Signed evidence manifests bind repository identity, revision, command hashes,
  driver/version hashes, criterion hashes, artifact hashes, and the outcome.
- Approval requests and receipts are exact, immutable, revision-bound, and
  expire closed.
- Capability authorization only becomes available from the current clarifying
  plan and only accepts exact current capability subjects.
- Verification review only promotes current-revision evidence when a verified
  manifest exists for the same repository and receipt.

## example-consumer dogfood result

The current read-only doctor run against `../example-consumer` returned `needs_work`
at 75/100. That is expected fail-closed behavior:

- the repository currently has 7 local changes outside the committed baseline;
- build and verification capabilities remain warnings until a clean committed
  baseline is selected;
- `supervisor-isolation` is still a blocking fail, which is the intended signal
  until worker isolation is actually proved.

The clean-baseline rule is enforced in the harness compiler and verification
planner, so a dirty consumer repo cannot be silently upgraded into a trusted
build/verify result. See `packages/project/src/harness.mjs:53-60` and
`packages/runtime/src/verify.mjs:61-66`.

## Drift report

No schema drift, signature drift, or trust-boundary drift was found in the
validated scope. The remaining limitations are deliberate milestone boundaries,
not accidental omissions.

