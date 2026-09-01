# Research: Goal Understanding Checkpoint

Status: Complete
Date: 2026-08-31

## Relevant files

| File | Existing responsibility |
|------|-------------------------|
| `packages/cli/src/cli.mjs:198` | Creates a durable Goal Run, but deliberately stops in `received`. |
| `packages/core/src/goal-run.mjs:74` | Replays validated events into the current run snapshot. |
| `packages/runtime/src/goal-run-store.mjs:82` | Atomically creates the first external run directory and restores it from events. |
| `packages/project/src/discover.mjs:296` | Performs read-only repository discovery and returns a versioned snapshot. |
| `packages/project/src/onboard.mjs:29` | Converts discovery and readiness facts into claims, gaps and capability requests. |
| `packages/core/src/interaction-policy.mjs:14` | Validates bounded, traceable developer interaction packets. |
| `packages/runtime/src/review-server.mjs:35` | Exposes authenticated, read-only local review data. |
| `apps/review-ui/app/page.tsx:78` | Loads live run summaries and scorecards, but not interaction packets. |

## Information flow today

1. `goal` discovers a clean repository and creates `run.created`. `packages/cli/src/cli.mjs:198`
2. The store writes one event, one cached snapshot and one scorecard externally. `packages/runtime/src/goal-run-store.mjs:82`
3. `status` replays the event stream and returns one next action. `packages/cli/src/cli.mjs:225`
4. The review service lists scorecards for valid stored runs. `packages/runtime/src/review-server.mjs:57`
5. No command advances `received`, publishes an Alignment Brief or exposes a current interaction packet.

## Key findings

### F-1: Existing onboarding is the correct static scanner

It already distinguishes detected configuration from real proof and produces explicit database,
security, runtime, test and deployment gaps. `packages/project/src/onboard.mjs:29`

### F-2: A static scan cannot honestly approve scope

Onboarding explicitly says it did not run commands, browsers, simulators or databases and normally
returns `needs-evidence`. `packages/project/src/onboard.mjs:104`

### F-3: Interaction packets already enforce compact traceability

Every surfaced item must map to a hashed source artifact; decisions are capped at three and exactly
one next action is recommended. `packages/core/src/interaction-policy.mjs:14`

### F-4: Durable append needs one atomic publication point

Creation is atomic, but the current layout has no append transaction. Writing an event and replacing
the snapshot separately would leave a crash window where they contradict. `packages/runtime/src/goal-run-store.mjs:82`

### F-5: The page has no current-phase review surface

The live page fetches only the run index and delivery scorecard, so a developer cannot inspect a
published Alignment Brief. `apps/review-ui/app/page.tsx:106`

## Existing constraints discovered

- Events remain authoritative; a cached snapshot may never silently override them.
- Runtime state and generated artifacts stay outside the consumer repository.
- Static detection is not runtime evidence.
- Private model reasoning is not an artifact; only claims, decisions, sources and evidence are shown.
- The local review transport stays read-only and uses the existing exact-origin/token boundary.

## Not investigated

- Agent adapter invocation and web research.
- Dependency installation, service launch, browser/simulator use and database execution.
- Requirements generation, product clarification answers and actual scope approval.
- Remote collaboration or hosted persistence.

## Open questions for the spec

None. This milestone is an intentionally fail-closed bridge from goal intake to visible project
understanding; executable evidence collection is the next milestone.
