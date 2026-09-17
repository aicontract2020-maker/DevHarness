# AIedu demo · auditable understanding baseline

Phase 1 now reports an explicit path-to-ready gap list, and strategy can be bound via `request-approval --for-strategy`.

- Date: 2026-09-17 (America/Toronto)
- Baseline: `understanding-baseline-25a5a84f8bc8917f4f8ae688` · `needs-evidence`
- System model: `system-model-draft-9b2f632e9820458a8b868fc2` · entities 14 · roles 6
- Design strategy: `design-strategy-draft-52f80b3989f08e1a05d7cd5b` · `proposed`
- Coverage: database=True · security=True · flows=True
- Understanding ready: **False** (32 blockers)
- Strategy gate dogfood request: `approval-request-ce3963a48ac209b4261c2deac0e53ef1` on `run-94d04491-f45b-41b4-b3bc-7ab73a0221b1`

### Top ready blockers
- `required_domains_mismatch`: Required domains must be derived from the current repository and goal impact.
- `baseline_verdict_not_ready`: Baseline artifact verdict is needs-evidence.
- `domain_unproved`: Required domain automation has no evidence-backed claim.
- `live_domain_unproved`: Live domain automation has not been test-confirmed or runtime-observed.
- `domain_unproved`: Required domain backend has no evidence-backed claim.
- `live_domain_unproved`: Live domain backend has not been test-confirmed or runtime-observed.
- `domain_unproved`: Required domain database has no evidence-backed claim.
- `live_domain_unproved`: Live domain database has not been test-confirmed or runtime-observed.
- `blocking_claim`: Required domain database retains blocking claim database-constraints.
- `blocking_claim`: Required domain database retains blocking claim database-queries.
- `blocking_claim`: Required domain database retains blocking claim database-ownership.
- `domain_unproved`: Required domain deployment has no evidence-backed claim.
- `live_domain_unproved`: Live domain deployment has not been test-confirmed or runtime-observed.
- `domain_unproved`: Required domain frontend has no evidence-backed claim.
- `live_domain_unproved`: Live domain frontend has not been test-confirmed or runtime-observed.

---

# Repository Understanding Brief (Phase 1)

- Baseline id: `understanding-baseline-25a5a84f8bc8917f4f8ae688`
- Repository: `github.com/Maple-Spark-Ai/AI-education-demo`
- Revision: `7f32844e6d4e3bb721191f41479f01c57dbc51ac`
- Captured: 2026-09-17T04:09:58.485Z
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

- Verdict: **not ready** (32 blockers)

- `required_domains_mismatch`: Required domains must be derived from the current repository and goal impact.
- `baseline_verdict_not_ready`: Baseline artifact verdict is needs-evidence.
- `domain_unproved`: Required domain automation has no evidence-backed claim. · subject `automation`
- `live_domain_unproved`: Live domain automation has not been test-confirmed or runtime-observed. · subject `automation`
- `domain_unproved`: Required domain backend has no evidence-backed claim. · subject `backend`
- `live_domain_unproved`: Live domain backend has not been test-confirmed or runtime-observed. · subject `backend`
- `domain_unproved`: Required domain database has no evidence-backed claim. · subject `database`
- `live_domain_unproved`: Live domain database has not been test-confirmed or runtime-observed. · subject `database`
- `blocking_claim`: Required domain database retains blocking claim database-constraints. · subject `database-constraints`
- `blocking_claim`: Required domain database retains blocking claim database-queries. · subject `database-queries`
- `blocking_claim`: Required domain database retains blocking claim database-ownership. · subject `database-ownership`
- `domain_unproved`: Required domain deployment has no evidence-backed claim. · subject `deployment`
- `live_domain_unproved`: Live domain deployment has not been test-confirmed or runtime-observed. · subject `deployment`
- `domain_unproved`: Required domain frontend has no evidence-backed claim. · subject `frontend`
- `live_domain_unproved`: Live domain frontend has not been test-confirmed or runtime-observed. · subject `frontend`
- `domain_unproved`: Required domain runtime has no evidence-backed claim. · subject `runtime`
- `live_domain_unproved`: Live domain runtime has not been test-confirmed or runtime-observed. · subject `runtime`
- `blocking_claim`: Required domain runtime retains blocking claim runtime-surface. · subject `runtime-surface`
- `domain_unproved`: Required domain security has no evidence-backed claim. · subject `security`
- `live_domain_unproved`: Live domain security has not been test-confirmed or runtime-observed. · subject `security`
- `blocking_claim`: Required domain security retains blocking claim security-model. · subject `security-model`
- `domain_unproved`: Required domain strategy has no evidence-backed claim. · subject `strategy`
- `blocking_claim`: Required domain strategy retains blocking claim design-strategy. · subject `design-strategy`
- `domain_unproved`: Required domain testing has no evidence-backed claim. · subject `testing`

### Strategy gate

- Current strategy: `design-strategy-draft-52f80b3989f08e1a05d7cd5b` · status **proposed**
- Next: `devharness request-approval --run <ID> --for-strategy` then foreground `approve`

### Baseline verdict field

- Stored baseline verdict remains `needs-evidence` until live proof promotes it (static onboard never writes `ready`).

## Audit notes

- This brief is derived from the revision-bound onboarding plan + repository snapshot.
- Detection and documentation are not promoted to runtime proof.
- Draft `system-model` / `design-strategy` artifacts are revision-bound but remain `needs-evidence` / `proposed` until live proof and a human strategy gate.

