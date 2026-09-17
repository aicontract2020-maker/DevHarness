# AIedu demo · auditable understanding baseline

Generated from DevHarness Phase 1 bundle (baseline + draft system-model + proposed design-strategy).

- Date: 2026-09-16 (America/Toronto)
- Repo under study: `aiedu-demo` / AI-education-demo
- Baseline id: `understanding-baseline-0bd395993f0c6888652ae35f` · verdict `needs-evidence`
- System model draft: `system-model-draft-0347787060f8d93400cd59d7` · verdict `needs-evidence`
- Design strategy draft: `design-strategy-draft-52f80b3989f08e1a05d7cd5b` · status `proposed`
- Commit: `7f32844e6d4e3bb721191f41479f01c57dbc51ac`
- Paths: baseline / system-models / strategies under DevHarness project state
- Onboarding plan: `onboard-89c2e6b6bebf7243d6d24b66427705f9`
- Working copy: `local-projects/aiedu-demo/worktree-dogfood-clean`

---

# Repository Understanding Brief (Phase 1)

- Baseline id: `understanding-baseline-0bd395993f0c6888652ae35f`
- Repository: `github.com/Maple-Spark-Ai/AI-education-demo`
- Revision: `7f32844e6d4e3bb721191f41479f01c57dbc51ac`
- Captured: 2026-09-17T03:59:18.820Z
- Verdict: **needs-evidence** (static Phase 1 never claims ready without runtime/test proof)

## Required domains

- automation
- backend
- database
- deployment
- frontend
- repository
- runtime
- security
- strategy
- testing

## Claims by domain

### automation

- `automation-surface` · **not-covered** · warning: Bootstrap, migration, rollback and deployment automation have not been exercised in a disposable environment.

### backend

- `backend-surface` · **detected** · warning: An API/backend surface was detected; request and failure flows are not yet traced.
- `backend-api_contracts` · **detected** · warning: Backend API contracts are discoverable, but not yet verified against behavior.
- `backend-orchestration` · **unverified** · warning: Backend orchestration and service coordination are not yet traced end-to-end.
- `backend-failure_paths` · **not-covered** · warning: Failure and retry paths have not been exercised.

### database

- `database-surface` · **detected** · warning: Database signals were found; schema, migrations, constraints, transactions and live behavior are unverified.
- `database-schema` · **detected** · warning: A database schema is implied by the current signals, but its shape is not yet validated.
- `database-migrations` · **detected** · warning: Migration history is present or implied, but it has not been exercised.
- `database-constraints` · **unverified** · blocking: Constraints and transactional guarantees are not yet traced from source to store.
- `database-queries` · **unverified** · blocking: Query behavior and access patterns are not yet verified against a live database.
- `database-ownership` · **not-covered** · blocking: Data ownership and lifecycle responsibilities are not yet modeled.

### deployment

- `deployment-surface` · **detected** · warning: Deployment or delivery automation files exist but were not executed. · paths: backend/src/services/homework_assignment/release.py, deployments/.env.production.example, deployments/EC2_DEPLOYMENT.md, deployments/OPERATIONS_GUIDE.md

### frontend

- `frontend-surface` · **detected** · warning: A web frontend was detected; it has not been opened or exercised.
- `frontend-routes` · **detected** · warning: Frontend route structure is present, but real navigation has not been exercised.
- `frontend-state` · **unverified** · warning: Client state, hydration and mutation flows are not yet traced.
- `frontend-user_flows` · **not-covered** · warning: Real user flows have not been proven in a browser.

### repository

- `repository-inventory` · **code-confirmed** · info: Repository identity, revision and committed inventory were inspected read-only. · paths: agents/requirements.txt, backend/pyproject.toml, frontend/package.json, loadtest/requirements.txt
- `project-declaration` · **code-confirmed** · info: A valid explicit external project declaration was parsed.

### runtime

- `runtime-surface` · **unverified** · blocking: The application, browser/simulator and user-visible behavior were not executed by onboarding.

### security

- `security-model` · **not-covered** · blocking: Roles, permissions, trust boundaries, state transitions, abuse cases and data lifecycle are not yet modeled.

### strategy

- `design-strategy` · **not-covered** · blocking: No developer-approved design and architecture strategy baseline has been established.

### testing

- `test-surface` · **detected** · warning: Test tooling may exist but has not produced current proof.

## Model / strategy coverage (honest gaps)

- System model: `system-model-draft-0347787060f8d93400cd59d7` · database=false · security=false · feature_flows=false
- Strategy: `design-strategy-draft-52f80b3989f08e1a05d7cd5b` v1 · proposed

## Onboarding rollup

- Proved 2/22 · unresolved 11 · conflicts 0
- Priority domains: database=not-covered, security=not-covered, strategy=not-covered, testing=detected, runtime=unverified, frontend=not-covered, backend=not-covered, deployment=detected

## Highest-priority blockers

- database understanding is not-covered.
- security understanding is not-covered.
- strategy understanding is not-covered.
- testing understanding is detected.
- runtime understanding is unverified.
- frontend understanding is not-covered.
- backend understanding is not-covered.
- deployment understanding is detected.

## Audit notes

- This brief is derived from the revision-bound onboarding plan + repository snapshot.
- Detection and documentation are not promoted to runtime proof.
- Draft `system-model` / `design-strategy` artifacts are revision-bound but remain `needs-evidence` / `proposed` until live proof and a human strategy gate.

