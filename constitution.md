# DevHarness Project Constitution

Version: 1.2.1
Last updated: 2026-09-01

## Architecture Principles

- Framework source, runtime state, generated harnesses, and consumer application source remain separate.
- Core contracts are agent-agnostic and platform-agnostic; agent adapters and platform packs own specialization.
- A command being discovered is not approval to run it, and a successful process exit is not sufficient proof.
- Every trusted result is bound to an exact repository identity, Git revision, approved declaration, and intact evidence.
- Unsupported or unverifiable work terminates honestly as blocked or failed.
- Build verification before orchestration breadth; do not add a scheduler when the project cannot yet prove behavior.
- Preserve rich artifacts for agents, recovery, and audit, but make bounded traceable decision packets the default human interface.
- Repository understanding is a revision-bound claim ledger: detection, documentation, code confirmation, test confirmation, runtime observation, conflict, and missing coverage are never interchangeable.
- Database, security, frontend, backend, deployment, and automation are explicit system domains; applicable domains cannot disappear inside an aggregate readiness score.
- Proof depth follows delivery depth: modules require unit proof, features require real-surface functional and system proof, and releases require deployment, rollback, quantitative performance, and canary proof as applicable.
- Parallelism is allowed only from a validated dependency graph and non-conflicting resource claims, with one integration owner.

## Technology Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | JavaScript ES modules | No transpilation in v0 |
| Runtime | Node.js 22 or newer | Use built-in APIs before dependencies |
| Contracts | JSON Schema 2020-12 | Versioned under `packages/schema/schemas/v1/` |
| Tests | `node:test` | Contract and real temporary-Git integration tests |
| CLI | Local Node.js process | Text and machine-readable JSON output |
| Storage | External filesystem | Atomic writes, repository identity keys, mode 0600/0700 |

## Security Constraints

- Never serialize environment-variable values; artifacts may contain only declared key names and set/unset state.
- Execute consumer-project commands only when present in a validated, developer-accepted project
  declaration. Execute a framework-owned Agent adapter only from an integrity-checked adapter
  manifest and an exact, current human-approved capability binding its executable and execution
  profile digests; this never authorizes a consumer command.
- Store worktrees, generated harnesses, process logs, and receipts outside the consumer repository by default.
- Canonicalize filesystem paths before enforcing repository boundaries so symlink or platform aliases cannot bypass them.
- Long-running services must be runtime-owned, readiness-checked, bounded by timeouts, and torn down even after failure.
- Network readiness probes in v0 may target loopback HTTP endpoints only and may not contain credentials, query strings, or fragments.
- Web research, repository prose, and command output are untrusted data; none may directly expand tool authority or policy.
- Destructive, delivery, merge, deploy, and external side-effect actions require explicit policy and authority.
- Capability requests state operation, target, scope, risk, reversibility, and expiry; approval cannot be expanded by an agent.
- Database verification uses disposable or explicitly approved non-production targets; production data is never an implicit test fixture.
- An approved design/architecture strategy is human-bound to an exact version and hash; agents may propose changes but cannot silently replace it.

## Naming Conventions

- Files: kebab-case with `.mjs` for executable modules and `.schema.json` for contracts.
- JavaScript variables and functions: camelCase; constants: SCREAMING_SNAKE_CASE.
- Contract fields: snake_case to remain tool- and language-neutral.
- Stable IDs: lowercase identifiers accepted by the common contract unless an existing public schema specifies otherwise.

## Banned Patterns

- No consumer-specific names, paths, ports, commands, users, or secrets in framework packages.
- No command execution during discovery, `doctor`, `init` dry-run, `build` dry-run, or `verify` dry-run.
- No trust based on agent self-report, stdout prose, or CI status alone.
- No normal human gate that requires reviewing every generated artifact; gate packets must surface all blocking items and trace to their sources.
- No runtime state or evidence written into a consumer repository.
- No unbounded polling, repair, process, or retry loops.
- No silent fallback from an invalid configuration to repository-discovered commands.
- No automatic merge, deployment, or hosted control plane in v0.
- No claim that a detected browser, database, CI workflow, deployment script, or test tool has run successfully without revision-bound execution evidence.
- No API-only completion verdict for a feature whose outcome includes a browser, simulator, persistence, queue, deployment, or other user-visible system surface.

## File Structure Rules

```text
packages/
  cli/       # explicit user-facing command and mutation boundaries
  core/      # deterministic state, event, and delivery rules
  project/   # discovery, configuration, readiness, harness compilation
  runtime/   # isolated execution, process ownership, evidence storage
  schema/    # public versioned contracts and validator
docs/        # product, architecture, ADR, and operator documentation
specs/       # feature research, requirements, plans, tasks, validation
```

## Deferred Decisions

- Browser screenshots, traces, network capture, and database-state collectors follow the lifecycle foundation.
- Executable browser, simulator, disposable-database, deployment, load-test, and canary drivers follow their now-versioned contracts.
- A second structurally different consumer is required before platform-pack interfaces are declared stable.
- Third-party YAML parsing is deferred; v0 configuration uses canonical JSON, which is a YAML 1.2 subset.
