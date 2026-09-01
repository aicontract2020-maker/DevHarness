import assert from "node:assert/strict";
import test from "node:test";

import { createVerificationReview } from "../src/verification-review.mjs";

function receipt(overrides = {}) {
  return {
    schema_version: 1,
    id: "verify-current",
    goal_run_id: "run-review-1",
    repository_identity: "example/project",
    commit_sha: "a".repeat(40),
    command: { id: "web-playwright", kind: "verify" },
    started_at: "2026-08-31T20:00:00.000Z",
    completed_at: "2026-08-31T20:01:00.000Z",
    duration_ms: 60000,
    outcome: { status: "pass", reason: "passed", timed_out: false, summary: "Passed." },
    services: [{ readiness: { status: "pass", checks: [{ status: "pass" }, { status: "pass" }] } }],
    workspace: { dirty_before: false, dirty_after: false },
    artifacts: [{ type: "stdout" }, { type: "stderr" }],
    teardown: { status: "pass" },
    ...overrides
  };
}

test("verification review is deterministic, bounded and honest about proof level", async () => {
  const receipts = [
    receipt(),
    receipt({
      id: "verify-stale",
      goal_run_id: "run-old",
      commit_sha: "b".repeat(40),
      completed_at: "2026-08-31T19:00:00.000Z",
      outcome: { status: "fail", reason: "service-exited", timed_out: false, summary: "Frontend exited." },
      services: [{ readiness: { status: "pass", checks: [{ status: "pass" }, { status: "fail" }] } }],
      workspace: { dirty_before: false, dirty_after: true },
      teardown: { status: "fail" }
    })
  ];
  const review = await createVerificationReview({
    repositoryIdentity: "example/project",
    currentHeadSha: "a".repeat(40),
    receipts,
    evidenceManifests: [{
      repository_identity: "example/project",
      commit_sha: "a".repeat(40),
      run_id: "run-review-1",
      receipt: { id: "verify-current" },
      outcome: { status: "pass" },
      evidence_records: [{ type: "test-result" }]
    }]
  });

  assert.equal(review.schema_version, 1);
  assert.deepEqual(review.counts, { total: 2, pass: 1, fail: 1, blocked: 0, current: 1, stale: 1 });
  assert.equal(review.latest.id, "verify-current");
  assert.equal(review.latest.goal_run_id, "run-review-1");
  assert.equal(review.latest.achieved_evidence_level, "E2");
  assert.deepEqual(review.latest.readiness, { status: "pass", passed: 2, total: 2 });
  assert.equal(review.verifications[1].achieved_evidence_level, "E0");
  assert.equal("environment" in review.latest, false);
  assert.equal("artifacts" in review.latest, false);

  const mismatchedRun = await createVerificationReview({
    repositoryIdentity: "example/project",
    currentHeadSha: "a".repeat(40),
    receipts: [receipt()],
    evidenceManifests: [{
      repository_identity: "example/project",
      commit_sha: "a".repeat(40),
      run_id: "run-other-goal",
      receipt: { id: "verify-current" },
      outcome: { status: "pass" },
      evidence_records: [{ type: "test-result" }]
    }]
  });
  assert.equal(mismatchedRun.latest.achieved_evidence_level, "E0");
});

test("verification review rejects cross-repository receipts and caps output", async () => {
  const receipts = Array.from({ length: 25 }, (_, index) => receipt({
    id: `verify-${String(index).padStart(2, "0")}`,
    completed_at: `2026-08-31T20:${String(index).padStart(2, "0")}:00.000Z`
  }));
  receipts.push(receipt({ id: "verify-cross-repo", repository_identity: "other/project" }));
  await assert.rejects(createVerificationReview({
    repositoryIdentity: "example/project",
    currentHeadSha: "a".repeat(40),
    receipts
  }), /another repository/i);

  const review = await createVerificationReview({
    repositoryIdentity: "example/project",
    currentHeadSha: "a".repeat(40),
    receipts: receipts.slice(0, 25)
  });
  assert.equal(review.counts.total, 25);
  assert.equal(review.verifications.length, 20);
  assert.equal(review.verifications[0].id, "verify-24");
});
