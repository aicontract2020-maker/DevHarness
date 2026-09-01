import assert from "node:assert/strict";
import test from "node:test";

import { createInitialGoalRun, replayGoalRun } from "../src/goal-run.mjs";

const sha = "a".repeat(40);
const now = "2026-08-31T16:00:00.000Z";

function create() {
  return createInitialGoalRun({
    id: "run-test-1",
    repository: {
      identity: "example/project",
      root_uri: "file:///workspace/project",
      base_ref: "main"
    },
    originalGoal: "Add a safe password reset flow",
    headSha: sha,
    now
  });
}

test("goal intake creates a deterministic received snapshot and creation event", () => {
  const first = create();
  const second = create();
  assert.deepEqual(first, second);
  assert.equal(first.run.state, "received");
  assert.equal(first.run.current_head_sha, sha);
  assert.equal(first.run.gates.scope.status, "pending");
  assert.equal(first.event.type, "run.created");
  assert.deepEqual(first.event.data.snapshot, first.run);
});

test("replay reconstructs the snapshot from contiguous events", () => {
  const { run, event } = create();
  assert.deepEqual(replayGoalRun([event]), run);
});

test("replay rejects a creation event whose run identity contradicts its snapshot", () => {
  const { event } = create();
  event.data.snapshot.id = "run-other";
  assert.throws(() => replayGoalRun([event]), /does not match/i);
});

test("replay applies valid state transitions and rejects contradictory source state", () => {
  const { event } = create();
  const transition = {
    schema_version: 1,
    event_id: "event-transition-2",
    run_id: "run-test-1",
    sequence: 2,
    at: "2026-08-31T16:00:01.000Z",
    type: "state.transitioned",
    actor: { id: "runtime", kind: "runtime", role: "orchestrator" },
    data: { from: "received", to: "discovering" }
  };
  assert.equal(replayGoalRun([event, transition]).state, "discovering");
  transition.data.from = "planning";
  assert.throws(() => replayGoalRun([event, transition]), /source state/i);
});
