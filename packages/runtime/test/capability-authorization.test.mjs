import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { approvalRequestHash } from "../../core/src/approval-policy.mjs";
import { createInitialGoalRun, createRunEvent } from "../../core/src/goal-run.mjs";
import { createReviewScorecard } from "../../core/src/review-scorecard.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import {
  loadCapabilityAuthorizationView,
  requestCapabilityAuthorization,
  resolveCapabilityApprovalContext
} from "../src/capability-authorization.mjs";
import { appendGoalRunCheckpoint, createStoredGoalRun, loadRunSourceArtifact } from "../src/goal-run-store.mjs";
import { formatForegroundApproval } from "../src/supervisor-approval.mjs";
import { attestApprovalReceipt, initializeSupervisorIdentity, writeApprovalReceipt } from "../src/supervisor-store.mjs";

const sha = "a".repeat(40);
const at = "2026-08-31T17:00:00.000Z";
const repositoryIdentity = "example/capability-project";

function capability(id = "browser-runtime") {
  return {
    id,
    capability: id === "database-runtime" ? "database-runtime" : "browser-runtime",
    operation: "prove-capability",
    target: id === "database-runtime" ? "disposable-database" : "local-browser",
    scope: [id === "database-runtime" ? "disposable-database" : "local-browser"],
    reason: id === "database-runtime" ? "Verify migrations and constraints." : "Exercise the real user interface.",
    risk: id === "database-runtime" ? "high" : "medium",
    authority: id === "database-runtime" ? "human-only" : "explicit",
    decision: "pending"
  };
}

async function setup(t) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-capability-data-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-capability-supervisor-"));
  t.after(() => Promise.all([rm(dataRoot, { recursive: true, force: true }), rm(supervisorRoot, { recursive: true, force: true })]));
  const initialized = await initializeSupervisorIdentity(supervisorRoot, { now: () => new Date(at) });
  const { run, event } = createInitialGoalRun({
    id: "run-capability-1",
    repository: { identity: repositoryIdentity, root_uri: "file:///workspace/project", base_ref: "main" },
    originalGoal: "Understand the running application",
    headSha: sha,
    now: "2026-08-31T16:00:00.000Z"
  });
  const initialScorecard = createReviewScorecard({ run, scopeHash: "b".repeat(64), harnessVersion: "unbound", title: "Goal", reviewVerdicts: [], reviewChecks: [], findings: [], generatedAt: at });
  await createStoredGoalRun({ dataRoot, run, event, scorecard: initialScorecard });
  const plan = {
    schema_version: 1,
    id: "onboarding-capability-1",
    generated_at: at,
    repository_identity: repositoryIdentity,
    commit_sha: sha,
    workspace: { dirty: false, changed_file_count: 0 },
    mode: "read-only-plan",
    verdict: "needs-evidence",
    claims: [{ id: "claim-repository", domain: "repository", status: "code-confirmed", summary: "Repository is committed.", evidence_refs: ["git"] }],
    coverage: [{ domain: "repository", status: "code-confirmed", claim_ids: ["claim-repository"] }],
    capability_requests: [capability(), capability("database-runtime")],
    blockers: [{ id: "runtime-unproved", summary: "Runtime behavior is unproved." }],
    limitations: ["No consumer command has run."],
    next_action: { id: "approve-capability-plan", label: "Review capability plan", recommended: true }
  };
  const sourceHash = hashContract(plan);
  const nextRun = structuredClone(run);
  nextRun.state = "clarifying";
  nextRun.timestamps.updated_at = at;
  const scorecard = createReviewScorecard({ run: nextRun, scopeHash: "b".repeat(64), harnessVersion: "unbound", title: "Understanding", reviewVerdicts: [], reviewChecks: [], findings: [], generatedAt: at });
  const packet = {
    schema_version: 1, id: "packet-capability", run_id: run.id, kind: "alignment-brief", generated_at: at, head_sha: sha,
    title: "Alignment", verdict: "action-required", summary: "Capabilities require approval.",
    attention: { required: true, count: 1, reasons: ["verification-blocker"] },
    sections: [{ id: "gaps", title: "Gaps", items: [{ id: "gap-runtime", text: "Runtime unproved.", confidence: "verify", severity: "blocking", source_refs: ["artifact-onboarding-plan"] }] }],
    decisions: [], actions: [{ id: "inspect", label: "Inspect", kind: "inspect", recommended: true }],
    source_artifacts: [{ id: "artifact-onboarding-plan", kind: "onboarding-plan", sha256: sourceHash }],
    traceability: [{ item_id: "gap-runtime", source_refs: ["artifact-onboarding-plan"] }],
    compression: { source_artifact_count: 1, surfaced_item_count: 1, omitted_item_count: 1 }
  };
  const events = [
    createRunEvent({ runId: run.id, sequence: 2, at, type: "state.transitioned", data: { from: "received", to: "discovering" } }),
    createRunEvent({ runId: run.id, sequence: 3, at, type: "state.transitioned", data: { from: "discovering", to: "clarifying" } })
  ];
  await appendGoalRunCheckpoint({ dataRoot, repositoryIdentity, runId: run.id, events, nextRun, scorecard, packet, artifacts: [{ id: "artifact-onboarding-plan", kind: "onboarding-plan", value: plan, sha256: sourceHash }] });
  return { dataRoot, supervisorRoot, identity: initialized.identity, run: nextRun, plan };
}

test("current capability subjects are loaded from intact checkpoint artifacts", async (t) => {
  const fixture = await setup(t);
  const loaded = await loadRunSourceArtifact(fixture.dataRoot, repositoryIdentity, fixture.run.id, "artifact-onboarding-plan");
  assert.deepEqual(loaded.value, fixture.plan);
  await assert.rejects(loadRunSourceArtifact(fixture.dataRoot, repositoryIdentity, fixture.run.id, "artifact-missing"), /not declared/i);
});

test("capability status moves from unrequested to pending to approved using exact signed bindings", async (t) => {
  const fixture = await setup(t);
  const evaluationTime = new Date("2026-08-31T17:10:00.000Z");
  let view = await loadCapabilityAuthorizationView({ ...fixture, repositoryIdentity, runId: fixture.run.id, now: evaluationTime });
  assert.deepEqual(view.counts, { total: 2, unrequested: 2, pending: 0, approved: 0, rejected: 0, expired: 0, stale: 0 });

  const issued = await requestCapabilityAuthorization({ ...fixture, repositoryIdentity, runId: fixture.run.id, capabilityId: "browser-runtime", now: () => evaluationTime });
  assert.equal(issued.request.subject.id, "browser-runtime");
  assert.equal(issued.request.subject.artifact_sha256, hashContract(capability()));
  view = await loadCapabilityAuthorizationView({ ...fixture, repositoryIdentity, runId: fixture.run.id, now: new Date("2026-08-31T17:20:00.000Z") });
  assert.equal(view.capabilities[0].status, "pending");
  assert.equal(view.next_action, `devharness approve --request ${issued.request.id}`);
  assert.equal(await resolveCapabilityApprovalContext({ ...fixture, repositoryIdentity, requestId: issued.request.id, now: evaluationTime }).then((value) => value.id), "browser-runtime");

  const receipt = await attestApprovalReceipt(fixture.supervisorRoot, {
    schema_version: 1,
    id: "approval-receipt-capability-1",
    request_id: issued.request.id,
    request_sha256: approvalRequestHash(issued.request),
    run_id: issued.request.run_id,
    repository_identity: issued.request.repository_identity,
    relevant_head_sha: issued.request.relevant_head_sha,
    gate: "capability",
    subject: structuredClone(issued.request.subject),
    nonce: issued.request.nonce,
    decision: "approved",
    decided_at: "2026-08-31T17:15:00.000Z",
    decided_by: { id: "developer", kind: "human" },
    source: "interactive-human-gate",
    expires_at: issued.request.expires_at
  });
  await writeApprovalReceipt(fixture.supervisorRoot, repositoryIdentity, receipt);
  view = await loadCapabilityAuthorizationView({ ...fixture, repositoryIdentity, runId: fixture.run.id, now: new Date("2026-08-31T17:20:00.000Z") });
  assert.equal(view.capabilities[0].status, "approved");
  assert.equal(view.capabilities[0].approval_receipt_id, receipt.id);
});

test("foreground approval presentation exposes the exact bounded capability", async (t) => {
  const fixture = await setup(t);
  const issued = await requestCapabilityAuthorization({ ...fixture, repositoryIdentity, runId: fixture.run.id, capabilityId: "database-runtime", now: () => new Date("2026-08-31T17:10:00.000Z") });
  const text = formatForegroundApproval(issued.request, fixture.identity, issued.capability);
  assert.match(text, /Capability: database-runtime/);
  assert.match(text, /Operation: prove-capability/);
  assert.match(text, /Target: disposable-database/);
  assert.match(text, /Scope: disposable-database/);
  assert.match(text, /Risk: high/);
  assert.match(text, /Authority: human-only/);
  assert.match(text, new RegExp(issued.request.subject.artifact_sha256));
});
