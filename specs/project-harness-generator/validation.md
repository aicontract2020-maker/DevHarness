# Validation: Project Harness Generator and Owned Service Lifecycle

Date: 2026-08-29 · Commit: uncommitted initial framework workspace

| AC | Priority | Test | Implementation | Status |
|----|----------|------|----------------|--------|
| AC-1 | MUST | `packages/runtime/test/verification.test.mjs:90`, `packages/cli/test/cli.test.mjs:36` | `packages/project/src/harness.mjs:52`, `packages/cli/src/cli.mjs:128` | ✓ PASS |
| AC-2 | MUST | `packages/runtime/test/verification.test.mjs:90`, `packages/cli/test/cli.test.mjs:36` | `packages/runtime/src/data-store.mjs:54` | ✓ PASS |
| AC-3 | MUST | `packages/runtime/test/verification.test.mjs:90` | `packages/project/src/harness.mjs:98` | ✓ PASS |
| AC-4 | MUST | `packages/runtime/test/verification.test.mjs:131`, `packages/runtime/test/verification.test.mjs:196` | `packages/runtime/src/verify.mjs:287`, `packages/runtime/src/verify.mjs:356` | ✓ PASS |
| AC-5 | MUST | `packages/runtime/test/verification.test.mjs:131`, `packages/runtime/test/verification.test.mjs:175` | `packages/runtime/src/verify.mjs:327`, `packages/runtime/src/verify.mjs:393` | ✓ PASS |
| AC-6 | MUST | `packages/runtime/test/verification.test.mjs:131` | `packages/project/src/doctor.mjs:17`, `packages/project/src/doctor.mjs:69` | ✓ PASS |
| AC-E1 | MUST | `packages/runtime/test/verification.test.mjs:106` | `packages/project/src/harness.mjs:70`, `packages/project/src/harness.mjs:85` | ✓ PASS |
| AC-E2 | MUST | `packages/runtime/test/verification.test.mjs:175` | `packages/runtime/src/verify.mjs:287`, `packages/runtime/src/verify.mjs:356` | ✓ PASS |
| AC-E3 | MUST | `packages/runtime/test/verification.test.mjs:106` | `packages/project/src/harness.mjs:17` | ✓ PASS |
| AC-7 | WONT | — | — | ○ OUT OF SCOPE |

**MUST coverage: 9/9.** The full suite passes 41/41 and every JavaScript module passes `node --check`.

## Drift report

No signature, schema, behavior, or scope drift was found against `spec.md` and the two feature contracts.

## Environment limitation

The lifecycle integration tests start and terminate real detached service processes, gate the verification command, and test the production HTTP readiness driver with an injected Fetch-compatible response. A live localhost socket acceptance run could not execute because the managed workspace denied loopback `listen()` with `EPERM` and rejected elevated test execution. This is an explicit reviewer check, not silently reported as executed.

## Consumer dogfood

example-consumer remained clean. `doctor` stayed at 67/100 and Level 1. `build` correctly stopped before compilation because no accepted declaration exists, and `init` remained a dry run.
