# Technical Plan: Goal Understanding Checkpoint

## Approach

1. Add a deterministic Alignment Brief compiler over the Goal Run, repository snapshot and existing
   onboarding plan. It reports static facts as facts and gaps as blockers.
2. Extend Goal Run storage with immutable full checkpoints. A fully written checkpoint directory is
   published by replacing one small `current.json` pointer atomically; unreferenced partial work is
   invisible.
3. Add `devharness advance --run ID`. It accepts only an unchanged `received` run, creates the static
   artifacts, records state/artifact/interaction events and publishes one checkpoint.
4. Extend the read-only review index/API with an optional current interaction URL.
5. Render the current Alignment Brief above the delivery scorecard. It clearly states that scope
   approval is unavailable while understanding and acceptance evidence are missing.

## AC coverage

| AC | Components |
|----|------------|
| AC-1, AC-8 | CLI advance and repository identity/revision guards |
| AC-2, AC-3, AC-4 | Alignment compiler, contract and policy tests |
| AC-5, AC-9 | Immutable checkpoint store and recovery tests |
| AC-6 | Review client and page |
| AC-7 | Review server authorization/routing tests |

## Data and contracts

- Existing `goal-run`, `run-event`, `repository-snapshot`, `onboarding-plan`, `review-scorecard` and
  `interaction-packet` schemas remain the portable contracts.
- `review-run-index` gains one optional `interaction_url` per run.
- `current.json` and checkpoint directory layout are runtime-internal and never cross the API.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Partial append corrupts resumability | High | Complete immutable checkpoint, then atomic pointer replacement |
| Static scan is mistaken for understanding proof | High | Action-required verdict, blocking claims, no approve action |
| Packet claims cannot be audited | High | Hash every stored source and require one trace mapping per visible item |
| Concurrent advances race | High | Create-only lock and state recheck; fail closed instead of merging writes |
| New UI hides the delivery scorecard | Medium | Add phase brief above the existing scorecard; do not replace evidence review |

## No migration

Sequence-one runs without `current.json` retain the existing layout and load path. New runs write a
sequence-one pointer; the first advance publishes the new checkpoint format.
