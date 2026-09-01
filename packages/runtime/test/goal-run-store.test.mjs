import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createInitialGoalRun, createRunEvent } from "../../core/src/goal-run.mjs";
import { createReviewScorecard } from "../../core/src/review-scorecard.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import {
  createStoredGoalRun,
  appendGoalRunCheckpoint,
  listGoalRunReviews,
  loadGoalRun,
  loadRunInteraction,
  loadRunScorecard,
  runStoragePaths
} from "../src/goal-run-store.mjs";

const sha = "a".repeat(40);
const now = "2026-08-31T16:00:00.000Z";

function fixture(id = "run-store-1") {
  const { run, event } = createInitialGoalRun({
    id,
    repository: { identity: "example/project", root_uri: "file:///workspace/project", base_ref: "main" },
    originalGoal: `Goal ${id}`,
    headSha: sha,
    now
  });
  const scorecard = createReviewScorecard({
    run,
    scopeHash: "b".repeat(64),
    harnessVersion: "unbound",
    title: `Goal received: ${id}`,
    reviewVerdicts: [],
    reviewChecks: [],
    findings: [],
    unknowns: [{ id: "acceptance-missing", title: "Acceptance criteria not defined", summary: "Goal intake has not defined acceptance criteria." }],
    generatedAt: now
  });
  return { run, event, scorecard };
}

test("run store creates private external event, snapshot, and scorecard files", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-run-store-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const value = fixture();
  const stored = await createStoredGoalRun({ dataRoot, ...value });

  assert.deepEqual(await loadGoalRun(dataRoot, value.run.repository.identity, value.run.id), value.run);
  assert.deepEqual(await loadRunScorecard(dataRoot, value.run.repository.identity, value.run.id), value.scorecard);
  assert.equal((await stat(stored.paths.runRoot)).mode & 0o777, 0o700);
  assert.equal((await stat(stored.paths.snapshot)).mode & 0o777, 0o600);
  assert.equal((await stat(stored.paths.scorecard)).mode & 0o777, 0o600);
});

test("duplicate creation never overwrites an existing run", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-run-duplicate-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const value = fixture();
  await createStoredGoalRun({ dataRoot, ...value });
  await assert.rejects(createStoredGoalRun({ dataRoot, ...value }), /already exists/i);
  assert.deepEqual(await loadGoalRun(dataRoot, value.run.repository.identity, value.run.id), value.run);
});

test("event-backed loading rejects a contradictory cached snapshot", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-run-tamper-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const value = fixture();
  const stored = await createStoredGoalRun({ dataRoot, ...value });
  const snapshot = JSON.parse(await readFile(stored.paths.snapshot, "utf8"));
  snapshot.state = "completed";
  await writeFile(stored.paths.snapshot, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  await assert.rejects(loadGoalRun(dataRoot, value.run.repository.identity, value.run.id), /contradicts/i);
});

test("listing omits malformed runs, symbolic links, and mismatched scorecards", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-run-list-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const first = fixture("run-list-1");
  const second = fixture("run-list-2");
  await createStoredGoalRun({ dataRoot, ...first });
  const secondStored = await createStoredGoalRun({ dataRoot, ...second });
  const wrong = { ...second.scorecard, run_id: "run-list-1" };
  await writeFile(secondStored.paths.scorecard, `${JSON.stringify(wrong)}\n`, { mode: 0o600 });

  const projectRuns = path.dirname(secondStored.paths.runRoot);
  await symlink(secondStored.paths.runRoot, path.join(projectRuns, "run-linked"));
  assert.equal((await lstat(path.join(projectRuns, "run-linked"))).isSymbolicLink(), true);

  const index = await listGoalRunReviews(dataRoot, first.run.repository.identity, { now });
  assert.equal(index.runs.length, 1);
  assert.equal(index.runs[0].run_id, "run-list-1");
});

test("run paths reject traversal identifiers", () => {
  assert.throws(() => runStoragePaths("/tmp/data", "example/project", "../escape"), /invalid run id/i);
});

function checkpointFixture(value) {
  const at = "2026-08-31T17:00:00.000Z";
  const events = [
    createRunEvent({ runId: value.run.id, sequence: 2, at, type: "state.transitioned", data: { from: "received", to: "discovering" } }),
    createRunEvent({ runId: value.run.id, sequence: 3, at, type: "state.transitioned", data: { from: "discovering", to: "clarifying" } })
  ];
  const nextRun = structuredClone(value.run);
  nextRun.state = "clarifying";
  nextRun.timestamps.updated_at = at;
  const scorecard = createReviewScorecard({
    run: nextRun, scopeHash: "d".repeat(64), harnessVersion: "unbound", title: "Understanding checkpoint",
    reviewVerdicts: [], reviewChecks: [], findings: [],
    unknowns: [{ id: "acceptance-missing", title: "Acceptance missing", summary: "Acceptance criteria are not defined." }],
    generatedAt: at
  });
  const sourceValue = { repository: "example/project", head_sha: sha };
  const sourceHash = hashContract(sourceValue);
  const packet = {
    schema_version: 1, id: "packet-understanding", run_id: value.run.id, kind: "alignment-brief", generated_at: at,
    head_sha: sha, title: "Understanding", verdict: "action-required", summary: "Runtime proof is missing.",
    attention: { required: true, count: 1, reasons: ["verification-blocker"] },
    sections: [{ id: "gaps", title: "Gaps", items: [{ id: "gap-runtime", text: "Runtime is unproved.", confidence: "verify", severity: "blocking", source_refs: ["artifact-source"] }] }],
    decisions: [], actions: [{ id: "inspect", label: "Inspect", kind: "inspect", recommended: true }],
    source_artifacts: [{ id: "artifact-source", kind: "test-source", sha256: sourceHash, uri: "artifacts/artifact-source.json" }],
    traceability: [{ item_id: "gap-runtime", source_refs: ["artifact-source"] }],
    compression: { source_artifact_count: 1, surfaced_item_count: 1, omitted_item_count: 0 }
  };
  return { events, nextRun, scorecard, packet, artifacts: [{ id: "artifact-source", kind: "test-source", value: sourceValue, sha256: sourceHash }] };
}

test("append publishes one complete event-backed checkpoint and current interaction", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-run-append-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const value = fixture("run-append-1");
  await createStoredGoalRun({ dataRoot, ...value });
  const checkpoint = checkpointFixture(value);

  const stored = await appendGoalRunCheckpoint({ dataRoot, repositoryIdentity: value.run.repository.identity, runId: value.run.id, ...checkpoint });
  assert.equal((await loadGoalRun(dataRoot, value.run.repository.identity, value.run.id)).state, "clarifying");
  assert.deepEqual(await loadRunScorecard(dataRoot, value.run.repository.identity, value.run.id), checkpoint.scorecard);
  assert.deepEqual(await loadRunInteraction(dataRoot, value.run.repository.identity, value.run.id), checkpoint.packet);
  assert.equal((await stat(stored.paths.checkpoint)).mode & 0o777, 0o700);
});

test("an unreferenced orphan checkpoint is ignored", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-run-orphan-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const value = fixture("run-orphan-1");
  const stored = await createStoredGoalRun({ dataRoot, ...value });
  await mkdir(path.join(stored.paths.checkpoints, "00000009"), { recursive: true });
  assert.equal((await loadGoalRun(dataRoot, value.run.repository.identity, value.run.id)).state, "received");
  assert.equal(await loadRunInteraction(dataRoot, value.run.repository.identity, value.run.id), null);
});

test("sequence-one runs without a current pointer remain readable", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-run-legacy-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const value = fixture("run-legacy-1");
  const stored = await createStoredGoalRun({ dataRoot, ...value });
  await rm(stored.paths.current);
  assert.deepEqual(await loadGoalRun(dataRoot, value.run.repository.identity, value.run.id), value.run);
  assert.equal(await loadRunInteraction(dataRoot, value.run.repository.identity, value.run.id), null);
});
