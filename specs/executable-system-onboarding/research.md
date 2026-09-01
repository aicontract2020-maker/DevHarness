# Research: Executable System Onboarding

Date: 2026-08-29

## Scope

This slice turns the existing repository scanner into an honest onboarding front door and
defines the contracts required before DevHarness may claim it understands a system or can
schedule autonomous work safely. It does not install tools, start applications, inspect a
live database, or run browser/simulator automation.

## Confirmed findings

1. The CLI currently exposes four independent commands and has no onboarding command or
   combined readiness brief (`packages/cli/src/cli.mjs:15-28`, `80-153`).
2. Discovery is read-only and already identifies Git state, manifests, languages,
   frameworks, test tools, common services, commands, environment-key names, CI and agent
   files (`packages/project/src/discover.mjs:326-477`).
3. Discovery records that PostgreSQL or Playwright is present but does not prove either was
   successfully exercised (`packages/project/src/discover.mjs:347-362`).
4. Doctor correctly distinguishes a detected command from a current isolated receipt and
   does not award behavior readiness merely for tool presence
   (`packages/project/src/doctor.mjs:255-292`).
5. External identity-keyed storage and atomic private writes already exist for compiled
   harnesses and verification receipts (`packages/runtime/src/data-store.mjs:9-68`).
6. The current project harness explicitly lacks screenshots, browser traces, network
   evidence, database state, dependency bootstrap, and container ownership
   (`docs/project-harness.md:43-45`; `docs/verification-receipts.md:67-73`).
7. Task contracts express dependencies and filesystem scope, but not resource locks,
   expected duration, integration ownership, or proof-stage requirements
   (`packages/schema/schemas/v1/task-contract.schema.json`).

## Design conclusions

- `onboard` must default to read-only planning. Any install, process execution, network
  access, credential use, database mutation, simulator, or browser action is a separately
  authorized capability.
- Claims need explicit epistemic status. Detection is not runtime observation, a document
  is not code confirmation, and a passing API request is not a complete feature proof.
- A baseline is revision-bound and invalid after relevant files, declarations, migrations,
  security boundaries, or strategy decisions change.
- Database, security, frontend, backend, deployment, and automation are mandatory coverage
  domains when applicable; uncovered domains remain visible instead of being averaged away.
- Human review uses one compact brief with blockers, conflicts, requested authorities, and
  the recommended next action. Detailed inventories remain drill-down artifacts.
- Parallelism is derived from a dependency DAG plus file/data/service/port locks. Integration
  and release verification remain serialized ownership points.

## Deferred implementation

- Installing dependencies and platform drivers.
- Launching a real consumer application from `onboard`.
- Browser, simulator, database and deployment evidence collectors.
- Goal-runtime orchestration and agent invocation.
- PR, deployment, load-test and canary executors.

These mechanisms must consume the contracts introduced by this slice and may not weaken
their evidence or authority semantics.
