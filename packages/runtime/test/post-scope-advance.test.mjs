import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { createInitialGoalRun, createRunEvent } from "../../core/src/goal-run.mjs";
import { createReviewScorecard } from "../../core/src/review-scorecard.mjs";
import { discoverRepository } from "../../project/src/discover.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { appendGoalRunCheckpoint, createStoredGoalRun, loadGoalRun, loadRunSourceArtifact, runStoragePaths } from "../src/goal-run-store.mjs";
import { createPostScopeAdvanceCheckpoint, postScopeAdvanceSupported } from "../src/post-scope-advance.mjs";

async function fixtureRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-post-scope-repo-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "post-scope-fixture", scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  return root;
}

function minimalOnboarding(identity, head) {
  return {
    schema_version: 1,
    id: "onboarding-post-scope-1",
    generated_at: "2026-09-15T12:00:00.000Z",
    repository_identity: identity,
    commit_sha: head,
    workspace: { kind: "repository-root", root_uri: `file:///tmp/${identity}` },
    mode: "read-only-plan",
    verdict: "needs-evidence",
    claims: [],
    coverage: [],
    capability_requests: [{
      id: "service-runtime",
      capability: "service-runtime",
      operation: "run-isolated-quality-command",
      target: "local-verification",
      scope: ["execute-declared-quality-command"],
      risk: "low",
      reversibility: "fully-reversible",
      reason: "Verify the docs-only readiness summary with a declared quality command."
    }],
    blockers: [],
    limitations: [],
    next_action: { id: "request-capabilities", summary: "Authorize proof capabilities." }
  };
}

test("post-scope advance requires scope approval and writes an external readiness summary", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-post-scope-data-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "devharness-post-scope-artifacts-"));
  const root = await fixtureRepo();
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true }),
    rm(artifactDir, { recursive: true, force: true })
  ]));

  const snapshot = await discoverRepository(root);
  const identity = snapshot.repository.identity;
  const head = snapshot.repository.git.head_sha;
  const created = createInitialGoalRun({
    id: "run-post-scope-1",
    repository: {
      identity,
      root_uri: snapshot.repository.root_uri,
      base_ref: snapshot.repository.git.default_branch ?? "main"
    },
    originalGoal: "Summarize repository readiness for a docs-only Alignment pass",
    headSha: head,
    now: "2026-09-15T12:00:00.000Z"
  });
  await createStoredGoalRun({
    dataRoot,
    run: created.run,
    event: created.event,
    scorecard: createReviewScorecard({
      run: created.run,
      scopeHash: "a".repeat(64),
      harnessVersion: "unbound",
      title: "fixture",
      sourceArtifactCount: 0,
      generatedAt: "2026-09-15T12:00:00.000Z",
      dataSource: "runtime"
    })
  });

  const plan = minimalOnboarding(identity, head);
  const planArtifact = { id: "artifact-onboarding-plan", kind: "onboarding-plan", value: plan, sha256: hashContract(plan) };
  const goalValue = { run_id: created.run.id, original_goal: created.run.goal.original, scope_version: 1 };
  const goalArtifact = { id: "artifact-goal-input", kind: "goal-input", value: goalValue, sha256: hashContract(goalValue) };
  const clarifyingRun = structuredClone(created.run);
  clarifyingRun.state = "clarifying";
  clarifyingRun.gates.scope = {
    status: "approved",
    decided_at: "2026-09-15T12:05:00.000Z",
    decided_by: { id: "developer", kind: "human", role: "developer-approver" },
    artifact_hash: "b".repeat(64)
  };
  clarifyingRun.timestamps.updated_at = "2026-09-15T12:05:00.000Z";
  const packetBody = {
    schema_version: 1,
    run_id: created.run.id,
    kind: "progress-pulse",
    generated_at: "2026-09-15T12:05:00.000Z",
    head_sha: head,
    title: "Scope approved fixture",
    verdict: "informational",
    summary: "Scope approved for post-scope fixture.",
    attention: { required: false, count: 0, reasons: [] },
    sections: [{
      id: "scope",
      title: "Scope",
      items: [{
        id: "scope-approved",
        text: "Scope gate approved.",
        confidence: "confirmed",
        severity: "info",
        source_refs: ["artifact-onboarding-plan"]
      }]
    }],
    decisions: [],
    actions: [{ id: "inspect-scope", label: "Inspect scope", kind: "inspect", recommended: true }],
    source_artifacts: [
      { id: planArtifact.id, kind: planArtifact.kind, sha256: planArtifact.sha256, uri: `artifacts/${planArtifact.id}.json` },
      { id: goalArtifact.id, kind: goalArtifact.kind, sha256: goalArtifact.sha256, uri: `artifacts/${goalArtifact.id}.json` }
    ],
    traceability: [{ item_id: "scope-approved", source_refs: ["artifact-onboarding-plan"] }],
    compression: { source_artifact_count: 2, surfaced_item_count: 1, omitted_item_count: 0 }
  };
  const packet = { ...packetBody, id: `packet-${hashContract(packetBody).slice(0, 32)}` };
  await appendGoalRunCheckpoint({
    dataRoot,
    repositoryIdentity: identity,
    runId: created.run.id,
    events: [
      createRunEvent({ runId: created.run.id, sequence: 2, at: "2026-09-15T12:01:00.000Z", type: "state.transitioned", data: { from: "received", to: "discovering" } }),
      createRunEvent({ runId: created.run.id, sequence: 3, at: "2026-09-15T12:02:00.000Z", type: "state.transitioned", data: { from: "discovering", to: "clarifying" } }),
      createRunEvent({
        runId: created.run.id,
        sequence: 4,
        at: "2026-09-15T12:05:00.000Z",
        type: "gate.decided",
        data: {
          gate: "scope",
          decision: clarifyingRun.gates.scope,
          receipt_id: "receipt-scope-1",
          request_id: "request-scope-1"
        }
      })
    ],
    nextRun: clarifyingRun,
    scorecard: createReviewScorecard({
      run: clarifyingRun,
      scopeHash: "a".repeat(64),
      harnessVersion: "unbound",
      title: "scope approved",
      sourceArtifactCount: 2,
      generatedAt: "2026-09-15T12:05:00.000Z",
      dataSource: "runtime"
    }),
    packet,
    artifacts: [planArtifact, goalArtifact]
  });

  const loaded = await loadGoalRun(dataRoot, identity, created.run.id);
  assert.equal(postScopeAdvanceSupported(loaded), true);
  const paths = runStoragePaths(dataRoot, identity, created.run.id);
  const pointer = JSON.parse(await readFile(paths.current, "utf8"));
  const checkpoint = await createPostScopeAdvanceCheckpoint({
    run: loaded,
    snapshot,
    dataRoot,
    priorArtifacts: [planArtifact, goalArtifact],
    artifactDir,
    verifyCommandId: "docs-readiness-summary",
    nextSequence: pointer.sequence + 1,
    generatedAt: "2026-09-15T12:10:00.000Z"
  });

  assert.equal(checkpoint.run.state, "verifying");
  assert.equal(checkpoint.delivery.verify_command_id, "docs-readiness-summary");
  const summary = await readFile(checkpoint.delivery.summary_path, "utf8");
  assert.match(summary, /Readiness summary/);
  assert.match(summary, /docs-only/);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");

  await appendGoalRunCheckpoint({
    dataRoot,
    repositoryIdentity: identity,
    runId: created.run.id,
    events: checkpoint.events,
    nextRun: checkpoint.run,
    scorecard: createReviewScorecard({
      run: checkpoint.run,
      scopeHash: "a".repeat(64),
      harnessVersion: "unbound",
      title: "post-scope",
      sourceArtifactCount: checkpoint.artifacts.length,
      generatedAt: "2026-09-15T12:10:00.000Z",
      dataSource: "runtime"
    }),
    packet: checkpoint.packet,
    artifacts: checkpoint.artifacts
  });

  const advanced = await loadGoalRun(dataRoot, identity, created.run.id);
  assert.equal(advanced.state, "verifying");
  assert.equal(advanced.gates.scope.status, "approved");
  const readiness = await loadRunSourceArtifact(dataRoot, identity, created.run.id, "artifact-readiness-summary");
  assert.equal(readiness.value.consumer_mutation, false);
  const onboarding = await loadRunSourceArtifact(dataRoot, identity, created.run.id, "artifact-onboarding-plan");
  assert.equal(onboarding.value.id, plan.id);
});

test("post-scope advance rejects missing scope approval", async () => {
  const run = createInitialGoalRun({
    id: "run-post-scope-denied",
    repository: { identity: "denied", root_uri: "file:///tmp/denied", base_ref: "main" },
    originalGoal: "x",
    headSha: "a".repeat(40),
    now: "2026-09-15T12:00:00.000Z"
  }).run;
  run.state = "clarifying";
  assert.equal(postScopeAdvanceSupported(run), false);
  await assert.rejects(
    () => createPostScopeAdvanceCheckpoint({
      run,
      snapshot: {
        repository: {
          identity: "denied",
          root_uri: "file:///tmp/denied",
          git: { head_sha: "a".repeat(40), dirty: false }
        }
      },
      dataRoot: "/tmp",
      priorArtifacts: [{ id: "artifact-onboarding-plan", kind: "onboarding-plan", value: {}, sha256: "c".repeat(64) }],
      nextSequence: 2
    }),
    /gates\.scope\.status=approved/
  );
});
