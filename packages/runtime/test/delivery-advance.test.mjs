import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import { createReviewScorecard } from "../../core/src/review-scorecard.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { createDeliveryAdvanceCheckpoint, deliveryAdvanceSupported } from "../src/delivery-advance.mjs";

const sha = "a".repeat(40);

function verifyingRun() {
  return {
    schema_version: 1,
    id: "run-delivery-1",
    repository: { identity: "example/project", root_uri: "file:///tmp/example", base_ref: "main" },
    goal: { original: "Close the delivery loop for a docs-only dogfood", scope_version: 1 },
    state: "verifying",
    gates: {
      scope: {
        status: "approved",
        decided_at: "2026-09-16T18:00:00.000Z",
        decided_by: { id: "developer", kind: "human", role: "developer-approver" },
        artifact_hash: "c".repeat(64)
      },
      delivery: { status: "pending" }
    },
    budgets: { max_agents: 1, max_repair_attempts: 3, repair_attempts_used: 0 },
    current_head_sha: sha,
    timestamps: { created_at: "2026-09-16T17:00:00.000Z", updated_at: "2026-09-16T18:00:00.000Z" }
  };
}

test("delivery advance builds a ready Delivery Brief and awaits Gate 2", async () => {
  const run = verifyingRun();
  const readiness = {
    schema_version: 1,
    kind: "readiness-summary",
    run_id: run.id,
    head_sha: sha,
    generated_at: "2026-09-16T18:00:00.000Z",
    delivery_mode: "docs-only",
    path: "/tmp/summary.md",
    content_sha256: "d".repeat(64)
  };
  const readinessArtifact = {
    id: "artifact-readiness-summary",
    kind: "readiness-summary",
    value: readiness,
    sha256: hashContract(readiness)
  };
  const scorecard = createReviewScorecard({
    run,
    scopeHash: createHash("sha256").update(JSON.stringify({ goal: run.goal.original, scope_version: run.goal.scope_version })).digest("hex"),
    harnessVersion: "unbound",
    title: "Docs-only verification",
    reviewVerdicts: [],
    reviewChecks: [],
    findings: [],
    unknowns: [],
    sourceArtifactCount: 1,
    generatedAt: "2026-09-16T18:00:00.000Z",
    dataSource: "runtime",
    profile: "docs-only"
  });
  assert.equal(scorecard.verdict, "ready");
  assert.equal(deliveryAdvanceSupported(run, scorecard), true);

  const checkpoint = await createDeliveryAdvanceCheckpoint({
    run,
    scorecard,
    priorArtifacts: [readinessArtifact],
    nextSequence: 10,
    generatedAt: "2026-09-16T18:05:00.000Z"
  });
  assert.equal(checkpoint.run.state, "awaiting_delivery_approval");
  assert.equal(checkpoint.packet.kind, "delivery-brief");
  assert.equal(checkpoint.packet.verdict, "ready");
  assert.ok(checkpoint.packet.actions.some((action) => action.kind === "approve" && action.recommended));
  assert.ok(checkpoint.artifacts.some((entry) => entry.id === "artifact-delivery-brief"));
  assert.equal(checkpoint.delivery.mode, "docs-only");
  assert.ok(checkpoint.events.some((event) => event.type === "state.transitioned" && event.data.to === "awaiting_delivery_approval"));
});

test("delivery advance refuses when the tip scorecard is not ready", async () => {
  const run = verifyingRun();
  const scorecard = createReviewScorecard({
    run,
    scopeHash: "b".repeat(64),
    harnessVersion: "unbound",
    title: "blocked",
    reviewVerdicts: [],
    reviewChecks: [],
    findings: [],
    unknowns: [{ id: "verify-pending", title: "pending", summary: "pending" }],
    generatedAt: "2026-09-16T18:00:00.000Z",
    dataSource: "runtime",
    profile: "docs-only"
  });
  assert.equal(deliveryAdvanceSupported(run, scorecard), false);
  await assert.rejects(
    () => createDeliveryAdvanceCheckpoint({ run, scorecard, priorArtifacts: [], nextSequence: 10 }),
    /ready tip scorecard/
  );
});
