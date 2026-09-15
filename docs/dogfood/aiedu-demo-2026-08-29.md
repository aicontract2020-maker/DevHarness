# AIedu_demo dogfood: discovery and doctor

- Date: 2026-08-29
- Consumer: external sibling repository `AIedu_demo`
- Repository identity: `github.com/Maple-Spark-Ai/AI-education-demo`
- Revision: `49a4c5dfd34442705c8a2e7eb5de1d1a325811f6`
- Mutation policy: read-only; no consumer files were created or changed

## Commands exercised

```bash
npm run devharness -- onboard --repo ../AIedu_demo
npm run devharness -- doctor --repo ../AIedu_demo
npm run devharness -- init --repo ../AIedu_demo
npm run devharness -- build --repo ../AIedu_demo
npm run devharness -- verify --repo ../AIedu_demo --command frontend-build
```

`onboard` returned the expected `needs-evidence` verdict without executing consumer commands or
writing state. `init` ran without `--write`, so it printed the proposal and left the consumer unchanged.
`build` stopped because no accepted `devharness.yaml` exists, so no external manifest was created.
`verify` stopped before planning because no accepted declaration exists. No project command ran.

## Discovery result

- 2,044 tracked or non-ignored files inspected.
- Platforms: API and web.
- Frameworks: FastAPI, Next.js, React.
- Test tools: Playwright and pytest.
- PostgreSQL, Redis, local/production container files and deployment/rollback scripts detected.
- Dependency lockfiles and redacted environment examples detected.
- GitHub remote and worktree capability detected.
- `database/course` submodule is initialized at pinned revision `38a0d703fa3173b8f83bf3fbaa5f5799238f4bae`.
- No CI workflow detected.
- No `devharness.yaml` declaration exists.

The actual repository snapshot and readiness report both validated against their public v1 schemas.

## Doctor verdict

```text
Readiness: needs_work (76/100)
Autonomy level: 1/5
```

Passing static capabilities:

- Git repository and committed revision.
- Clean baseline.
- Supported v0 platform.
- Dependency locks.
- Secret-safe environment contract.
- Worktree isolation.
- GitHub pull-request delivery detection.

Detected but deliberately unverified:

- Build commands.
- Automated test commands.
- Playwright behavior driver.
- Service launch and teardown.

These remain `warn`, not `pass`, because discovery did not execute them. This corrected an earlier prototype result that incorrectly treated tool presence as proof and scored the repository too highly.

## Biggest blockers

1. Review and explicitly write the generated `devharness.yaml` proposal.
2. Generate a project-specific behavior recipe and execute it against an isolated current revision.
3. Execute the detected unit/integration commands and bind their receipts to the current revision.

CI remains a non-blocking readiness warning for static onboarding, but it will be required for the pull-request feedback milestone.

## Safety finding from dogfood

The first implementation proposed a production Docker Compose file as an executable launch command. Dogfood rejected that behavior. Discovery may inspect production compose files to identify services, but it now generates commands only from non-production compose files. A regression test locks this boundary.

## Subsequent framework proof

DevHarness now supports deterministic external project-harness compilation and a single runtime-owned local service lifecycle. AIedu_demo has not accepted a declaration, so `build` remains correctly blocked before compilation. The next consumer action requires developer review because it would add `devharness.yaml` and choose real readiness endpoints; framework dogfood remains read-only until then.

## External-local follow-up — 2026-09-01

The approved external-local path is now live and remains consumer-read-only:

- `devharness doctor --repo ../AIedu_demo --config ./local-projects/aiedu-demo/devharness.yaml --format json`
  reported `needs_work (77/100)` and confirmed the external declaration, clean baseline, supported platforms, initialized submodule and local-only candidate state.
- `devharness build --repo ../AIedu_demo --config ./local-projects/aiedu-demo/devharness.yaml --format json`
  compiled a deterministic project harness with zero blockers and stored it outside the consumer repository at
  `/Users/kaimaplespark/.local/state/devharness/projects/3b5e3cf63c8008d4b848ec5ef0e6d33482b41e63c5da0288c9ee12b346df4b17/harnesses/harness-827cc1271c96af709707660543cafcb9.json`.
- AIedu_demo remained Git-clean before and after both commands.
- No consumer file was written or changed.

This means the framework-side external configuration path is now past discovery/compilation and ready for the next consumer-facing verification step.

## Consumer execution follow-up — 2026-09-01

With the same approved external-local declaration, a real `verify --execute --attest` run was started against the clean `demo_deploy` revision using the temporary DevHarness data root and the redirected Supervisor store.

The run reached isolated service launch and materialized the declared submodule before failing at startup:

- The backend container exited during legacy startup migration with `FAILED: No 'script_location' key found in configuration.`
- The frontend container exited because its entrypoint could not find `/app/package.json`, then failed to locate `.next/standalone/server.js`.
- PostgreSQL and Redis did start and report healthy status before the application services failed.
- The temporary verification containers were cleaned up after the run.

The important framework result is that DevHarness did not invent success: it exposed a concrete startup failure in the consumer stack, captured the failing logs, and kept the consumer repository unchanged.
