# Sunrise CMS — DevHarness verification recipe (consumer untouched)

> Dogfood note for using DevHarness against [cityssm/sunrise-cms](https://github.com/cityssm/sunrise-cms)
> **without modifying consumer tests**. Last updated: 2026-09-13.

## Problem

Sunrise Cypress read-only funeral-home specs assume at least one funeral home already
exists. Creation lives under `cypress/e2e/02update/`. A folder-scoped Phase 2 run in the
order `xxOther` → `03readOnly` → `02update` → `01admin` therefore fails on
`03readOnly/funeralHomes` with an empty search — even though the product is fine and the
full suite (alphabetical `01admin` → `02update` → `03readOnly`) passes.

This is **test-order / precondition coupling** in the consumer. When the consumer must not
be patched, **DevHarness owns a safe verification recipe** instead of asking agents to
invent a fragile folder order.

## Rules (general)

1. Prefer the consumer’s full configured verify command when it is already green end-to-end
   (`npm run cy:run` for sunrise).
2. If Phase 2 needs folder-scoped or ordered runs, declare the order in the **external**
   DevHarness project config / dogfood recipe — not by editing the consumer.
3. Never treat “one folder red in an unsafe order” as a product bug until the same case
   fails under the harness’s declared safe recipe (or after an explicit seed step the
   harness owns).

## Safe recipes for sunrise

### A. Full suite (default harness verify)

```bash
npm run cy:run
```

Alphabetical e2e order creates funeral homes in `02update` before `03readOnly` runs.
This is what `root-cy-run` in the external sunrise harness should keep using for attested
verification.

### B. Explicit dependency-safe spec order (folder-aware Phase 2)

Run update **before** readOnly. Example (from the sunrise repo root, app already up on
`:9000` with test databases):

```bash
npx cypress run --config-file cypress.config.js --spec \
  'cypress/e2e/xxOther/**/*.cy.js,cypress/e2e/02update/**/*.cy.js,cypress/e2e/03readOnly/**/*.cy.js,cypress/e2e/01admin/**/*.cy.js'
```

External harness command id suggestion: `root-cy-run-ordered` (lives only under
`DevHarness/local-projects/sunrise-cms/` or a tracked example — **not** in the consumer).

### C. What not to do

- Do not “fix” sunrise by changing its Cypress specs when the engagement rule is
  harness-only remediation.
- Do not report a product regression from `03readOnly` alone on a fresh test DB without
  seed or a prior update pass.

## Related methodology

See [existing-project-onboarding-phases.md](../existing-project-onboarding-phases.md)
(harness-owned recipes when the consumer cannot be patched).
