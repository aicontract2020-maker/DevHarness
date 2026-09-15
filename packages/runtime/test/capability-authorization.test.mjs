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
  DEFAULT_CAPABILITY_EXPIRES_IN_MINUTES,
  LONG_LIVED_CAPABILITY_EXPIRES_IN_MINUTES,
  loadCapabilityAuthorizationView,
  requestCapabilityAuthorization,
  resolveCapabilityApprovalContext, buildNetworkResearchAuthorityFromReceipt, resolveNetworkResearchAuthorityFromCapabilityGrants,
  resolveCapabilityExpiresInMinutes
} from "../src/capability-authorization.mjs";
import { appendGoalRunCheckpoint, createStoredGoalRun, loadRunSourceArtifact } from "../src/goal-run-store.mjs";
import { formatForegroundApproval } from "../src/supervisor-approval.mjs";
import { attestApprovalReceipt, initializeSupervisorIdentity, writeApprovalReceipt } from "../src/supervisor-store.mjs";

const sha = "a".repeat(40);
const at = "2026-08-31T17:00:00.000Z";
const repositoryIdentity = "example/capability-project";

function capability(id = "browser-runtime") {
  const kind = ["database-runtime", "agent-runtime", "network-research", "browser-runtime"].includes(id) ? id : "browser-runtime";
  const targets = {
    "database-runtime": "disposable-database",
    "agent-runtime": "codex-readonly-analysis-v1",
    "network-research": "bounded-http-research",
    "browser-runtime": "local-browser"
  };
  const reasons = {
    "database-runtime": "Verify migrations and constraints.",
    "agent-runtime": "Run live Alignment analysis under Supervisor authority.",
    "network-research": "Fetch bounded public research for clarification.",
    "browser-runtime": "Exercise the real user interface."
  };
  return {
    id,
    capability: kind,
    operation: "prove-capability",
    target: targets[kind],
    scope: [targets[kind]],
    reason: reasons[kind],
    risk: kind === "database-runtime" || kind === "agent-runtime" ? "high" : "medium",
    authority: kind === "database-runtime" || kind === "agent-runtime" ? "human-only" : "explicit",
    decision: "pending"
  };
}

async function setup(t, { capabilities = [capability(), capability("database-runtime")] } = {}) {
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
    summary: {
      total_claims: 1,
      proved_claims: 1,
      unresolved_claims: 0,
      conflict_claims: 0,
      domain_knownness: {
        database: {
          total_claims: 0,
          known_claims: 0,
          unknown_claims: 0,
          conflict_claims: 0,
          subdomains: {
            schema: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 },
            migrations: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 },
            constraints: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 },
            queries: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 },
            ownership: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 }
          }
        },
        frontend: {
          total_claims: 0,
          known_claims: 0,
          unknown_claims: 0,
          conflict_claims: 0,
          subdomains: {
            routes: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 },
            state: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 },
            user_flows: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 }
          }
        },
        backend: {
          total_claims: 0,
          known_claims: 0,
          unknown_claims: 0,
          conflict_claims: 0,
          subdomains: {
            api_contracts: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 },
            orchestration: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 },
            failure_paths: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 }
          }
        }
      },
      claim_status_counts: {
        "code-confirmed": 1,
        "test-confirmed": 0,
        "runtime-observed": 0,
        detected: 0,
        documented: 0,
        conflict: 0,
        unverified: 0,
        "not-covered": 0
      },
      coverage_status_counts: {
        "code-confirmed": 1,
        "test-confirmed": 0,
        "runtime-observed": 0,
        detected: 0,
        documented: 0,
        conflict: 0,
        unverified: 0,
        "not-covered": 0,
        "not-applicable": 9
      },
      priority_domains: []
    },
    claims: [{ id: "claim-repository", domain: "repository", status: "code-confirmed", summary: "Repository is committed.", evidence_refs: ["git"] }],
    coverage: [{ domain: "repository", status: "code-confirmed", claim_ids: ["claim-repository"] }],
    capability_requests: capabilities,
    preflight: {
      research_topics: [],
      research_tasks: [
        {
          id: "browser-runtime",
          topic_id: "browser-runtime",
          query: "Exercise the real user interface.",
          owner: "verification",
          priority: 2,
          approval_capability: "network-research",
          status: "pending-approval",
          expected_outcome: "Confirm current browser verification practice.",
          basis: ["browser-runtime"]
        }
      ],
      team_decomposition: []
    },
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
  assert.deepEqual(view.research_task_counts, { total: 1, pending_approval: 1, approved: 0, blocked: 0 });
  assert.equal(view.research_tasks[0].id, "browser-runtime");
  assert.equal(view.research_tasks[0].status, "pending-approval");

  const issued = await requestCapabilityAuthorization({ ...fixture, repositoryIdentity, runId: fixture.run.id, capabilityId: "browser-runtime", now: () => evaluationTime });
  assert.equal(issued.request.subject.id, "browser-runtime");
  assert.equal(issued.request.subject.artifact_sha256, hashContract(capability()));
  view = await loadCapabilityAuthorizationView({ ...fixture, repositoryIdentity, runId: fixture.run.id, now: new Date("2026-08-31T17:20:00.000Z") });
  assert.equal(view.capabilities[0].status, "pending");
  assert.deepEqual(view.research_task_counts, { total: 1, pending_approval: 1, approved: 0, blocked: 0 });
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
  assert.equal(view.research_tasks[0].status, "approved");
  assert.equal(view.research_tasks[0].approval_receipt_id, receipt.id);
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


test("long-lived capabilities default to multi-hour approval windows", () => {
  assert.equal(resolveCapabilityExpiresInMinutes("agent-runtime"), LONG_LIVED_CAPABILITY_EXPIRES_IN_MINUTES["agent-runtime"]);
  assert.equal(resolveCapabilityExpiresInMinutes("network-research"), LONG_LIVED_CAPABILITY_EXPIRES_IN_MINUTES["network-research"]);
  assert.equal(resolveCapabilityExpiresInMinutes("browser-runtime"), DEFAULT_CAPABILITY_EXPIRES_IN_MINUTES);
  assert.equal(resolveCapabilityExpiresInMinutes("agent-runtime", 90), 90);
  assert.equal(LONG_LIVED_CAPABILITY_EXPIRES_IN_MINUTES["agent-runtime"], 720);
  assert.equal(LONG_LIVED_CAPABILITY_EXPIRES_IN_MINUTES["network-research"], 480);
  assert.throws(() => resolveCapabilityExpiresInMinutes("agent-runtime", 0), /1 and 1440/);
  assert.throws(() => resolveCapabilityExpiresInMinutes("agent-runtime", 1441), /1 and 1440/);
});

test("requesting agent-runtime applies the long-lived default TTL and renews after expiry", async (t) => {
  const fixture = await setup(t, { capabilities: [capability("agent-runtime"), capability("browser-runtime")] });
  const issued = await requestCapabilityAuthorization({
    ...fixture,
    repositoryIdentity,
    runId: fixture.run.id,
    capabilityId: "agent-runtime",
    now: () => new Date("2026-08-31T17:10:00.000Z")
  });
  assert.equal(issued.expires_in_minutes, 720);
  assert.equal(issued.request.expires_at, "2026-09-01T05:10:00.000Z");

  const view = await loadCapabilityAuthorizationView({
    ...fixture,
    repositoryIdentity,
    runId: fixture.run.id,
    now: new Date("2026-08-31T17:10:00.000Z")
  });
  assert.equal(view.next_action, `devharness approve --request ${issued.request.id}`);
  assert.equal(view.capabilities.find((item) => item.request.id === "agent-runtime").status, "pending");

  await assert.rejects(
    resolveCapabilityApprovalContext({
      ...fixture,
      repositoryIdentity,
      requestId: issued.request.id,
      now: new Date("2026-09-01T06:00:00.000Z")
    }),
    /expired.*request-capability --run run-capability-1 --capability agent-runtime --expires-minutes 720/i
  );

  const expiredView = await loadCapabilityAuthorizationView({
    ...fixture,
    repositoryIdentity,
    runId: fixture.run.id,
    now: new Date("2026-09-01T06:00:00.000Z")
  });
  assert.equal(expiredView.capabilities.find((item) => item.request.id === "agent-runtime").status, "expired");
  assert.equal(
    expiredView.next_action,
    "devharness request-capability --run run-capability-1 --capability agent-runtime --expires-minutes 720"
  );

  const renewed = await requestCapabilityAuthorization({
    ...fixture,
    repositoryIdentity,
    runId: fixture.run.id,
    capabilityId: "agent-runtime",
    now: () => new Date("2026-09-01T06:00:00.000Z")
  });
  assert.notEqual(renewed.request.id, issued.request.id);
  assert.equal(renewed.expires_in_minutes, 720);
  assert.equal(renewed.request.subject.artifact_sha256, issued.request.subject.artifact_sha256);
});

test("ordinary capabilities keep the 60-minute default TTL", async (t) => {
  const fixture = await setup(t);
  const issued = await requestCapabilityAuthorization({
    ...fixture,
    repositoryIdentity,
    runId: fixture.run.id,
    capabilityId: "browser-runtime",
    now: () => new Date("2026-08-31T17:10:00.000Z")
  });
  assert.equal(issued.expires_in_minutes, 60);
  assert.equal(issued.request.expires_at, "2026-08-31T18:10:00.000Z");
});

test("network-research authority is built from capability receipts without a subject digest", async (t) => {
  const fixture = await setup(t, {
    capabilities: [
      capability("agent-runtime"),
      {
        ...capability("network-research"),
        id: "research-task-1",
        capability: "network-research",
        operation: "research",
        target: "public-docs",
        scope: ["public-docs"]
      }
    ]
  });
  const evaluationTime = new Date("2026-08-31T17:10:00.000Z");
  const issued = await requestCapabilityAuthorization({
    ...fixture,
    repositoryIdentity,
    runId: fixture.run.id,
    capabilityId: "research-task-1",
    now: () => evaluationTime
  });
  const receipt = await attestApprovalReceipt(fixture.supervisorRoot, {
    schema_version: 1,
    id: "approval-receipt-research-1",
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

  const built = buildNetworkResearchAuthorityFromReceipt(receipt, { epoch: 1 });
  assert.equal(built.capability, "network-research");
  assert.equal(built.request_id, receipt.request_id);
  assert.equal(built.receipt_id, receipt.id);
  assert.equal(built.request_sha256, receipt.request_sha256);
  assert.equal(built.receipt_sha256, receipt.attestation.payload_sha256);
  assert.equal(built.epoch, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(built, "subject_sha256"), false);

  const view = await loadCapabilityAuthorizationView({
    ...fixture,
    repositoryIdentity,
    runId: fixture.run.id,
    now: new Date("2026-08-31T17:20:00.000Z")
  });
  const resolved = await resolveNetworkResearchAuthorityFromCapabilityGrants({
    supervisorRoot: fixture.supervisorRoot,
    repositoryIdentity,
    capabilityView: view,
    now: new Date("2026-08-31T17:20:00.000Z"),
    previousEpoch: 0
  });
  assert.equal(resolved.receipt_id, receipt.id);
  assert.equal(resolved.receipt_sha256, receipt.attestation.payload_sha256);
  assert.equal(Object.prototype.hasOwnProperty.call(resolved, "subject_sha256"), false);

  assert.equal(buildNetworkResearchAuthorityFromReceipt({ ...receipt, decision: "rejected" }), null);
});


test("TTL reuse returns the live approved grant without a new pending request", async (t) => {
  const fixture = await setup(t, { capabilities: [capability("agent-runtime"), capability("browser-runtime")] });
  const evaluationTime = new Date("2026-08-31T17:10:00.000Z");
  const issued = await requestCapabilityAuthorization({
    ...fixture,
    repositoryIdentity,
    runId: fixture.run.id,
    capabilityId: "agent-runtime",
    now: () => evaluationTime
  });
  const receipt = await attestApprovalReceipt(fixture.supervisorRoot, {
    schema_version: 1,
    id: "approval-receipt-agent-ttl-1",
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

  const reused = await requestCapabilityAuthorization({
    ...fixture,
    repositoryIdentity,
    runId: fixture.run.id,
    capabilityId: "agent-runtime",
    now: () => new Date("2026-08-31T18:00:00.000Z")
  });
  assert.equal(reused.reused, true);
  assert.equal(reused.reuse_kind, "approved-grant");
  assert.equal(reused.request.id, issued.request.id);
  assert.equal(reused.receipt.id, receipt.id);

  const pendingReuse = await requestCapabilityAuthorization({
    ...fixture,
    repositoryIdentity,
    runId: fixture.run.id,
    capabilityId: "browser-runtime",
    now: () => evaluationTime
  });
  assert.equal(pendingReuse.reused, false);
  const samePending = await requestCapabilityAuthorization({
    ...fixture,
    repositoryIdentity,
    runId: fixture.run.id,
    capabilityId: "browser-runtime",
    now: () => new Date("2026-08-31T17:20:00.000Z")
  });
  assert.equal(samePending.reused, true);
  assert.equal(samePending.reuse_kind, "pending-request");
  assert.equal(samePending.request.id, pendingReuse.request.id);
});
