import { createHash } from "node:crypto";

import { validateEventStream } from "./event-stream.mjs";
import { allowedTransitions, RUN_STATES } from "./state-machine.mjs";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const GIT_COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

function requireIdentifier(value, label) {
  if (!IDENTIFIER.test(value ?? "")) throw new Error(`${label} must be a valid identifier.`);
}

function requireTimestamp(value) {
  if (!Number.isFinite(Date.parse(value ?? ""))) throw new Error("Goal Run requires a valid timestamp.");
}

function eventId(runId, now) {
  return `event-${createHash("sha256").update(`${runId}\0${now}\0created`).digest("hex").slice(0, 24)}`;
}

export function createRunEvent({ runId, sequence, at, type, data = {}, actor = { id: "runtime", kind: "runtime", role: "orchestrator" } }) {
  requireIdentifier(runId, "Goal Run id");
  requireTimestamp(at);
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error("Run event sequence must be a positive integer.");
  const id = createHash("sha256").update(`${runId}\0${sequence}\0${at}\0${type}`).digest("hex").slice(0, 24);
  return { schema_version: 1, event_id: `event-${id}`, run_id: runId, sequence, at, type, actor, data };
}

export function createInitialGoalRun({
  id,
  repository,
  originalGoal,
  headSha,
  now = new Date().toISOString(),
  budgets = {}
}) {
  requireIdentifier(id, "Goal Run id");
  requireTimestamp(now);
  if (!repository?.identity || !repository?.root_uri || !repository?.base_ref) {
    throw new Error("Goal Run requires repository identity, root URI and base ref.");
  }
  if (!GIT_COMMIT.test(headSha ?? "")) throw new Error("Goal Run requires a committed Git revision.");
  const goal = String(originalGoal ?? "").trim();
  if (!goal) throw new Error("Goal Run requires a non-empty goal.");

  const run = {
    schema_version: 1,
    id,
    repository: {
      identity: repository.identity,
      root_uri: repository.root_uri,
      base_ref: repository.base_ref
    },
    goal: { original: goal, scope_version: 1 },
    state: "received",
    gates: { scope: { status: "pending" }, delivery: { status: "pending" } },
    budgets: {
      max_agents: budgets.max_agents ?? 1,
      max_repair_attempts: budgets.max_repair_attempts ?? 3,
      repair_attempts_used: 0,
      ...(budgets.wall_time_seconds ? { wall_time_seconds: budgets.wall_time_seconds } : {}),
      ...(budgets.cost_limit ? { cost_limit: budgets.cost_limit } : {})
    },
    current_head_sha: headSha,
    timestamps: { created_at: now, updated_at: now }
  };

  const event = {
    schema_version: 1,
    event_id: eventId(id, now),
    run_id: id,
    sequence: 1,
    at: now,
    type: "run.created",
    actor: { id: "runtime", kind: "runtime", role: "orchestrator" },
    data: { snapshot: structuredClone(run) }
  };

  return { run, event };
}

export function replayGoalRun(events) {
  const validation = validateEventStream(events);
  if (!validation.valid) throw new Error(`Invalid Goal Run event stream: ${validation.errors.join("; ")}`);
  if (events.length === 0) throw new Error("Cannot replay an empty Goal Run event stream.");

  const first = events[0];
  const initial = first.data?.snapshot;
  if (!initial || initial.id !== first.run_id) {
    throw new Error("Creation event run id does not match its snapshot.");
  }
  if (initial.state !== "received") throw new Error("Creation snapshot must begin in received state.");
  let run = structuredClone(initial);

  for (const event of events.slice(1)) {
    if (event.type === "state.transitioned") {
      const { from, to } = event.data ?? {};
      if (from !== run.state) throw new Error(`Transition source state ${from} does not match ${run.state}.`);
      if (!RUN_STATES.includes(to) || !allowedTransitions(from).includes(to)) {
        throw new Error(`Recorded transition ${from} -> ${to} is invalid.`);
      }
      run.state = to;
    } else if (event.type === "gate.decided") {
      const { gate, decision } = event.data ?? {};
      if (!Object.hasOwn(run.gates, gate) || !decision) throw new Error("Gate event is incomplete.");
      run.gates[gate] = structuredClone(decision);
    } else if (event.type === "head.advanced") {
      const { from, to } = event.data ?? {};
      if (from !== run.current_head_sha) {
        throw new Error(`Head advance source ${from} does not match ${run.current_head_sha}.`);
      }
      if (!GIT_COMMIT.test(to ?? "")) throw new Error("Head advance requires a full Git commit SHA.");
      run.current_head_sha = to;
    } else if (event.type === "run.blocked") {
      run.state = "blocked";
      if (event.data?.blocker) run.blocker = structuredClone(event.data.blocker);
    } else if (event.type === "run.cancelled") {
      run.state = "cancelled";
    } else if (event.type === "run.completed") {
      run.state = "completed";
      run.timestamps.completed_at = event.at;
    }
    run.timestamps.updated_at = event.at;
  }

  return run;
}
