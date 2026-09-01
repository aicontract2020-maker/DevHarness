# Research: Authorized Execution Gate

Status: Complete
Last updated: 2026-08-31

- `verify --execute` currently runs any accepted configured command without a Goal Run or capability
  receipt. `packages/cli/src/cli.mjs:380`
- Verification plans bind the repository revision, accepted configuration and exact command hash,
  and refuse launch commands without lifecycle ownership. `packages/runtime/src/verify.mjs:35`
- Capability authorization now computes signed current-run decisions, but no execution path consumes
  that result. `packages/runtime/src/capability-authorization.mjs:61`
- AIedu_demo has no accepted `devharness.yaml`; dry-run initialization proposes commands but build
  correctly refuses to compile a harness. `packages/project/src/config.mjs:17`
- [CONFLICT] The constitution requires explicit authority for execution, while the public execute
  flag alone currently grants it.
- [GAP] No deterministic policy maps a verification plan to required capabilities.

Not investigated: dependency installation, browser evidence collection and database drivers.

