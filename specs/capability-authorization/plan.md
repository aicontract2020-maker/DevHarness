# Technical Plan: Capability Authorization Checkpoint

## Approach

1. Add a safe current-checkpoint artifact loader that validates the interaction source reference,
   stored artifact contract and canonical hash before returning a value.
2. Add a capability authorization service that derives one canonical approval subject from the
   onboarding plan and computes current status from verified Supervisor requests and receipts.
3. Add `request-capability --run ID --capability ID`; remove the capability gate from the generic
   caller-defined approval path.
4. Supply the intact canonical capability context to the foreground prompt and reject any mismatch.
5. Expose the computed authorization view through the authenticated read-only review API and CLI
   status.
6. Render a compact authorization panel in the existing Alignment Brief.

## AC coverage

| AC | Components |
|----|------------|
| AC-1, AC-7 | Goal artifact loader, capability service, CLI request command |
| AC-2, AC-8 | Supervisor foreground presentation and compatibility tests |
| AC-3, AC-4 | Supervisor request/receipt evaluation and deterministic status model |
| AC-5 | Review client and page capability panel |
| AC-6 | Review responder authorization and tamper tests |

## Data and contracts

- Existing `capabilityRequest`, `approval-request` and `approval-receipt` contracts remain source of
  truth.
- Add `capability-authorization-view`, a read model containing the canonical capability request,
  computed status and optional verified request/receipt references.
- `review-run-index` gains an optional `capabilities_url` for runs whose current checkpoint contains
  an onboarding plan.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Approval subject is swapped | High | Derive and hash from current intact onboarding artifact only |
| Human approves opaque data | High | Show every bounded field before exact phrase is accepted |
| Expired request appears approved | High | Evaluate at explicit current time; distinguish expired/stale |
| UI accidentally becomes authority | High | Keep API GET-only; page only displays CLI instructions |
| Generic approval compatibility breaks | Medium | Preserve contract and prompt behavior for non-capability gates |

## No migration

Existing requests and receipts remain readable. Old capability requests not derivable from a current
Goal Run are classified stale and cannot authorize execution.

