# Plan: Executable System Onboarding

Date: 2026-08-29

## Components

1. **Public contracts**
   - `capability-request`: bounded external authority.
   - `repository-baseline`: claim ledger, conflicts, domain coverage and system models.
   - `verification-policy`: work-unit/feature/release proof ladder.
   - `execution-graph`: dependency, ownership and resource isolation.
   - `onboarding-plan`: compact aggregate returned by the CLI.
2. **Deterministic policies**
   - Evaluate repository-baseline trust without model judgment.
   - Evaluate verification-stage completeness and anti-shortcut rules.
   - Derive safe scheduling waves and reject graph/lock/ownership errors.
3. **Project onboarding**
   - Reuse discovery, config reading, receipts and doctor.
   - Generate provisional claims only from concrete snapshot/receipt facts.
   - Generate explicit authority requests for missing live proof.
4. **CLI and storage**
   - Add read-only `onboard`; optional `--write` stores the plan externally.
   - Format a bounded brief and stable JSON.
5. **Documentation**
   - Define onboarding, system understanding, proof ladder, strategy baseline and scheduling.
   - Update architecture, MVP and README without claiming deferred drivers exist.

## Data flow

```text
repository -> discover -> snapshot --------------------+
                         accepted config + receipts ---+-> onboard policy
                                                         -> onboarding plan
                                                         -> compact brief
                                                         -> optional external write
```

Later executable drivers will append runtime-observed/test-confirmed claims and evidence;
they will not mutate the meaning of claims emitted here.

## Security and data boundaries

- Discovery never serializes secret values.
- Onboarding planning invokes no consumer command and performs no network access.
- Requested authorities are declarative and scoped; they grant nothing by themselves.
- External plan writes reuse identity-keyed private storage and atomic replace semantics.
- Live database work must target a disposable or explicitly approved non-production scope.

## Risks and mitigations

- **False completeness:** required domains and epistemic statuses block optimistic readiness.
- **Contract sprawl:** schemas are narrow, composable and covered by semantic policy tests.
- **Scheduler built too early:** this slice validates graphs and derives waves only; it does
  not dispatch agents.
- **Human overload:** output remains a compact brief with one recommended action.
- **Overfitting web:** domain contracts are platform-neutral; driver choices are values, not
  core code branches.

## Traceability

| AC | Component |
|----|-----------|
| AC-1–3, AC-13–14 | Project onboarding, CLI, storage |
| AC-4 | Capability request contract |
| AC-5–6, AC-10 | Repository baseline + onboarding policy |
| AC-7–8 | Verification policy contract + evaluator |
| AC-9 | Execution graph + scheduling policy |
| AC-11 | Schema/core/project/CLI tests |
| AC-12 | Path policy + external data store |
| AC-15 | Documentation |
| AC-16–18 | Explicit non-implementation boundaries |
