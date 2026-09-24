# Walkthrough: Supervisor Provenance

This walkthrough follows the order a reviewer should care about, not the order
the files happen to live in.

## 1. Supervisor state is created once and stays pinned

`initializeSupervisorIdentity()` — `packages/runtime/src/supervisor-store.mjs:174-191`

The Supervisor keypair is created externally, the public identity is pinned, and
the file writes are create-only. The tests cover idempotent reload, protected key
permissions, and conflict rejection. See `packages/runtime/test/supervisor-store.test.mjs:76-95`.

## 2. Evidence is only promoted through a sealed driver

`attestEvidenceManifest()` and `writeEvidenceManifest()` — `packages/runtime/src/supervisor-store.mjs:194-226`

The signed evidence manifest binds the repository, revision, command, harness,
driver, recipe, receipt, artifact hashes, and outcome. Mutation or replay fails
verification. See `packages/runtime/test/supervisor-store.test.mjs:106-151`.

## 3. Approval requests and receipts are exact, immutable, and expired closed

`createSupervisorApprovalRequest()` — `packages/runtime/src/supervisor-approval.mjs:27-60`  
`recordInteractiveApprovalDecision()` — `packages/runtime/src/supervisor-approval.mjs:115-168`

The foreground gate shows the exact bounded capability or subject, refuses piped
or JSON decisions, and records one immutable signed receipt. The tests cover
the pending request, the immutable receipt, expiry, and duplicate/conflicting
decision rejection. See `packages/runtime/test/supervisor-store.test.mjs:181-224`.

## 4. Capability authorization is derived from the current plan, not caller input

`loadCapabilityAuthorizationView()` and `requestCapabilityAuthorization()` —
`packages/runtime/src/capability-authorization.mjs:80-164`

The current clarifying plan is loaded from the run state, capability items are
matched to exact current subjects, and the result is projected as a bounded
authorization view. The CLI status command shows the resulting counts and next
action rather than a raw dump. See `packages/cli/src/cli.mjs:777-818`.

## 5. Verification review only counts verified evidence from the same repository

`createVerificationReview()` — `packages/runtime/src/verification-review.mjs:65-100`

The review is deterministic, bounded, and refuses cross-repository receipts.
Current-revision evidence is only promoted when a verified evidence manifest
exists for the same receipt. See `packages/runtime/test/verification-review.test.mjs:26-80`.

## 6. Doctor stays read-only, and build/verify stay fail-closed on a dirty baseline

`devharness doctor` — `docs/doctor.md:1-48`  
`compileProjectHarness()` — `packages/project/src/harness.mjs:53-60`  
`createVerificationPlan()` — `packages/runtime/src/verify.mjs:54-66`

The example-consumer dogfood run on 2026-09-04 reported `needs_work` because the
consumer repo currently has local changes outside the committed baseline. That
is the correct behavior: DevHarness should explain the blocker, not normalize it
away.

## 7. What this milestone intentionally does not do

- It does not claim browser, database, simulator, deployment, or production proof.
- It does not implement a full goal daemon or automatic merge.
- It does not grant human authority to caller booleans or JSON payloads.

Those boundaries are deliberate, and they keep the milestone honest while the
framework grows.

