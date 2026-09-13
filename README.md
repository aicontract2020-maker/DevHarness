# DevHarness

DevHarness is an open-source autonomous engineering runtime for coding agents.

Give it a software goal. It helps clarify the outcome, researches relevant practices, produces requirements and acceptance criteria, plans the work, assembles an agent team, coordinates implementation, verifies real behavior, reviews the result, and prepares an evidence-backed pull request.

> Turn a repository into an environment where agents can pursue goals autonomously without asking developers to trust agent self-reporting.

DevHarness is in an executable local-first prototype phase. The first consumer is the separate `AIedu_demo` repository; no framework source code lives in that repository.

Milestones 0 and the first repository-readiness/runtime slices are executable: versioned contracts, durable event-backed Goal Run intake, discovery, proof-led onboarding, doctor, external project-harness compilation, isolated verification, owned local-service lifecycle, signed Supervisor provenance, foreground human approvals, a live local review surface, verification-ladder policy, and safe scheduling policy live under `packages/`.

## 30-second card

If you are a developer using DevHarness for a repo, the flow is:

```text
1. Give it one goal.
2. Read the compact brief.
3. Approve only the exact missing boundary.
4. Let it plan, split, implement, and verify.
5. Review the evidence-backed delivery brief.
```

In plain language: DevHarness is for “tell the agent what you want, inspect the brief, approve the smallest needed authority, and review proof instead of raw file dumps.”

## Intended experience

```bash
devharness onboard
devharness init
devharness doctor
devharness goal --goal "Add password reset"
```

During source development, the implemented Milestone 1 commands run as:

```bash
npm run devharness -- onboard --repo ../AIedu_demo
npm run devharness -- init --repo ../AIedu_demo
npm run devharness -- doctor --repo ../AIedu_demo
npm run devharness -- build --repo ../AIedu_demo
npm run devharness -- supervisor-init
npm run devharness -- verify --repo ../AIedu_demo --command COMMAND_ID
npm run devharness -- goal --repo ../AIedu_demo --goal "Add password reset"
npm run devharness -- advance --repo ../AIedu_demo --run RUN_ID
npm run devharness -- request-capability --repo ../AIedu_demo --run RUN_ID --capability browser-runtime
npm run devharness -- approve --repo ../AIedu_demo --request REQUEST_ID
npm run devharness -- status --repo ../AIedu_demo --run RUN_ID
```

To test DevHarness locally without adding any file to the consumer repository, keep the declaration
outside it and pass the path explicitly:

```bash
npm run devharness -- doctor --repo ../AIedu_demo --config ./local-projects/aiedu-demo/devharness.yaml
npm run devharness -- build --repo ../AIedu_demo --config ./local-projects/aiedu-demo/devharness.yaml
```

Explicit external configs use the same validated contract and remain bound to the consumer's clean
Git commit. A `--config` path inside the consumer repository is rejected. Omitting `--config`
preserves the normal tracked `devharness.yaml` workflow.

### Generate `devharness.yaml` for a new project

```bash
# Dry-run proposal (writes nothing)
npm run devharness -- init --repo /path/to/your-project

# Write a tracked declaration into the consumer repo (fails if the file already exists)
npm run devharness -- init --repo /path/to/your-project --write

# Or keep the declaration outside the consumer and pass it explicitly
mkdir -p ./local-projects/my-project
# save the reviewed proposal as ./local-projects/my-project/devharness.yaml
npm run devharness -- doctor --repo /path/to/your-project \
  --config ./local-projects/my-project/devharness.yaml
npm run devharness -- build --repo /path/to/your-project \
  --config ./local-projects/my-project/devharness.yaml
npm run devharness -- build --repo /path/to/your-project \
  --config ./local-projects/my-project/devharness.yaml --write
```

`init` discovers platforms, quality commands, and (when possible) Playwright loopback readiness
bindings. Review and hand-edit launch/readiness details before relying on them; `init` does not
invent health routes or ports. See [docs/devharness-quickstart.md](./docs/devharness-quickstart.md)
for the full new-project flow.

`onboard` performs read-only understanding and capability planning; its optional `--write` stores only the plan in external DevHarness state. `init` and `build` are dry runs unless `--write` is explicitly supplied. `verify` does not run processes unless `--execute` is supplied, and public execution also requires a Goal Run plus every current signed capability required by the exact command. A passing configured test becomes trusted test evidence only with `--attest`; generic receipts never promote readiness. `goal` creates a real external, event-backed run at a clean committed revision. `advance` now records the first static understanding checkpoint and publishes an Alignment Brief. `request-capability` can then derive one exact bounded browser, database, service or other capability from that checkpoint and create a signed pending request; it still does not execute consumer code.

The current trusted-control flows are:

```bash
npm run devharness -- supervisor-init
npm run devharness -- verify --repo ../some-project --run RUN_ID --command TEST_ID --execute --attest
npm run devharness -- request-approval --repo ../some-project \
  --run RUN_ID --gate scope --subject SCOPE_ID --subject-sha SHA256
npm run devharness -- approve --repo ../some-project --request REQUEST_ID

npm run devharness -- request-capability --repo ../some-project \
  --run RUN_ID --capability browser-runtime
npm run devharness -- approve --repo ../some-project --request REQUEST_ID
```

`approve` works only in a foreground TTY and requires the exact request-specific confirmation phrase. JSON mode, piped input and `--yes` are refused. TTY presence is not yet independent human authentication, and signatures do not isolate a Supervisor from an unrestricted same-OS-user worker. `doctor` therefore reports `supervisor-isolation` as a blocking failure until authenticated control and a worker sandbox are implemented and proved.

Today, `onboard` is intentionally honest: it distinguishes detected, code-confirmed,
test-confirmed and runtime-observed claims and normally returns `needs-evidence`. The contracts
for database/security system modeling, approved design strategy, the proof ladder and safe
parallel work are implemented; the browser/simulator/database/deployment/load/canary drivers
that satisfy those contracts are still being built.

## Developer review page

`apps/review-ui` is the first executable Decision Surface for run and delivery review. It turns the
quantitative scorecard into a one-screen verdict, proof-coverage breakdown, blocking-exception
queue, and criterion-level trace/evidence/replay view. Its data now conforms to the portable
`review-scorecard` schema and the core projector computes the same five dimensions
deterministically. It can connect to the token-protected local review service, select stored Goal
Runs, load the current Alignment Brief when present, and refresh every five seconds. Without that
connection, the bundled document remains visibly labeled sample data.

```bash
npm run review-ui
# Use the exact origin printed above if the development server chooses another port.
npm run devharness -- review --repo ../AIedu_demo --ui-origin http://localhost:3000
```

Open the URL printed by `review`. The access token stays in the URL fragment, the service binds only
to loopback, accepts only the configured page origin, exposes read-only routes, and sends no-store
responses. The page deliberately disables approval while any hard gate is blocked. A developer can
inspect each alignment claim, blocker or acceptance criterion without reading the underlying artifact
set. Static understanding cannot expose an approve action; the page says that scope approval is
unavailable until live understanding and acceptance are proved. During alignment it also shows one
compact project-declaration assessment before capabilities: deterministic structural coverage,
service/verification mapping counts, blocking gaps and at most one developer decision. Structural
coverage is explicitly not runtime proof. The capability panel then shows exact operation, target,
scope, risk, authority, reason, signed-decision status and one next command. The page remains GET-only
and cannot approve on the developer's behalf.

The default workflow is:

```text
goal
  -> repository discovery
  -> autonomous clarification and research
  -> Alignment Brief
  -> developer understanding-and-acceptance approval
  -> planning and dynamic team formation
  -> isolated implementation
       -> Progress Pulse (no action)
       -> Decision Queue (material exceptions only)
  -> independent verification and review
  -> repair loops
  -> Delivery Brief + evidence-backed pull request
  -> developer delivery approval
```

DevHarness keeps durable engineering artifacts, decisions, evidence, progress, and blockers, but does not make them all required reading. Developers normally interact through four compact, traceable packets: Alignment Brief, Decision Queue, Progress Pulse, and Delivery Brief. DevHarness does not expose or depend on a model's private chain of thought.

For the bounded v0 walkthrough, see [specs/single-agent-goal-runtime/walkthrough.md](./specs/single-agent-goal-runtime/walkthrough.md).

For a one-page developer-facing overview, see [docs/devharness-quickstart.md](./docs/devharness-quickstart.md).

## Product boundaries

DevHarness is:

- A persistent goal runtime, not a prompt collection.
- Agent-agnostic through explicit adapters.
- Project-agnostic through platform packs and generated project harnesses.
- Evidence-driven: completion requires falsifiable acceptance criteria and external proof.
- Local-first in v0, with a path to remote and long-running execution.

DevHarness is not:

- A universal verifier that pretends every project can be tested the same way.
- A replacement for a project's own tests, build system, or CI.
- An autonomous merge bot in v0.
- A reason to copy framework implementation into consumer repositories.

## Repository map

The planned source layout is:

```text
packages/
  cli/          command-line user experience
  core/         goal state machine and policies
  project/      repository discovery, init, and readiness
  runtime/      orchestration, recovery, workspaces, and budgets
  schema/       configuration and artifact contracts
  evidence/     verification evidence and verdicts
adapters/
  agents/       Codex, Claude Code, Cursor, and future agents
  research/     web and documentation research providers
  vcs/          GitHub and future source-control providers
packs/
  web/          browser-based applications
  api/          HTTP and service applications
  cli/          command-line applications
templates/      generated project-harness templates
docs/           product, architecture, decisions, and roadmap
```

## Design documents

- [Principles (中文)](docs/devharness-principles-zh.md)
- [Existing-project three phases](docs/existing-project-onboarding-phases.md)
- [Product definition](docs/product.md)
- [Architecture](docs/architecture.md)
- [Runtime contracts](docs/contracts.md)
- [Developer interaction model](docs/interaction-model.md)
- [Quantitative review scorecard](docs/review-scorecard.md)
- [Reusable review assessment template](docs/templates/review-assessment.md)
- [Repository discovery and doctor](docs/doctor.md)
- [Executable onboarding and repository understanding](docs/onboarding-and-understanding.md)
- [System model and approved strategy](docs/system-model-and-strategy.md)
- [Verification ladder and safe parallel execution](docs/verification-and-parallel-execution.md)
- [Verification receipts](docs/verification-receipts.md)
- [Supervisor provenance and human gates](docs/supervisor-provenance.md)
- [Project harness compilation](docs/project-harness.md)
- [Consumer contract](docs/consumer-contract.md)
- [MVP plan](docs/mvp.md)
- [Framework/consumer separation decision](docs/adr/0001-framework-consumer-separation.md)
- [Adopted patterns from gstack, pstack, and Noodle](docs/adr/0002-adopt-runtime-patterns-without-copying-products.md)
- [Revision-bound verification receipt decision](docs/adr/0003-receipts-are-revision-bound-execution-proof.md)
- [Owned lifecycle and explicit readiness decision](docs/adr/0004-project-harness-owns-service-lifecycle.md)
- [Decision Surface over rich artifacts](docs/adr/0005-use-a-decision-surface-over-rich-artifacts.md)
- [Proof-led executable onboarding](docs/adr/0006-proof-led-executable-onboarding.md)
- [Supervisor-issued evidence and approvals](docs/adr/0007-supervisor-issued-provenance.md)
- [AIedu_demo discovery/doctor dogfood](docs/dogfood/aiedu-demo-2026-08-29.md)

## Development

DevHarness currently requires Node.js 22 or newer and has no third-party runtime or development dependencies.

```bash
npm test
```

The test suite validates schemas, state transitions, event-stream integrity, deterministic harness compilation, process ownership and teardown, commit-bound evidence, independent verification, independent review, and the two human gates.
