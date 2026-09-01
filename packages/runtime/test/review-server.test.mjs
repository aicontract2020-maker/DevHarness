import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createInitialGoalRun, createRunEvent } from "../../core/src/goal-run.mjs";
import { createReviewScorecard } from "../../core/src/review-scorecard.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { appendGoalRunCheckpoint, createStoredGoalRun } from "../src/goal-run-store.mjs";
import { createReviewApiResponder } from "../src/review-server.mjs";

const token = "c".repeat(64);
const allowedOrigin = "http://localhost:3000";

async function setup(t, { interaction = false, capabilities = false, declarationReview = null, verificationReview = null } = {}) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-review-api-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const { run, event } = createInitialGoalRun({
    id: "run-api-1",
    repository: { identity: "example/project", root_uri: "file:///workspace/project", base_ref: "main" },
    originalGoal: "API review goal",
    headSha: "a".repeat(40),
    now: "2026-08-31T16:00:00.000Z"
  });
  const scorecard = createReviewScorecard({
    run, scopeHash: "b".repeat(64), harnessVersion: "unbound", title: "API review goal",
    reviewVerdicts: [], reviewChecks: [], findings: [], generatedAt: "2026-08-31T16:00:00.000Z"
  });
  await createStoredGoalRun({ dataRoot, run, event, scorecard });
  if (interaction) {
    const at = "2026-08-31T17:00:00.000Z";
    const events = [
      createRunEvent({ runId: run.id, sequence: 2, at, type: "state.transitioned", data: { from: "received", to: "discovering" } }),
      createRunEvent({ runId: run.id, sequence: 3, at, type: "state.transitioned", data: { from: "discovering", to: "clarifying" } })
    ];
    const nextRun = structuredClone(run);
    nextRun.state = "clarifying";
    nextRun.timestamps.updated_at = at;
    const nextScorecard = createReviewScorecard({ run: nextRun, scopeHash: "b".repeat(64), harnessVersion: "unbound", title: "API review goal", reviewVerdicts: [], reviewChecks: [], findings: [], generatedAt: at });
    const source = capabilities ? {
      schema_version: 1,
      id: "onboarding-api-1",
      generated_at: at,
      repository_identity: run.repository.identity,
      commit_sha: run.current_head_sha,
      workspace: { dirty: false, changed_file_count: 0 },
      mode: "read-only-plan",
      verdict: "needs-evidence",
      claims: [{ id: "claim-repository", domain: "repository", status: "code-confirmed", summary: "Repository is committed.", evidence_refs: ["git"] }],
      coverage: [{ domain: "repository", status: "code-confirmed", claim_ids: ["claim-repository"] }],
      capability_requests: [{ id: "browser-runtime", capability: "browser-runtime", operation: "prove-capability", target: "local-browser", scope: ["local-browser"], reason: "Exercise the real UI.", risk: "medium", authority: "explicit", decision: "pending" }],
      blockers: [{ id: "runtime-unproved", summary: "Runtime behavior is unproved." }],
      limitations: ["No consumer command has run."],
      next_action: { id: "approve-capability-plan", label: "Review capabilities", recommended: true }
    } : { run_id: run.id, fact: "runtime unproved" };
    const sourceHash = hashContract(source);
    const sourceId = capabilities ? "artifact-onboarding-plan" : "artifact-api-source";
    const sourceKind = capabilities ? "onboarding-plan" : "test-source";
    const packet = {
      schema_version: 1, id: "packet-api-1", run_id: run.id, kind: "alignment-brief", generated_at: at, head_sha: run.current_head_sha,
      title: "Alignment", verdict: "action-required", summary: "Runtime proof is missing.",
      attention: { required: true, count: 1, reasons: ["verification-blocker"] },
      sections: [{ id: "gaps", title: "Gaps", items: [{ id: "gap-runtime", text: "Runtime unproved.", confidence: "verify", severity: "blocking", source_refs: [sourceId] }] }],
      decisions: [], actions: [{ id: "inspect", label: "Inspect", kind: "inspect", recommended: true }],
      source_artifacts: [{ id: sourceId, kind: sourceKind, sha256: sourceHash }],
      traceability: [{ item_id: "gap-runtime", source_refs: [sourceId] }],
      compression: { source_artifact_count: 1, surfaced_item_count: 1, omitted_item_count: 0 }
    };
    await appendGoalRunCheckpoint({ dataRoot, repositoryIdentity: run.repository.identity, runId: run.id, events, nextRun, scorecard: nextScorecard, packet, artifacts: [{ id: sourceId, kind: sourceKind, value: source, sha256: sourceHash }] });
  }
  return createReviewApiResponder({
    dataRoot,
    repositoryIdentity: run.repository.identity,
    declarationReview,
    token,
    allowedOrigin,
    now: "2026-08-31T16:00:00.000Z",
    ...(verificationReview ? { verificationReviewLoader: async () => verificationReview } : {})
  });
}

const request = (url, overrides = {}) => ({
  method: "GET",
  url,
  headers: { origin: allowedOrigin, "x-devharness-review-token": token },
  ...overrides
});

test("authenticated exact-origin requests list runs and load a scorecard", async (t) => {
  const respond = await setup(t);
  const indexResponse = await respond(request("/api/review/runs"));
  assert.equal(indexResponse.status, 200);
  assert.equal(indexResponse.headers["cache-control"], "no-store");
  assert.equal(JSON.parse(indexResponse.body).runs[0].run_id, "run-api-1");

  const scoreResponse = await respond(request("/api/review/runs/run-api-1/scorecard"));
  assert.equal(scoreResponse.status, 200);
  assert.equal(JSON.parse(scoreResponse.body).run_id, "run-api-1");
});

test("authenticated review exposes a fixed read-only project declaration assessment", async (t) => {
  const declarationReview = { schema_version: 1, id: "declaration-review-api", verdict: "blocked", structural_coverage: 55 };
  const respond = await setup(t, { declarationReview });
  const result = await respond(request("/api/review/project-declaration"));
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), declarationReview);
  assert.equal((await respond(request("/api/review/project-declaration", { method: "POST" }))).status, 405);
});

test("authenticated review exposes fixed read-only verification summaries", async (t) => {
  const verificationReview = {
    schema_version: 1,
    repository_identity: "example/project",
    current_head_sha: "a".repeat(40),
    counts: { total: 1, pass: 0, fail: 1, blocked: 0, current: 1, stale: 0 },
    latest: { id: "verify-api-1", outcome: { status: "fail", reason: "command-failed", summary: "Failed." } },
    verifications: []
  };
  const respond = await setup(t, { verificationReview });
  const result = await respond(request("/api/review/verifications"));
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), verificationReview);
  assert.equal((await respond(request("/api/review/verifications", { method: "POST" }))).status, 405);
});

test("authenticated review reads the current interaction packet", async (t) => {
  const respond = await setup(t, { interaction: true });
  const index = JSON.parse((await respond(request("/api/review/runs"))).body);
  assert.equal(index.runs[0].interaction_url, "/api/review/runs/run-api-1/interaction");
  const interaction = await respond(request(index.runs[0].interaction_url));
  assert.equal(interaction.status, 200);
  assert.equal(JSON.parse(interaction.body).kind, "alignment-brief");
});

test("authenticated review computes bounded capability status without mutations", async (t) => {
  const respond = await setup(t, { interaction: true, capabilities: true });
  const index = JSON.parse((await respond(request("/api/review/runs"))).body);
  assert.equal(index.runs[0].capabilities_url, "/api/review/runs/run-api-1/capabilities");
  const result = await respond(request(index.runs[0].capabilities_url));
  assert.equal(result.status, 200);
  const view = JSON.parse(result.body);
  assert.equal(view.counts.total, 1);
  assert.equal(view.capabilities[0].request.id, "browser-runtime");
  assert.equal(view.capabilities[0].status, "unrequested");
});

test("wrong origin and missing token are denied", async (t) => {
  const respond = await setup(t);
  assert.equal((await respond(request("/api/review/runs", { headers: { origin: "https://evil.example", "x-devharness-review-token": token } }))).status, 403);
  assert.equal((await respond(request("/api/review/runs", { headers: { origin: allowedOrigin } }))).status, 401);
});

test("mutations, traversal, and unknown runs are denied", async (t) => {
  const respond = await setup(t);
  assert.equal((await respond(request("/api/review/runs", { method: "POST" }))).status, 405);
  assert.equal((await respond(request("/api/review/runs/%2e%2e/scorecard"))).status, 400);
  assert.equal((await respond(request("/api/review/runs/run-missing/scorecard"))).status, 404);
  assert.equal((await respond(request("/api/review/runs/run-api-1/interaction"))).status, 404);
});

test("preflight is restricted to the exact configured origin", async (t) => {
  const respond = await setup(t);
  assert.equal((await respond({ method: "OPTIONS", url: "/api/review/runs", headers: { origin: allowedOrigin, "access-control-request-method": "GET" } })).status, 204);
  assert.equal((await respond({ method: "OPTIONS", url: "/api/review/runs", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } })).status, 403);
});
