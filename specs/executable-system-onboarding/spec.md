# Specification: Executable System Onboarding

Status: Approved for implementation from developer direction
Date: 2026-08-29

## Outcome

A developer can run one read-only command and receive a compact, truthful explanation of
what DevHarness knows about the repository, what remains unproved or contradictory, what
capabilities would be needed to establish a runnable baseline, and the next recommended
action. Versioned contracts also establish how later goal runs must reason about system
understanding, proof depth, security/database impact and safe parallel work.

## Acceptance criteria

### MUST

- **AC-1** `devharness onboard --repo PATH` performs repository discovery and readiness
  evaluation without executing project commands, installing software, or writing files.
- **AC-2** JSON output contains a revision-bound onboarding plan, provisional claim ledger,
  coverage by system domain, authority requests, blockers and exactly one recommended next
  action.
- **AC-3** Text output is a compact Repository Understanding Brief; it clearly says that
  detected capabilities are unverified until runtime evidence exists.
- **AC-4** A capability request contract distinguishes install, process, network, browser,
  simulator, database, credential, container, deployment and destructive authority and
  records risk, reason, scope and whether approval is required.
- **AC-5** A repository understanding baseline contract binds claims to repository identity
  and commit, uses explicit claim statuses, surfaces source conflicts, and covers repository,
  runtime, frontend, backend, database, security, testing, deployment and automation.
- **AC-6** A deterministic onboarding policy blocks trust when required coverage is absent,
  conflicts are unresolved, claims lack evidence, or live-system claims are based only on
  detection/documentation.
- **AC-7** A verification policy contract requires unit proof for each implemented module,
  integration proof for real dependency boundaries, real-surface functional and system
  proof for a feature, and release-only deployment/rollback/performance/canary stages.
- **AC-8** Verification policy rejects API-only or CI-only feature completion and requires
  quantitative thresholds for performance stages.
- **AC-9** An execution graph contract and deterministic scheduling policy allow concurrent
  tasks only when dependencies are satisfied and file/data/service/port/environment locks
  do not conflict; it identifies one integration owner and a critical path.
- **AC-10** Database and security impact are explicit per goal/task rather than inferred from
  generic backend scope.
- **AC-11** New contracts have positive and negative fixtures; policies and CLI behavior have
  focused automated tests.
- **AC-12** Framework source and generated state remain outside consumer repositories except
  for the explicitly accepted `devharness.yaml` declaration.

### SHOULD

- **AC-13** `onboard --write` atomically stores the plan in external identity-keyed state
  without altering the consumer repository.
- **AC-14** The brief shows database/security/design/testing gaps before general warnings.
- **AC-15** Documentation distinguishes this contract milestone from still-missing live
  browser, database, simulator and load-test drivers.

### WONT in this slice

- **AC-16** Automatically install packages, browsers, simulators or database engines.
- **AC-17** Execute onboarding actions or grant authority from CLI flags.
- **AC-18** Implement the autonomous goal runtime, scheduler workers, PR creation or merge.

## Failure semantics

- Unsupported or incomplete understanding returns `needs-evidence` or `blocked`, never
  `ready` by optimistic inference.
- Unresolved document/code/runtime conflicts are blocking when they affect a required
  coverage domain.
- Missing authority is an explicit requested action, not an execution error.
- A plan may be useful while incomplete; the CLI uses a non-zero readiness exit code without
  treating the command itself as failed.

## Human interaction

The default brief is bounded to verdict, repository/revision, confirmed vs unverified claim
counts, required-domain coverage, top blockers, grouped authority request and one next action.
Every summary item traces to the structured plan; raw evidence remains optional drill-down.
