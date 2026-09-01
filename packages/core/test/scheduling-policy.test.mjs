import assert from "node:assert/strict";
import test from "node:test";

import { createSchedule } from "../src/scheduling-policy.mjs";

test("scheduler parallelizes ready tasks only when exclusive resources do not conflict", () => {
  const result = createSchedule({
    max_parallelism: 3,
    integration_owner_task_id: "integrate",
    nodes: [
      { task_id: "frontend", depends_on: [], expected_duration_seconds: 20, workspace_id: "frontend", resources: [{ kind: "path", id: "frontend", mode: "exclusive" }] },
      { task_id: "backend", depends_on: [], expected_duration_seconds: 30, workspace_id: "backend", resources: [{ kind: "database", id: "app-db", mode: "exclusive" }] },
      { task_id: "db-tests", depends_on: [], expected_duration_seconds: 10, workspace_id: "db-tests", resources: [{ kind: "database", id: "app-db", mode: "exclusive" }] },
      { task_id: "integrate", depends_on: ["frontend", "backend", "db-tests"], expected_duration_seconds: 5, workspace_id: "integration", resources: [{ kind: "workspace", id: "integration", mode: "exclusive" }, { kind: "external", id: "git:integration-branch", mode: "exclusive" }] }
    ]
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.waves[0].task_ids, ["backend", "frontend"]);
  assert.deepEqual(result.waves[1].task_ids, ["db-tests"]);
  assert.deepEqual(result.waves[2].task_ids, ["integrate"]);
});

test("scheduler rejects cycles, missing dependencies, and absent integration ownership", () => {
  const result = createSchedule({
    max_parallelism: 2,
    integration_owner_task_id: "missing",
    nodes: [
      { task_id: "one", depends_on: ["two"], expected_duration_seconds: 1, workspace_id: "one", resources: [{ kind: "path", id: "one", mode: "exclusive" }] },
      { task_id: "two", depends_on: ["one", "ghost"], expected_duration_seconds: 1, workspace_id: "two", resources: [{ kind: "path", id: "two", mode: "exclusive" }] }
    ]
  });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((reason) => reason.code === "dependency_missing"));
  assert.ok(result.reasons.some((reason) => reason.code === "integration_owner_missing"));
});

test("scheduler treats nested paths and shared workspaces as conflicts", () => {
  const result = createSchedule({
    max_parallelism: 3,
    integration_owner_task_id: "integrate",
    nodes: [
      { task_id: "parent", depends_on: [], expected_duration_seconds: 30, workspace_id: "work-a", resources: [{ kind: "path", id: "src", mode: "exclusive" }] },
      { task_id: "child", depends_on: [], expected_duration_seconds: 20, workspace_id: "work-b", resources: [{ kind: "path", id: "src/auth", mode: "exclusive" }] },
      { task_id: "same-workspace", depends_on: [], expected_duration_seconds: 10, workspace_id: "work-a", resources: [{ kind: "path", id: "tests", mode: "exclusive" }] },
      { task_id: "integrate", depends_on: ["parent", "child", "same-workspace"], expected_duration_seconds: 5, workspace_id: "integration", resources: [{ kind: "workspace", id: "integration", mode: "exclusive" }, { kind: "external", id: "git:integration-branch", mode: "exclusive" }] }
    ]
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.waves[0].task_ids, ["parent"]);
});

test("scheduler rejects an integration task that is not a locked final barrier", () => {
  const result = createSchedule({
    max_parallelism: 2,
    integration_owner_task_id: "integrate",
    nodes: [
      { task_id: "write", depends_on: [], expected_duration_seconds: 10, workspace_id: "write", resources: [{ kind: "path", id: "src", mode: "exclusive" }] },
      { task_id: "integrate", depends_on: [], expected_duration_seconds: 5, workspace_id: "integration", resources: [{ kind: "workspace", id: "integration", mode: "exclusive" }] }
    ]
  });
  assert.ok(result.reasons.some((reason) => reason.code === "integration_barrier_incomplete"));
  assert.ok(result.reasons.some((reason) => reason.code === "integration_lock_missing"));
});
