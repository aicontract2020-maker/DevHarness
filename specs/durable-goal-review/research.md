# Research: Durable Goal Run Review

Date: 2026-08-31

## Findings

- Goal Run and append-only event contracts already exist, but no runtime module currently creates,
  stores, restores or lists them. `packages/schema/schemas/v1/goal-run.schema.json:1`,
  `packages/schema/schemas/v1/run-event.schema.json:1`, `packages/runtime/src/data-store.mjs:1`
- The state machine already defines the complete governed lifecycle and blocks skipped phases.
  `packages/core/src/state-machine.mjs:3`, `packages/core/src/state-machine.mjs:25`
- Event validation already rejects sequence gaps, mixed runs, duplicate IDs and time reversal.
  `packages/core/src/event-stream.mjs:1`
- Existing runtime storage is repository-identity keyed, external by default, atomically written and
  permission restricted. `packages/runtime/src/data-store.mjs:9`,
  `packages/runtime/src/data-store.mjs:22`, `packages/runtime/src/data-store.mjs:58`
- Existing receipt listing ignores malformed or tampered artifacts instead of trusting them.
  `packages/runtime/src/data-store.mjs:112`
- Review scorecards are deterministic read models over run facts and trusted evidence; hard gates
  dominate their numeric score. `packages/core/src/review-scorecard.mjs:83`,
  `packages/core/src/review-scorecard.mjs:262`
- The current review page imports one bundled contract fixture and has no runtime transport or run
  selector behavior. `apps/review-ui/app/page.tsx:24`, `apps/review-ui/app/page.tsx:78`
- The CLI documents `goal` as planned but currently accepts only onboarding, harness, approval and
  verification commands. `README.md:33`, `packages/cli/src/cli.mjs:20`,
  `packages/cli/src/cli.mjs:127`
- Architecture requires runs to resume from events and artifacts and keeps physical runtime storage
  outside the consumer repository. `docs/architecture.md:80`, `docs/architecture.md:99`

## Existing constraints discovered

- A Goal Run must bind to a repository identity and exact committed revision.
- The review page is a read model and cannot become an approval authority.
- Local review transport must not expose private run data to arbitrary websites.
- Runtime writes must remain outside the consumer repository and use restrictive permissions.
- This slice cannot claim autonomous execution; agent adapters and workers do not yet exist.

## Not investigated

- Packaging the review UI as a standalone desktop binary.
- Remote or multi-user review transport.
- Agent adapter invocation and task execution.

## Open questions for the spec

- None. The approved next milestone is local, single-user, external-storage Goal Run creation and
  read-only review. Hosted collaboration remains explicitly deferred.
