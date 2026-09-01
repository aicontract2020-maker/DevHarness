# Approved Test Runtime

Status: Implemented; external local project declaration approved by developer
Version: 1.0
Mode: Full
Last updated: 2026-08-31

Developer decision: Approved on 2026-08-31. The accepted subject is the exact external local
declaration at `DevHarness/local-projects/aiedu-demo/devharness.yaml`, reported at 100/100
structural coverage with proposal SHA-256 bound by the developer review service. It is deliberately
outside the AIedu_demo repository and ignored by DevHarness Git.

## Decision

The developer approved Docker as AIedu_demo's standard autonomous test runtime: complete local
stack, frontend and backend readiness, isolated data, bounded teardown, browser verification and no
production credentials.

## Acceptance criteria

### AC-1: Multiple readiness checks [MUST]
Given a declared full-stack service, when it starts, then every declared loopback HTTP check must
pass before verification begins and every result is recorded.

### AC-2: Explicit cleanup [MUST]
Given a declared cleanup command, when verification ends or setup fails, then DevHarness runs it in
the isolated worktree and teardown fails if cleanup fails or times out.

### AC-3: Code-revision-bound external declaration [MUST]
Given the approved strategy, when the external declaration is compiled against a clean AIedu_demo
checkout, then it contains the exact two-file Compose launch/cleanup recipe, frontend and backend
readiness, and Playwright binding, while evidence remains bound to the consumer code revision and
the external configuration hash.

### AC-4: No execution during configuration [MUST]
Given this implementation, when it is validated, then AIedu containers, services and tests are not
started; execution still requires remaining signed capabilities and safe test credentials.

## Out of scope

- Granting container, service, database or credential capabilities.
- Running AIedu_demo before the required local capabilities are approved.
- Using or copying production credentials.
