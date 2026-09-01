# Validation: External Local Project Configuration

Status: Passed
Validated: 2026-08-31

## Acceptance results

- AC-1 PASS: AIedu_demo remains Git-clean and contains no generated DevHarness configuration.
- AC-2 PASS: `onboard`, `doctor`, `build`, `verify`, `review` and `advance` accept one explicit
  external configuration path; the path is resolved and schema-validated before use.
- AC-3 PASS: the default tracked `devharness.yaml` behavior remains covered by regression tests.
- AC-4 PASS: the AIedu declaration and run state exist only under DevHarness's ignored
  `local-projects/aiedu-demo/` directory.

## Quantitative evidence

- Consumer Git changes: 0.
- Consumer-local DevHarness configuration files: 0.
- External configuration hash:
  `192aee1493ad6f5e36c7bc25051100716d2ddd2a8dd0bc59daa6a701d26edaad`.
- Compiled declaration blockers: 0.
- Configured service lifecycles: 1.
- Readiness checks: 2 (frontend and backend).
- Browser system-test bindings: 1.
- Targeted CLI/project tests: 24/24 passed.
- Targeted CLI/execution-authority tests: 16/16 passed.
- Full DevHarness regression: 141/141 passed.

## Safety boundary

An explicit `--config` path inside the consumer repository is rejected. Configuration, Goal Run
state and future evidence remain local and ignored. Runtime commands are not executed without
separate signed approval for service, browser, container and database capabilities.
