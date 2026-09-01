# Executable onboarding and repository understanding

## The front door

`onboard` is the first command for an existing repository:

```bash
npm run devharness -- onboard --repo ../some-project
npm run devharness -- onboard --repo ../some-project --format json
npm run devharness -- onboard --repo ../some-project --write
```

The default command is read-only. It inspects Git and repository files, reads a valid
project declaration when present, checks current trusted receipts, and produces a Repository
Understanding Brief. `--write` stores the same structured plan under DevHarness's external
state directory; it does not modify the consumer repository.

It does not install dependencies, access the network, launch processes, open a browser or
simulator, connect to a database, or use credentials. Those are bounded capabilities in the
plan and require later explicit authorization and executable drivers.

Exit code `0` means the repository baseline is ready; `2` means the command completed but the
repository still needs evidence or is blocked. Automation should read the structured
`verdict` instead of treating every `2` as a CLI crash.

## Claim Ledger

DevHarness does not use a single confidence score for repository understanding. Every claim
has one status:

| Status | Meaning |
|--------|---------|
| `detected` | A static signal exists, such as a manifest, config file or dependency. |
| `documented` | Repository prose says it is true; code/runtime may disagree. |
| `code-confirmed` | Implementation or configuration directly supports the claim. |
| `test-confirmed` | A revision-bound test proves the claim. |
| `runtime-observed` | A controlled execution observed the actual behavior. |
| `conflict` | Sources disagree. |
| `unverified` | Plausible but not proved. |
| `not-covered` | The required area has not been examined. |

Detection never promotes itself to runtime proof. A Playwright dependency does not mean the
browser flow works. A database URL does not mean migrations, indexes, constraints,
transactions or authorization are correct. A CI file does not mean the current revision was
deployed or tested.

Nor does schema-valid JSON become proof. A successful generic `verify` command remains command
evidence; web behavior additionally needs supervisor-issued browser/screenshot and network
observations bound to the executed driver and current revision. That supervisor evidence issuer
is not implemented yet, so the public trust loader currently accepts no caller-supplied evidence
or artifact root at all. It fails closed instead of treating file integrity or `producer: tool`
as provenance.

## Required coverage

An autonomous-start baseline covers every applicable domain:

- Repository and reproducible bootstrap.
- Runtime launch, readiness, ownership and teardown.
- Frontend surfaces and real interactions.
- Backend modules, contracts and failure behavior.
- Database schema, migrations, ownership, constraints, indexes, queries and transactions.
- Security assets, roles, permissions, trust boundaries, state transitions and abuse paths.
- Unit, integration, functional and system testing.
- Deployment and rollback.
- Bootstrap, migration, deployment and other automation scripts.

The baseline binds to a repository identity and exact Git commit. A changed revision
invalidates affected claims; unchanged evidence may be retained only through an explicit
incremental impact analysis.

## Contradictory or missing documentation

Documentation is evidence, not authority. Onboarding compares documentation, code, tests and
runtime observations. Missing prose is not automatically blocking if the system is directly
proved. A conflict affecting a required domain is visible and blocking until resolved or
explicitly classified.

Independent challenger roles should try to disprove high-impact system, data and security
claims. They report evidence and counterexamples, not private reasoning.

## Capability and authority plan

Onboarding groups requested capabilities instead of interrupting repeatedly. Typical requests
include dependency installation, official web research, process execution, containers,
browser automation, simulators, a disposable database and scoped credential references.

Every request declares the operation, target, scope, reason, risk and authority boundary.
Approval never expands beyond that declaration. Secret values are never stored in the plan.
Production, destructive, deployment, credential and other externally consequential actions
remain human-controlled.

Onboarding does not turn every environment-example key into a credential request. It first
selects an approved local/test recipe, then asks only for the references that recipe needs;
production keys are excluded by default. Container use is a separate high-risk request with
runtime-owned teardown.

An artifact cannot approve itself by writing `kind: human`. Strategy and capability approval
use separate, current-revision approval receipts owned by the human-gate state boundary.
Strategy hashes are recomputed from canonical content, so editing the strategy invalidates the
approval. Capability request hashes are derived from the current Goal Run's intact onboarding
artifact, never accepted from an Agent or command caller. A foreground TTY can now record a signed,
immutable capability decision after displaying its complete bounded context. Independent human
authentication and host-enforced worker isolation remain later runtime milestones, so onboarding
still cannot emit an approved understanding baseline by itself.

## Developer interaction

The default brief shows only:

- Overall verdict and bound revision.
- Confirmed versus total claim count.
- Highest-priority coverage gaps and conflicts.
- Grouped capabilities requiring authority.
- Exactly one recommended next action.

The complete plan remains machine-readable for agents and optional drill-down. This keeps
understanding auditable without making the developer review a directory of generated files.

## Current executable boundary

The command, contracts and capability authorization checkpoint in this milestone are operational.
The richer stages that map approved capabilities to declared drivers, install tools, launch a
consumer, collect browser/simulator/database evidence, build the full system model, challenge it
independently and ask for strategy approval remain the next runtime work.
Until those drivers append evidence, `onboard` returns `needs-evidence` rather than claiming
the repository is ready for autonomous development.
