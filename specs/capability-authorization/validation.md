# Validation: Capability Authorization Checkpoint

Date: 2026-08-31 · Working tree: uncommitted framework prototype

| AC | Priority | Test / evidence | Implementation | Status |
|----|----------|-----------------|----------------|--------|
| AC-1 | MUST | Canonical source loader, unknown capability and CLI derivation tests | `packages/runtime/src/capability-authorization.mjs` | ✓ PASS |
| AC-2 | MUST | Foreground presentation test; real AIedu pending request | `packages/runtime/src/supervisor-approval.mjs` | ✓ PASS |
| AC-3 | MUST | Signed request/receipt transition and expiry tests | `packages/runtime/src/capability-authorization.mjs` | ✓ PASS |
| AC-4 | MUST | Unrequested, pending and approved deterministic status tests | `packages/runtime/src/capability-authorization.mjs` | ✓ PASS |
| AC-5 | MUST | Review client tests and real in-app browser walkthrough | `apps/review-ui/app/page.tsx` | ✓ PASS |
| AC-6 | MUST | Exact-origin/token/method/path capability endpoint tests | `packages/runtime/src/review-server.mjs` | ✓ PASS |
| AC-7 | MUST | CLI test plus AIedu_demo clean status before/after | external storage boundary | ✓ PASS |
| AC-8 | SHOULD | Existing scope approval suite and full regression | unchanged generic approval contracts | ✓ PASS |

**MUST coverage: 7/7. SHOULD coverage: 1/1.**

## Executed evidence

- Full DevHarness suite: **128/128 PASS**.
- Review UI client tests: **4/4 PASS**.
- Review UI lint: **PASS**.
- Review UI production build: **PASS**.
- Real AIedu_demo Goal Run exposed seven bounded capability requests at revision `49a4c5dfd344`.
- A signed browser request was derived as `approval-request-c953a4a28a48c0b7fc70510a395e585e`;
  the caller supplied no subject hash.
- Live review showed 1 pending and 6 unrequested capabilities, complete bounded details, the exact
  foreground approval command and an explicit statement that the page cannot approve.
- Browser console contained no warnings or errors.
- AIedu_demo Git working tree remained clean.

## Drift report

No signature, schema, behavior or scope drift found. Approved capability execution remains outside
this milestone and is not implied by the pending browser request.

