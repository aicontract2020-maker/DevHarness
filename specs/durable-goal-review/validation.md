# Validation: Durable Goal Run Review

Date: 2026-08-31 · Working tree: uncommitted framework prototype

| AC | Priority | Test / evidence | Implementation | Status |
|----|----------|-----------------|----------------|--------|
| AC-1 | MUST | `goal-run.test.mjs:23`; `cli.test.mjs:128` | `goal-run.mjs:21`; `goal-run-store.mjs:82`; `cli.mjs:200` | ✓ PASS |
| AC-2 | MUST | `goal-run.test.mjs:34`; snapshot contradiction test | `goal-run.mjs:74`; `goal-run-store.mjs:121` | ✓ PASS |
| AC-3 | MUST | `goal-run-store.test.mjs:75`; traversal and duplicate tests | `goal-run-store.mjs:82`, `goal-run-store.mjs:121` | ✓ PASS |
| AC-4 | MUST | `cli.test.mjs:128`; live status walkthrough | `cli.mjs:227` | ✓ PASS |
| AC-5 | MUST | `review-server.test.mjs:52`; mutation/traversal/preflight tests | `review-server.mjs:35`, `review-server.mjs:82` | ✓ PASS |
| AC-6 | MUST | UI client tests; live two-run browser selection | `page.tsx:108`, `page.tsx:136`, `page.tsx:195` | ✓ PASS |
| AC-7 | MUST | Initial scorecard CLI test; live browser DOM | `cli.mjs:200`, `page.tsx:166`, `page.tsx:348` | ✓ PASS |
| AC-8 | MUST | CLI integration compares consumer Git status | external path resolution plus `goal-run-store.mjs:82` | ✓ PASS |
| AC-9 | SHOULD | Review API index test and schema bound | `goal-run-store.mjs:144`; `review-run-index.schema.json` | ✓ PASS |

**MUST coverage: 8/8. SHOULD coverage: 1/1.**

## Executed evidence

- Full DevHarness suite: **115/115 PASS**.
- Review UI client tests: **2/2 PASS**.
- Review UI lint: **PASS**.
- Review UI production build: **PASS**.
- Real temporary AIedu_demo Goal Run: created and restored at revision `49a4c5dfd344`.
- Real loopback API: returned the repository-scoped run index with the issued token and origin.
- Real browser: displayed `LIVE RUNTIME`, the exact run ID, `0/100`, seven blockers and no criteria;
  a second run appeared after polling, switched successfully, and opened a blocker detail dialog.
- AIedu_demo Git working tree remained clean before and after the workflow.

## Drift report

No signature, schema, behavior or scope drift found. The implementation deliberately stops at
durable goal intake and review. It does not invoke an agent or advance the run.

## Environment note

The live review fixture remains in `/private/tmp/devharness-live-review.Z5szuK` while the developer
review tab is open. It is external temporary state, not consumer repository content.
