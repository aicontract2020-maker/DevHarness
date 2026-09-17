# AIedu demo · auditable understanding baseline

Generated from DevHarness Phase 1 `repository-understanding-baseline` (not a hand stub).

- Date: 2026-09-16 (America/Toronto)
- Repo under study: `aiedu-demo` / AI-education-demo
- Baseline id: `understanding-baseline-52e375ff2ab315cb03c0ac78`
- Verdict: `needs-evidence`
- Commit: `7f32844e6d4e3bb721191f41479f01c57dbc51ac`
- Artifact path: `/Users/kaimaplespark/.local/state/devharness/projects/3b5e3cf63c8008d4b848ec5ef0e6d33482b41e63c5da0288c9ee12b346df4b17/understanding/understanding-baseline-52e375ff2ab315cb03c0ac78.json`
- Onboarding plan: `onboard-89c2e6b6bebf7243d6d24b66427705f9`
- Working copy: `local-projects/aiedu-demo/worktree-dogfood-clean`
- Goal run (advance dogfood): `run-7b0bd767-ae4a-4f0b-8d20-bf01365e1b96`
- Advance baseline id: `understanding-baseline-184c07f92e7221b8dcc5a4df`
- Checkpoint: `.../runs/run-7b0bd767-ae4a-4f0b-8d20-bf01365e1b96/checkpoints/00000007`

---

# Repository Understanding Brief (Phase 1)

- Baseline id: `understanding-baseline-52e375ff2ab315cb03c0ac78`
- Repository: `github.com/Maple-Spark-Ai/AI-education-demo`
- Revision: `7f32844e6d4e3bb721191f41479f01c57dbc51ac`
- Captured: 2026-09-17T03:48:36.630Z
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

- System model: `system-model-pending` · database=false · security=false · feature_flows=false
- Strategy: `strategy-pending` v1 · proposed

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
- `system-model-pending` / `strategy-pending` mark missing Phase 1 products that still need evidence-backed modeling and human approval.

