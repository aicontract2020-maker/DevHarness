# Verification ladder and safe parallel execution

## Proof ladder

Verification depth follows the unit of delivery:

| Work | Required proof |
|------|----------------|
| Module/task | Focused unit tests for implemented logic and edge cases. |
| Integration boundary | Real disposable dependencies, contracts and failure behavior. |
| Feature | Unit + integration + actual functional surface + complete system path. |
| Release candidate | Deployment/migration/rollback + quantitative performance readiness. |
| Production deployment | Post-deploy canary on the deployed identity. |

For web work, functional proof uses a browser. For mobile work it uses a simulator or approved
device. CLI work uses a PTY and observes exit, streams and filesystem effects. API tests are
necessary for API boundaries but do not replace the real user surface of a web/mobile feature.

Deployment and automation scripts are executed in a disposable environment; linting them is
not sufficient. Database changes require real migrations, constraints and rollback proof.
Concurrency-sensitive paths require race/idempotency exercises.

Performance stages state the load model and numeric thresholds. Depending on risk, the plan
may require load, spike, soak and data-volume tests. “Looks fast” and process exit zero are not
performance verdicts.

The current runtime can execute an isolated configured command and own one local service. The
proof-ladder contract exists now; browser/simulator/database/deployment/load/canary collectors
are still pending and therefore cannot produce a passing feature or release verdict yet.

## Planning for parallel work

Long work is expressed as a dependency DAG. Every node declares:

- Dependencies and acceptance criteria.
- Expected duration and proof stage.
- Allowed filesystem scope.
- Shared or exclusive path, data, schema, database, service, port, workspace, environment and
  external-resource claims.
- Isolated workspace and run namespaces.
- Whether a Progress Pulse is required.
- Explicit database, security, deployment and automation impact, affected subjects and
  required proof for every ready task.

The deterministic scheduling policy forms a parallel wave only from dependency-ready tasks
whose resource claims do not conflict. Shared/read-like claims may coexist; any matching
exclusive claim serializes the tasks. Schema migrations, integration and release ownership
are serialized by default.

The objective is a shorter critical path, not the largest agent count. A task with more
downstream work receives priority, with stable task IDs as a deterministic tie-breaker.
Unresolved interfaces, shared migrations and final integration are not parallelized.

## Integration owner and long tasks

One Integration Owner is responsible for combining task outputs, resolving contract drift,
running cross-module proof and deciding the final verification order. Implementers cannot
self-approve behavior-critical changes.

Long-running tasks publish compact Progress Pulses derived from durable task and evidence
state: current step, completed/total checks, blockers, elapsed budget and next update. A pulse
contains no decision and no private chain-of-thought. Material uncertainty becomes a bounded
Decision Queue instead.

The current scheduler implementation validates and plans safe waves only. Durable resource
leases, concurrent worker dispatch, child worktrees/databases/ports, integration execution and
failure recovery remain future runtime layers.
