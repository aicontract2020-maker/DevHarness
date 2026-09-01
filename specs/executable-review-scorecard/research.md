# Research: Executable Review Scorecard

Status: Complete
Date: 2026-08-31

## Problem Summary

The review page currently embeds its verdict, dimensions, blockers, and acceptance rows in
the UI source. DevHarness already has lower-level contracts and policies, but no portable
scorecard projection that the UI and CLI can share.

## Relevant Files

| File | Current responsibility | Evidence |
|---|---|---|
| `docs/review-scorecard.md` | Normative scoring rules and evidence levels | `docs/review-scorecard.md:18` |
| `packages/core/src/delivery-readiness.mjs` | Blocks delivery on missing trusted evidence, current-head review, or open blocking findings | `packages/core/src/delivery-readiness.mjs:15` |
| `packages/core/src/trusted-context.mjs` | Creates an in-memory trusted context from Supervisor-verified manifests and approvals | `packages/core/src/trusted-context.mjs:66` |
| `packages/schema/schemas/v1/acceptance-criterion.schema.json` | Defines proof recipes and criterion verdicts | `packages/schema/schemas/v1/acceptance-criterion.schema.json:25` |
| `packages/schema/schemas/v1/evidence-record.schema.json` | Binds evidence to a run, criterion, producer, commit, observation, and artifact | `packages/schema/schemas/v1/evidence-record.schema.json:7` |
| `apps/review-ui/app/page.tsx` | Renders the review interface from module-level hard-coded arrays | `apps/review-ui/app/page.tsx:25` |

## Information Flow Today

1. Supervisor manifests are verified and flattened into a trusted evaluation context —
   `packages/core/src/trusted-context.mjs:66`.
2. Delivery readiness ignores caller evidence and evaluates trusted current-head records —
   `packages/core/src/delivery-readiness.mjs:24`.
3. The review UI does not consume that policy result; it renders independent sample constants —
   `apps/review-ui/app/page.tsx:25`.

## Key Findings

### F-1: Delivery authority already has a trust boundary

Caller evidence is explicitly ignored when computing delivery readiness, which prevents a
scorecard from safely inventing a second authority path — `packages/core/src/delivery-readiness.mjs:24`.

### F-2: Evidence level is not yet machine-readable

Evidence records identify evidence type but do not state E0–E4, while the review standard
requires an explicit minimum and achieved level —
`packages/schema/schemas/v1/evidence-record.schema.json:42`.

### F-3: The UI is not contract-driven

Score dimensions, blockers, and criterion trace values are currently hard-coded separately,
so displayed counts can drift from runtime policy — `apps/review-ui/app/page.tsx:25`.

## Existing Constraints Discovered

- The scorecard must remain a read model; delivery authority stays in core policy —
  `docs/interaction-model.md:115`.
- A high numeric score cannot override a hard-gate failure — `docs/review-scorecard.md:31`.
- Untrusted or stale evidence must never produce a ready verdict — `docs/review-scorecard.md:225`.
- The review interface must support trace, proof, replay, and significant-change drill-down —
  `docs/review-scorecard.md:199`.

## Not Investigated

- Hosted multi-user authentication and access policy.
- Live streaming of run events into the browser.
- Remote replay execution from the UI.

