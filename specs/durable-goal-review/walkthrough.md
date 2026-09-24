# Walkthrough: Durable Goal Run Review

## 1. Goal intake binds intent to a real repository revision

`devharness goal` enters at `packages/cli/src/cli.mjs:200`. It requires a clean committed baseline,
creates a unique run and makes no consumer command or agent call.

## 2. Core creates deterministic initial facts

`createInitialGoalRun()` at `packages/core/src/goal-run.mjs:21` creates a `received` snapshot, pending
human gates, bounded budgets and sequence-one `run.created` event. ID and time are injectable for
deterministic tests.

## 3. The initial scorecard fails closed

The CLI projects zero proof and explicit blockers for missing understanding, acceptance, harness,
trusted evidence, scope approval and review. The run is real runtime data but is not executable or
ready.

## 4. A complete run is published atomically outside the consumer

`createStoredGoalRun()` at `packages/runtime/src/goal-run-store.mjs:82` validates all three contracts,
writes private files into a unique staging directory and renames the complete directory into place.
Duplicate IDs cannot replace existing state.

## 5. Status restores from events

`replayGoalRun()` at `packages/core/src/goal-run.mjs:74` validates sequence and reconstructs state.
`loadGoalRun()` at `packages/runtime/src/goal-run-store.mjs:121` rejects a cached snapshot that does
not exactly match replay. `devharness status` then shows one bounded next action.

## 6. Review data crosses a narrow local boundary

`createReviewApiResponder()` at `packages/runtime/src/review-server.mjs:35` permits GET only after an
exact Origin check and constant-time 256-bit token comparison. The network server binds to
127.0.0.1 at `packages/runtime/src/review-server.mjs:82`.

## 7. The page discovers the connection without leaking it to a server

`parseReviewConnection()` at `apps/review-ui/lib/review-client.mjs:3` reads the API origin and token
from the URL fragment and accepts loopback HTTP only. Without it, the page retains the sample badge.

## 8. Runs refresh and remain selectable

The page fetches the bounded index at `apps/review-ui/app/page.tsx:108`, polls every five seconds at
`apps/review-ui/app/page.tsx:136`, and renders the run selector at `apps/review-ui/app/page.tsx:195`.
Runtime, connecting, offline and sample states are visually distinct.

## Not handled here

- Clarification, web research, requirements, acceptance generation and scope approval.
- Agent execution, task transitions, verification, repair and delivery.
- Packaged one-command UI startup and hosted collaboration.

## Unrequested behavior

None. The slice writes no framework files or runtime state into example-consumer, starts no consumer
process, calls no agent, performs no approval, and changes no delivery state.
