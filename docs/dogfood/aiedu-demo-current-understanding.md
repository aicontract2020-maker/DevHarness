# Repository Understanding Brief (Phase 1)

- Baseline id: `understanding-baseline-0ef4096e3d1a7c80bb1db81c`
- Repository: `github.com/Maple-Spark-Ai/AI-education-demo`
- Revision: `7f32844e6d4e3bb721191f41479f01c57dbc51ac`
- Captured: 2026-09-17T04:16:57.900Z
- Verdict: **needs-evidence** (static Phase 1 never claims ready without runtime/test proof)

## Required domains

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

- `backend-surface` · **test-confirmed** · info: An API/backend surface was detected; request and failure flows are not yet traced.
- `backend-api_contracts` · **test-confirmed** · info: Backend API contracts are discoverable, but not yet verified against behavior.
- `backend-orchestration` · **test-confirmed** · info: Backend orchestration and service coordination are not yet traced end-to-end.
- `backend-failure_paths` · **not-covered** · warning: Failure and retry paths have not been exercised.

### database

- `database-surface` · **test-confirmed** · info: Database signals were found; schema, migrations, constraints, transactions and live behavior are unverified.
- `database-schema` · **test-confirmed** · info: A database schema is implied by the current signals, but its shape is not yet validated.
- `database-migrations` · **test-confirmed** · info: Migration history is present or implied, but it has not been exercised.
- `database-constraints` · **test-confirmed** · info: Constraints and transactional guarantees are not yet traced from source to store.
- `database-queries` · **test-confirmed** · info: Query behavior and access patterns are not yet verified against a live database.
- `database-ownership` · **not-covered** · blocking: Data ownership and lifecycle responsibilities are not yet modeled.

### deployment

- `deployment-surface` · **test-confirmed** · info: Deployment or delivery automation files exist but were not executed. · paths: backend/src/services/homework_assignment/release.py, deployments/.env.production.example, deployments/EC2_DEPLOYMENT.md, deployments/OPERATIONS_GUIDE.md

### frontend

- `frontend-surface` · **test-confirmed** · info: A web frontend was detected; it has not been opened or exercised.
- `frontend-routes` · **test-confirmed** · info: Frontend route structure is present, but real navigation has not been exercised.
- `frontend-state` · **test-confirmed** · info: Client state, hydration and mutation flows are not yet traced.
- `frontend-user_flows` · **not-covered** · warning: Real user flows have not been proven in a browser.

### repository

- `repository-inventory` · **test-confirmed** · info: Repository identity, revision and committed inventory were inspected read-only. · paths: agents/requirements.txt, backend/pyproject.toml, frontend/package.json, loadtest/requirements.txt
- `project-declaration` · **test-confirmed** · info: A valid explicit external project declaration was parsed.

### runtime

- `runtime-surface` · **test-confirmed** · info: The application, browser/simulator and user-visible behavior were not executed by onboarding.

### security

- `security-model` · **not-covered** · blocking: Roles, permissions, trust boundaries, state transitions, abuse cases and data lifecycle are not yet modeled.

### strategy

- `design-strategy` · **not-covered** · blocking: No developer-approved design and architecture strategy baseline has been established.

### testing

- `test-surface` · **test-confirmed** · info: Test tooling may exist but has not produced current proof.

## Model / strategy coverage (honest gaps)

- System model: `system-model-draft-9b2f632e9820458a8b868fc2` · database=true · security=true · feature_flows=true
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

## Path to understanding-ready

- Verdict: **not ready** (11 blockers)

- `baseline_verdict_not_ready`: Baseline artifact verdict is needs-evidence.
- `blocking_claim`: Required domain database retains blocking claim database-ownership. · subject `database-ownership`
- `domain_unproved`: Required domain security has no evidence-backed claim. · subject `security`
- `live_domain_unproved`: Live domain security has not been test-confirmed or runtime-observed. · subject `security`
- `blocking_claim`: Required domain security retains blocking claim security-model. · subject `security-model`
- `domain_unproved`: Required domain strategy has no evidence-backed claim. · subject `strategy`
- `blocking_claim`: Required domain strategy retains blocking claim design-strategy. · subject `design-strategy`
- `system_flow_evidence_invalid`: Flow flow-health-ready references missing or stale evidence backend/src/main.py. · subject `flow-health-ready`
- `system_flow_evidence_invalid`: Flow flow-health-ready references missing or stale evidence backend/src/main.py. · subject `flow-health-ready`
- `system_model_incomplete`: The referenced system model is not complete. · subject `system-model-draft-9b2f632e9820458a8b868fc2`
- `strategy_not_approved`: Both the referenced strategy and baseline require an independent approved human gate receipt. · subject `design-strategy-draft-52f80b3989f08e1a05d7cd5b`

### Strategy gate

- Current strategy: `design-strategy-draft-52f80b3989f08e1a05d7cd5b` · status **proposed**
- Next: `devharness request-approval --run <ID> --for-strategy` then foreground `approve`

### Baseline verdict field

- Stored baseline verdict remains `needs-evidence` until live proof promotes it (static onboard never writes `ready`).

## Audit notes

- This brief is derived from the revision-bound onboarding plan + repository snapshot.
- Detection and documentation are not promoted to runtime proof.
- Draft `system-model` / `design-strategy` artifacts are revision-bound but remain `needs-evidence` / `proposed` until live proof and a human strategy gate.
