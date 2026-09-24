# Validation: Executable System Onboarding

Date: 2026-08-30 · Working tree: uncommitted framework prototype

| AC | Priority | Test / evidence | Implementation | Status |
|----|----------|-----------------|----------------|--------|
| AC-1 | MUST | `packages/cli/test/cli.test.mjs` | `packages/cli/src/cli.mjs` | ✓ PASS |
| AC-2 | MUST | project + CLI onboarding tests | `packages/project/src/onboard.mjs`, onboarding schema | ✓ PASS |
| AC-3 | MUST | project onboarding test; example-consumer dry run | compact brief formatter | ✓ PASS |
| AC-4 | MUST | `system-contracts.test.mjs`, governance policy tests | capability-request schema + authority policy | ✓ PASS |
| AC-5 | MUST | `system-contracts.test.mjs` | understanding baseline + system-model schemas | ✓ PASS |
| AC-6 | MUST | `understanding-policy.test.mjs` | understanding policy | ✓ PASS |
| AC-7 | MUST | verification policy tests | verification-policy schema + policy | ✓ PASS |
| AC-8 | MUST | feature and performance negative tests | verification policy | ✓ PASS |
| AC-9 | MUST | scheduling policy tests | execution-plan schema + scheduler policy | ✓ PASS |
| AC-10 | MUST | understanding/governance tests | database/security domains, model and risk contracts | ✓ PASS |
| AC-11 | MUST | `npm test`: 80/80 | schema/core/project/CLI/runtime tests | ✓ PASS |
| AC-12 | MUST | CLI external-write test | path policy + external data store | ✓ PASS |
| AC-13 | SHOULD | CLI external-write test | `onboardingPlanPath`, atomic plan write | ✓ PASS |
| AC-14 | SHOULD | example-consumer dry run | database/security-first blocker ordering | ✓ PASS |
| AC-15 | SHOULD | documentation/link validation | README, architecture, milestone and focused docs | ✓ PASS |
| AC-16 | WONT | scope declaration | no installer/browser/simulator/database execution | ○ OUT OF SCOPE |
| AC-17 | WONT | capability request remains declarative | no action execution from onboarding | ○ OUT OF SCOPE |
| AC-18 | WONT | milestone boundary | no goal workers, PR or merge runtime | ○ OUT OF SCOPE |

**MUST coverage: 12/12.** SHOULD coverage: 3/3. WONT items remain explicit.

## Validation commands

- `npm test` — 80 passed, 0 failed.
- `npm run devharness -- onboard --repo ../example-consumer` — honest `needs-evidence`, database/security first, no writes.
- Markdown relative-link scan — all links resolve.

Independent adversarial review found and the implementation now rejects: generic successful
`verify` commands as behavior proof, all caller-supplied evidence/root inputs, self-declared human
approval, stale strategy hashes, empty/no-op complete system models, unresolved false-positive
risk evidence and contradictory task-progress projections. Final re-review is recorded at the
human review gate rather than being inferred from the passing test suite.

Two independent adversarial re-reviews now report **PASS with no blocking/high false-ready
path**. Developer comprehension/acceptance remains the separate Gate C and has not been inferred
from these engineering checks.

## Remaining implementation boundary

The contracts and plan/policy layer pass. Real dependency bootstrap, browser/simulator,
disposable-database analysis, full system-model generation/challenge, strategy approval UI,
multi-agent worker leases, deployment/load/canary drivers, goal runtime and PR delivery are
not implemented and cannot satisfy executable readiness yet.
