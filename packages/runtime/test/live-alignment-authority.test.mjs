import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createInitialGoalRun, createRunEvent } from "../../core/src/goal-run.mjs";
import { createReviewScorecard } from "../../core/src/review-scorecard.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { buildLiveAlignmentOperation, stableLiveAlignmentOperationId } from "../src/live-alignment.mjs";
import { appendGoalRunCheckpoint, createStoredGoalRun } from "../src/goal-run-store.mjs";
import { AgentAdapterRegistry } from "../src/agent-adapter.mjs";
import { loadCapabilityAuthorizationView, requestCapabilityAuthorization, resolveCapabilityApprovalContext } from "../src/capability-authorization.mjs";
import { initializeSupervisorIdentity } from "../src/supervisor-store.mjs";
import { createScriptedAgentAdapter } from "./fixtures/scripted-agent-adapter.mjs";

const now = "2026-08-31T17:00:00.000Z";
const repositoryIdentity = "example/capability-project";
const headSha = "b".repeat(40);
const usage = { input_tokens: 7, output_tokens: 3, total_tokens: 10 };

function mutableProfile() {
  return {
    id: "readonly-analysis-v1",
    modelId: "gpt-approved",
    controlPlaneOrigins: ["https://api.example.com"],
    template: { sandbox: "read-only" }
  };
}

function descriptor() {
  return {
    schema_version: 1,
    id: "codex",
    version: "1.0.0",
    protocol_version: 1,
    profile_id: "codex-readonly-analysis-v1",
    model_id: "gpt-approved",
    executable_version: "codex-1",
    modes: ["analysis-plan", "analysis-synthesis", "analysis-validation"],
    features: { structured_output: true, explicit_cancel: true, ephemeral_session: true, read_only_tool_policy: true, built_in_web_disable: true, trusted_usage: true },
    implementation_sha256: "a".repeat(64),
    executable_sha256: "b".repeat(64),
    profile_template_sha256: "c".repeat(64),
    control_plane_origins: ["https://api.example.com"],
    descriptor_sha256: "d".repeat(64)
  };
}

function limits() {
  return {
    attempt_deadline_seconds: 600,
    max_active_execution_seconds: 3600,
    max_result_bytes: 1048576,
    max_stdout_bytes: 10485760,
    max_stderr_bytes: 10485760,
    max_retained_records: 20,
    max_retained_bytes: 20971520,
    max_temporary_bytes: 268435456,
    max_processes: 64,
    max_rss_bytes: 2147483648,
    cleanup_deadline_seconds: 30,
    max_research_queries: 5,
    max_sources_per_query: 5,
    max_research_requests: 25,
    max_redirects_per_request: 3,
    max_research_response_bytes: 2097152,
    max_research_bytes: 10485760,
    research_request_deadline_seconds: 30,
    max_agent_attempts: 6,
    max_provider_requests: 120,
    provider_request_deadline_seconds: 120,
    max_total_tokens: 600000
  };
}

function buildOperation({ agentDescriptor = descriptor(), agentAuthoritySubject = { id: "subject-1", sha256: "e".repeat(64) }, operationLimits = limits() } = {}) {
  const run = {
    id: "run-1",
    repository: { identity: repositoryIdentity, root_uri: "file:///workspace/project", base_ref: "main" },
    current_head_sha: headSha
  };
  return buildLiveAlignmentOperation({
    run,
    goalArtifact: { id: "goal-1", sha256: "1".repeat(64), storage_key: "artifacts/goal.json", media_type: "application/json", size_bytes: 1 },
    snapshotArtifact: { id: "snapshot-1", sha256: "2".repeat(64), storage_key: "artifacts/snapshot.json", media_type: "application/json", size_bytes: 1 },
    onboardingArtifact: { id: "onboarding-1", sha256: "3".repeat(64), storage_key: "artifacts/onboarding.json", media_type: "application/json", size_bytes: 1 },
    agentDescriptor,
    agentAuthoritySubject,
    resultContractSha256: "4".repeat(64),
    limits: operationLimits,
    developerAnswerArtifacts: [],
    inputCheckpointSha256: hashContract({ run_id: run.id, head_sha: run.current_head_sha })
  });
}

function capability(capabilityId, capabilityKind, target) {
  return {
    id: capabilityId,
    capability: capabilityKind,
    operation: `authorize-${capabilityKind}`,
    target,
    scope: [target],
    reason: `Authorize ${capabilityKind} for this run.`,
    risk: capabilityKind === "agent-runtime" ? "high" : "medium",
    authority: capabilityKind === "agent-runtime" ? "human-only" : "explicit",
    reversibility: "revocable-before-next-external-action",
    decision: "pending"
  };
}

async function setupGoalRun(t) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-authority-data-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-authority-supervisor-"));
  t.after(() => Promise.all([rm(dataRoot, { recursive: true, force: true }), rm(supervisorRoot, { recursive: true, force: true })]));
  await initializeSupervisorIdentity(supervisorRoot, { now: () => new Date(now) });

  const { run, event } = createInitialGoalRun({
    id: "run-authority-1",
    repository: { identity: repositoryIdentity, root_uri: "file:///workspace/project", base_ref: "main" },
    originalGoal: "Understand the running application",
    headSha,
    now
  });
  const initialScorecard = createReviewScorecard({ run, scopeHash: "b".repeat(64), harnessVersion: "unbound", title: "Goal", reviewVerdicts: [], reviewChecks: [], findings: [], generatedAt: now });
  await createStoredGoalRun({ dataRoot, run, event, scorecard: initialScorecard });

  const plan = {
    schema_version: 1,
    id: "onboarding-authority-1",
    generated_at: now,
    repository_identity: repositoryIdentity,
    commit_sha: headSha,
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
        "not-applicable": 8
      },
      priority_domains: []
    },
    claims: [{ id: "claim-repository", domain: "repository", status: "code-confirmed", summary: "Repository is committed.", evidence_refs: [headSha] }],
    coverage: [{ domain: "repository", status: "code-confirmed", claim_ids: ["claim-repository"] }],
    capability_requests: [
      capability("agent-runtime", "agent-runtime", "codex-readonly-analysis-v1"),
      capability("browser-runtime", "browser-runtime", "local-browser"),
      capability("network-research", "network-research", "research.best-practices")
    ],
    preflight: {
      research_topics: [],
      research_tasks: [
        {
          id: "network-research",
          topic_id: "network-research",
          query: "Review current best practices.",
          owner: "verification",
          priority: 2,
          approval_capability: "network-research",
          status: "pending-approval",
          expected_outcome: "Confirm current best practice.",
          basis: ["network-research"]
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
  nextRun.timestamps.updated_at = now;
  const scorecard = createReviewScorecard({ run: nextRun, scopeHash: "b".repeat(64), harnessVersion: "unbound", title: "Understanding", reviewVerdicts: [], reviewChecks: [], findings: [], generatedAt: now });
  const packet = {
    schema_version: 1,
    id: "packet-authority",
    run_id: run.id,
    kind: "alignment-brief",
    generated_at: now,
    head_sha: headSha,
    title: "Alignment",
    verdict: "action-required",
    summary: "Capabilities require approval.",
    attention: { required: true, count: 1, reasons: ["verification-blocker"] },
    sections: [{ id: "gaps", title: "Gaps", items: [{ id: "gap-runtime", text: "Runtime unproved.", confidence: "verify", severity: "blocking", source_refs: ["artifact-onboarding-plan"] }] }],
    decisions: [],
    actions: [{ id: "inspect", label: "Inspect", kind: "inspect", recommended: true }],
    source_artifacts: [{ id: "artifact-onboarding-plan", kind: "onboarding-plan", sha256: sourceHash }],
    traceability: [{ item_id: "gap-runtime", source_refs: ["artifact-onboarding-plan"] }],
    compression: { source_artifact_count: 1, surfaced_item_count: 1, omitted_item_count: 1 }
  };
  const events = [
    createRunEvent({ runId: run.id, sequence: 2, at: now, type: "state.transitioned", data: { from: "received", to: "discovering" } }),
    createRunEvent({ runId: run.id, sequence: 3, at: now, type: "state.transitioned", data: { from: "discovering", to: "clarifying" } })
  ];
  await appendGoalRunCheckpoint({ dataRoot, repositoryIdentity, runId: run.id, events, nextRun, scorecard, packet, artifacts: [{ id: "artifact-onboarding-plan", kind: "onboarding-plan", value: plan, sha256: sourceHash }] });

  return { dataRoot, supervisorRoot, run: nextRun, plan };
}

test("agent adapter probeApproved rejects stale descriptor values and accepts renewed ones", async () => {
  const profile = mutableProfile();
  const registry = new AgentAdapterRegistry().register("scripted", createScriptedAgentAdapter({ profile, script: { outcome: "success", now, usage, resultPath: "/private/result.json" } }));

  const first = await registry.probe("scripted", { profileId: "readonly-analysis-v1" });
  const approved = await registry.probeApproved("scripted", { profileId: "readonly-analysis-v1" }, first);
  assert.equal(approved.descriptor_sha256, first.descriptor_sha256);

  profile.modelId = "gpt-rotated";
  await assert.rejects(
    () => registry.probeApproved("scripted", { profileId: "readonly-analysis-v1" }, first),
    /execution profile/
  );

  profile.modelId = "gpt-approved";
  profile.controlPlaneOrigins = ["https://api.example.com", "https://control.example.com"];
  const renewed = await registry.probeApproved("scripted", { profileId: "readonly-analysis-v1" }, await registry.probe("scripted", { profileId: "readonly-analysis-v1" }));
  assert.equal(renewed.control_plane_origins.length, 2);
  assert.notEqual(renewed.descriptor_sha256, first.descriptor_sha256);
});

test("live alignment operation identity binds exact phases, budgets, profile, model, origins, and authority subject", () => {
  const baseDescriptor = descriptor();
  const baseLimits = limits();
  const baseOperation = buildOperation({ agentDescriptor: baseDescriptor, operationLimits: baseLimits });
  const sameOperation = buildOperation({ agentDescriptor: structuredClone(baseDescriptor), operationLimits: structuredClone(baseLimits) });

  assert.equal(baseOperation.id, sameOperation.id);
  assert.equal(baseOperation.agent_descriptor.profile_id, "codex-readonly-analysis-v1");
  assert.deepEqual(baseOperation.agent_descriptor.modes, ["analysis-plan", "analysis-synthesis", "analysis-validation"]);

  const differentProfile = buildOperation({
    agentDescriptor: { ...baseDescriptor, profile_id: "codex-analysis-v2" },
    operationLimits: baseLimits
  });
  const differentModel = buildOperation({
    agentDescriptor: { ...baseDescriptor, model_id: "gpt-alt" },
    operationLimits: baseLimits
  });
  const differentOrigins = buildOperation({
    agentDescriptor: { ...baseDescriptor, control_plane_origins: ["https://api.example.com", "https://control.example.com"] },
    operationLimits: baseLimits
  });
  const differentPhases = buildOperation({
    agentDescriptor: { ...baseDescriptor, modes: ["analysis-validation", "analysis-synthesis", "analysis-plan"] },
    operationLimits: baseLimits
  });
  const differentBudgets = buildOperation({
    agentDescriptor: baseDescriptor,
    operationLimits: { ...baseLimits, max_active_execution_seconds: 1200, max_agent_attempts: 4 }
  });
  const differentAuthority = buildOperation({
    agentDescriptor: baseDescriptor,
    agentAuthoritySubject: { id: "subject-2", sha256: "f".repeat(64) },
    operationLimits: baseLimits
  });

  assert.notEqual(baseOperation.id, differentProfile.id);
  assert.notEqual(baseOperation.id, differentModel.id);
  assert.notEqual(baseOperation.id, differentOrigins.id);
  assert.notEqual(baseOperation.id, differentPhases.id);
  assert.notEqual(baseOperation.id, differentBudgets.id);
  assert.notEqual(baseOperation.id, differentAuthority.id);
  assert.equal(baseOperation.id, stableLiveAlignmentOperationId({
    run_id: baseOperation.run_id,
    repository_identity: baseOperation.repository_identity,
    commit_sha: baseOperation.commit_sha,
    input_checkpoint_sha256: baseOperation.input_checkpoint_sha256,
    original_goal: baseOperation.original_goal,
    developer_answers: baseOperation.developer_answers,
    snapshot: baseOperation.snapshot,
    onboarding: baseOperation.onboarding,
    agent_descriptor: baseDescriptor,
    agent_authority_subject: { id: "subject-1", sha256: "e".repeat(64) },
    result_contract_sha256: "4".repeat(64),
    limits: baseLimits
  }));
});

test("capability authorization renews an expired exact authority request without changing the subject", async (t) => {
  const fixture = await setupGoalRun(t);
  const before = await loadCapabilityAuthorizationView({ ...fixture, repositoryIdentity, runId: fixture.run.id, now: new Date("2026-08-31T17:05:00.000Z") });
  assert.equal(before.counts.total, 3);
  assert.equal(before.counts.unrequested, 3);
  assert.equal(before.next_action, "devharness request-capability --run run-authority-1 --capability agent-runtime --expires-minutes 720");

  const issued = await requestCapabilityAuthorization({
    ...fixture,
    repositoryIdentity,
    runId: fixture.run.id,
    capabilityId: "agent-runtime",
    expiresInMinutes: 1,
    now: () => new Date("2026-08-31T17:05:00.000Z")
  });
  assert.equal(issued.capability.id, "agent-runtime");
  assert.equal(issued.request.subject.id, "agent-runtime");

  const requested = await loadCapabilityAuthorizationView({ ...fixture, repositoryIdentity, runId: fixture.run.id, now: new Date("2026-08-31T17:05:00.000Z") });
  assert.equal(requested.counts.pending, 1);
  assert.equal(requested.next_action, `devharness approve --request ${issued.request.id}`);

  const approvedCapability = await resolveCapabilityApprovalContext({
    ...fixture,
    repositoryIdentity,
    requestId: issued.request.id,
    now: new Date("2026-08-31T17:05:00.000Z")
  });
  assert.equal(approvedCapability.id, "agent-runtime");

  const expiredView = await loadCapabilityAuthorizationView({ ...fixture, repositoryIdentity, runId: fixture.run.id, now: new Date("2026-08-31T18:10:00.000Z") });
  assert.equal(expiredView.capabilities.find((item) => item.request.id === "agent-runtime").status, "expired");
  assert.equal(expiredView.next_action, "devharness request-capability --run run-authority-1 --capability agent-runtime --expires-minutes 720");

  const renewed = await requestCapabilityAuthorization({
    ...fixture,
    repositoryIdentity,
    runId: fixture.run.id,
    capabilityId: "agent-runtime",
    expiresInMinutes: 1,
    now: () => new Date("2026-08-31T18:10:00.000Z")
  });
  assert.notEqual(renewed.request.id, issued.request.id);
  assert.equal(renewed.request.subject.artifact_sha256, issued.request.subject.artifact_sha256);
  assert.equal(renewed.request.subject.id, "agent-runtime");
});
