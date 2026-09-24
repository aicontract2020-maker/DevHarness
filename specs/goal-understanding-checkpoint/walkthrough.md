# Walkthrough: Goal Understanding Checkpoint

## 1. The developer advances a received goal

`devharness advance --run ID` loads the event-backed run and rejects a dirty tree, changed revision,
wrong repository or any state other than `received`. `packages/cli/src/cli.mjs`

## 2. Existing discovery produces static facts

The command reuses repository discovery, readiness and onboarding instead of adding another scanner.
No dependency, project command, service, browser, simulator or database is executed.

## 3. One compiler creates the developer surface

`createGoalUnderstandingCheckpoint()` validates the run, snapshot and onboarding contracts, binds
three source artifacts by canonical hash, selects confirmed facts and at most five priority gaps,
and creates four compact sections. `packages/project/src/alignment.mjs:20`

## 4. Static evidence cannot become scope approval

The packet is always `action-required` at this checkpoint. It names missing acceptance criteria,
contains no approve action and recommends inspecting required proof. A future `ready` Alignment
Brief must explicitly request gate approval. `packages/project/src/alignment.mjs:97`,
`packages/core/src/interaction-policy.mjs`

## 5. State changes are recorded, not inferred from chat

Six new events record discovery entry, both generated artifacts, the move to `clarifying`, packet
publication and developer attention. Replaying seven total events reconstructs the same snapshot.
`packages/project/src/alignment.mjs:126`

## 6. One pointer publishes the complete checkpoint

`appendGoalRunCheckpoint()` validates the complete next event stream, scorecard, packet and artifact
hashes, writes them into an immutable private directory, then atomically replaces `current.json`.
An orphan directory cannot affect reads. `packages/runtime/src/goal-run-store.mjs:202`

## 7. The local API exposes only the current packet

The existing origin and token checks protect `GET /api/review/runs/:id/interaction`; invalid or
missing packets return not found and no mutation endpoint exists. `packages/runtime/src/review-server.mjs:75`

## 8. The page shows the decision, not the artifact directory

The page fetches the packet with the selected run and presents outcome, confirmed facts, missing
proof and the scope checkpoint. Detailed delivery evidence stays locked during alignment so the
developer sees one current decision surface. `apps/review-ui/app/page.tsx:130`,
`apps/review-ui/app/page.tsx:255`

## Not handled here

- Executing the requested capabilities and observing the real application.
- Web research, product clarification, acceptance criteria and Gate 1 approval.
- Agent planning, implementation, verification, repair or delivery.

## Unrequested behavior

None. The real example-consumer dogfood run remained clean and the page remained read-only.
