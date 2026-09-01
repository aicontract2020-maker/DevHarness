# Walkthrough: Executable Review Scorecard

## 1. One portable contract defines what the developer reviews

`packages/schema/schemas/v1/review-scorecard.schema.json` requires run identity, verdict,
proof dimensions, hard gates, counts, exceptions, acceptance rows, drill-down references and
integrity metadata. Evidence records can carry an evidence level, and criteria can require one.

## 2. Core facts are projected deterministically

`createReviewScorecard()` in `packages/core/src/review-scorecard.mjs:83` consumes goal-run facts,
sorts unordered inputs and computes the five review dimensions. The page does not calculate trust.

## 3. Evidence fails closed

Only the trusted evaluation context is considered. Evidence must belong to the current run and
revision. Caller-authored, stale or cross-run evidence leaves the criterion blocked at E0.

## 4. Hard gates outrank the score

`packages/core/src/review-scorecard.mjs:262` derives the final verdict from failed or unknown hard
gates. Proof coverage helps comprehension; it is never permission to deliver.

## 5. The review page consumes the same shape

`apps/review-ui/app/page.tsx:24` imports `apps/review-ui/data/review-scorecard.json`. Verdict,
dimensions, blockers, criteria, trace, evidence, replay and significant changes all come from that
single document. Selecting a criterion changes the drill-down panel.

## 6. The current page is visibly a sample

Until a real run store exists, the fixture declares `data_source: contract-fixture` and the page
shows `SAMPLE DATA`. It cannot be mistaken for a live, approvable delivery.

## Next milestone

Persist real goal-run artifacts outside the consumer repository, generate this scorecard at each
review checkpoint, and let the page select a run and refresh its trusted result.

## Unrequested behavior

None. This milestone does not start agents, execute consumer projects, approve delivery, merge,
deploy, or write into AIedu_demo.
