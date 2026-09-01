# Task List: Project Harness Generator and Owned Service Lifecycle

## Plan Reference

Implements: `specs/project-harness-generator/plan.md`

## Tasks

- [x] **TASK-001** [M] Write contract fixtures and failing schema tests
  - Tests: AC-1, AC-2, AC-3, AC-E1, AC-E3
  - Creates: `project-harness.schema.json`; expands project-config and receipt fixtures
  - Depends on: none

- [x] **TASK-002** [M] Implement lifecycle and harness schemas
  - Satisfies: AC-1, AC-2, AC-3, AC-E1, AC-E3
  - Contract: `contracts/project-harness.md`
  - Depends on: TASK-001

- [x] **TASK-003** [M] Write compiler and storage tests
  - Tests: AC-1, AC-2, AC-3, AC-E1, AC-E3
  - Depends on: TASK-002

- [x] **TASK-004** [M] Implement pure harness compilation and explicit persistence
  - Satisfies: AC-1, AC-2, AC-3, AC-E1, AC-E3
  - Contract: `contracts/project-harness.md`
  - Depends on: TASK-003

- [x] **TASK-005** [M] Write lifecycle execution and cleanup tests
  - Tests: AC-4, AC-5, AC-E2, AC-E3
  - Depends on: TASK-002

- [x] **TASK-006** [M] Implement service startup, readiness gate, evidence, and bounded teardown
  - Satisfies: AC-4, AC-5, AC-E2, AC-E3
  - Contract: `contracts/lifecycle-verification.md`
  - Depends on: TASK-005

- [x] **TASK-007** [S] Write doctor and CLI integration tests
  - Tests: AC-1, AC-2, AC-3, AC-6
  - Depends on: TASK-004, TASK-006

- [x] **TASK-008** [M] Integrate `build`, lifecycle receipts, and readiness scoring
  - Satisfies: AC-1, AC-2, AC-3, AC-6
  - Contracts: `contracts/project-harness.md`, `contracts/lifecycle-verification.md`
  - Depends on: TASK-007

- [x] **TASK-009** [S] Run full validation and create reviewer walkthrough
  - Tests: all MUST acceptance criteria
  - Depends on: TASK-008
