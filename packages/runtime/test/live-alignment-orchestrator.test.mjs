import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hashContract } from "../../project/src/harness.mjs";
import {
  buildLiveAlignmentAnalysisPlan,
  buildLiveAlignmentLease,
  buildLiveAlignmentInteractionPacket,
  buildLiveAlignmentOperation,
  buildLiveAlignmentStatus,
  createLiveAlignmentArtifactRefs,
  loadLiveAlignmentOperationBundle,
  projectLiveAlignmentOperationStatus,
  startLiveAlignmentOperation,
  stableLiveAlignmentOperationId
} from "../src/live-alignment.mjs";

const repositoryIdentity = "example/project";
const run = {
  id: "run-1",
  repository: { identity: repositoryIdentity, root_uri: "file:///example/project", base_ref: "main" },
  current_head_sha: "b".repeat(40)
};

const onboardingPlan = {
  schema_version: 1,
  repository_identity: repositoryIdentity,
  commit_sha: run.current_head_sha,
  workspace: { dirty: false, changed_file_count: 0 },
  mode: "read-only-plan",
  verdict: "needs-evidence",
  summary: {
    total_claims: 1,
    proved_claims: 0,
    unresolved_claims: 1,
    conflict_claims: 0,
    claim_status_counts: { detected: 1, documented: 0, "code-confirmed": 0, conflict: 0, unverified: 0, "not-covered": 0 },
    coverage_status_counts: { applicable: 1, "not-applicable": 0, conflict: 0, gap: 0 },
    domain_knownness: { database: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} }, frontend: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} }, backend: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} } },
    priority_domains: ["frontend=detected"]
  },
  claims: [{ id: "repository-inventory", domain: "repository", status: "code-confirmed", summary: "Repository identity was inspected.", evidence_refs: ["package.json"] }],
  coverage: [{ domain: "repository", status: "applicable", claim_ids: ["repository-inventory"] }],
  capability_requests: [{ capability: "network-research", operation: "research", target: "topic", scope: ["repo"], reason: "Check current practices.", risk: "low", authority: "human-only", reversibility: "revocable-before-next-external-action", decision: "pending" }],
  blockers: [
    { id: "blocker-1", summary: "Need a product decision.", source_refs: ["package.json"] },
    { id: "blocker-2", summary: "Need a browser verification decision.", source_refs: ["package.json"] },
    { id: "blocker-3", summary: "Need a database ownership decision.", source_refs: ["package.json"] }
  ],
  preflight: {
    clarification_questions: [
      { id: "clarify-1", blocker_id: "blocker-1", question: "What product decision do we need before implementation can proceed?", priority: 1, basis: ["plan-clarify", "goal-clarify", "blocker-1"] },
      { id: "clarify-2", blocker_id: "blocker-2", question: "What do we need to confirm about the browser surface before implementation can proceed?", priority: 2, basis: ["plan-clarify", "goal-clarify", "blocker-2"] },
      { id: "clarify-3", blocker_id: "blocker-3", question: "What do we need to confirm about the database surface before implementation can proceed?", priority: 3, basis: ["plan-clarify", "goal-clarify", "blocker-3"] }
    ],
    research_topics: [
      {
        id: "research-framework-best-practices",
        purpose: "Review framework best practices before implementation starts.",
        query: "Official best practices for Next.js routing, state, data flow, and server/client boundaries",
        owner: "frontend",
        priority: 2,
        expected_outcome: "Keep implementation choices consistent with public guidance.",
        public_identifiers: ["Next.js"],
        basis: ["research", "best-practices", "frontend"]
      }
    ],
    research_tasks: [
      {
        id: "research-task-1",
        topic_id: "research-framework-best-practices",
        query: "Official best practices for Next.js routing, state, data flow, and server/client boundaries",
        owner: "frontend",
        priority: 2,
        approval_capability: "network-research",
        status: "pending-approval",
        expected_outcome: "Keep implementation choices consistent with public guidance.",
        basis: ["research", "best-practices", "frontend"]
      }
    ],
    team_decomposition: [
      {
        id: "team-discovery",
        label: "Discovery",
        focus: "Resolve repository and goal ambiguities before implementation starts.",
        task_ids: ["goal-clarify", "goal-design"],
        exit_criteria: "All material questions are either answered or explicitly approved as assumptions.",
        basis: ["plan-clarify", "plan-design", "repository"]
      }
    ]
  },
  next_action: { label: "Review and approve", recommended: true }
};

const baseArtifacts = createLiveAlignmentArtifactRefs({
  goal: { id: "goal-1", sha256: "a".repeat(64), storage_key: "artifacts/goal.json", media_type: "application/json", size_bytes: 1 },
  snapshot: { id: "snapshot-1", sha256: "a".repeat(64), storage_key: "artifacts/snapshot.json", media_type: "application/json", size_bytes: 1 },
  onboarding: { id: "onboarding-1", sha256: "a".repeat(64), storage_key: "artifacts/onboarding.json", media_type: "application/json", size_bytes: 1 },
  developerAnswers: [{ id: "answer-1", sha256: "a".repeat(64), storage_key: "artifacts/answer.json", media_type: "application/json", size_bytes: 1 }]
});

const descriptor = {
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
  executable_sha256: "a".repeat(64),
  profile_template_sha256: "a".repeat(64),
  control_plane_origins: ["https://api.example.com"],
  descriptor_sha256: "a".repeat(64)
};

const limits = {
  attempt_deadline_seconds: 600, max_active_execution_seconds: 3600, max_result_bytes: 1048576,
  max_stdout_bytes: 10485760, max_stderr_bytes: 10485760, max_retained_records: 20,
  max_retained_bytes: 20971520, max_temporary_bytes: 268435456, max_processes: 64,
  max_rss_bytes: 2147483648, cleanup_deadline_seconds: 30, max_research_queries: 5,
  max_sources_per_query: 5, max_research_requests: 25, max_redirects_per_request: 3,
  max_research_response_bytes: 2097152, max_research_bytes: 10485760,
  research_request_deadline_seconds: 30, max_agent_attempts: 6, max_provider_requests: 120,
  provider_request_deadline_seconds: 120, max_total_tokens: 600000
};

function buildOperation() {
  return buildLiveAlignmentOperation({
    run,
    goalArtifact: baseArtifacts.goal,
    snapshotArtifact: baseArtifacts.snapshot,
    onboardingArtifact: baseArtifacts.onboarding,
    agentDescriptor: descriptor,
    agentAuthoritySubject: { id: "subject-1", sha256: "a".repeat(64) },
    resultContractSha256: "a".repeat(64),
    limits,
    developerAnswerArtifacts: baseArtifacts.developerAnswers,
    inputCheckpointSha256: hashContract({ run_id: run.id, head_sha: run.current_head_sha })
  });
}

test("live alignment builds a stable operation and initializes a writable operation bundle", async () => {
  const operation = buildOperation();
  assert.equal(operation.id, stableLiveAlignmentOperationId({
    run_id: run.id,
    repository_identity: repositoryIdentity,
    commit_sha: run.current_head_sha,
    input_checkpoint_sha256: hashContract({ run_id: run.id, head_sha: run.current_head_sha }),
    original_goal: baseArtifacts.goal,
    developer_answers: baseArtifacts.developerAnswers,
    snapshot: baseArtifacts.snapshot,
    onboarding: baseArtifacts.onboarding,
    agent_descriptor: descriptor,
    agent_authority_subject: { id: "subject-1", sha256: "a".repeat(64) },
    result_contract_sha256: "a".repeat(64),
    limits
  }));

  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-"));
  const lease = buildLiveAlignmentLease(operation, {
    owner_id: "owner-1",
    boot_id: "boot-1",
    pid: 1234,
    process_birth_id: "birth-1"
  });
  const analysisPlan = buildLiveAlignmentAnalysisPlan({
    operation,
    goalArtifact: baseArtifacts.goal,
    snapshotArtifact: baseArtifacts.snapshot,
    onboardingArtifact: baseArtifacts.onboarding,
    onboardingPlan
  });
  assert.equal(analysisPlan.summary.execution_graph.node_count >= 1, true);
  const interactionPacket = buildLiveAlignmentInteractionPacket({
    operation,
    analysisPlan: analysisPlan.analysisPlan,
    analysisSummary: analysisPlan.summary,
    onboardingSummary: onboardingPlan.summary,
    goalArtifact: baseArtifacts.goal,
    snapshotArtifact: baseArtifacts.snapshot,
    onboardingArtifact: baseArtifacts.onboarding
  });
  assert.equal(interactionPacket.packet.sections.some((section) => section.title === "Quantitative summary"), true);
  assert.equal(interactionPacket.packet.sections.some((section) => section.title === "Crew split"), true);
  assert.equal(interactionPacket.packet.sections.some((section) => section.title === "Execution graph"), true);
  assert.equal(interactionPacket.packet.sections.some((section) => section.title === "Stage gates"), true);
  assert.equal(interactionPacket.packet.sections.some((section) => section.title === "Clarification queue"), true);
  assert.equal(interactionPacket.packet.sections.some((section) => section.title === "Preflight plan"), true);
  assert.match(interactionPacket.packet.sections.find((section) => section.title === "Crew split")?.items[0]?.text ?? "", /Discovery/);
  assert.match(interactionPacket.packet.sections.find((section) => section.title === "Execution graph")?.items[0]?.text ?? "", /next ready wave/i);
  assert.ok(interactionPacket.packet.sections.find((section) => section.title === "Execution graph")?.items.some((item) => item.id.startsWith("alignment-execution-graph-node-")));
  assert.match(interactionPacket.packet.sections.find((section) => section.title === "Quantitative summary")?.items.find((item) => item.id === "alignment-quantitative-stage-gates")?.text ?? "", /Stage gates: 0\/3 ready/);
  assert.deepEqual(interactionPacket.packet.sections.find((section) => section.title === "Quantitative summary")?.items.find((item) => item.id === "alignment-quantitative-database")?.metrics ?? null, {
    known_claims: 0,
    total_claims: 0,
    unknown_claims: 0,
    conflict_claims: 0
  });
  assert.match(interactionPacket.packet.sections.find((section) => section.title === "Stage gates")?.items[0]?.text ?? "", /Stage gate summary: 0\/3 ready/);
  assert.deepEqual(interactionPacket.packet.sections.find((section) => section.title === "Stage gates")?.items[0]?.basis ?? [], ["understanding", "scope", "capability", "testing", "acceptance", "delivery", "verification"]);
  assert.deepEqual(interactionPacket.packet.sections.find((section) => section.title === "Stage gates")?.items[1]?.basis ?? [], ["understanding", "scope", "capability"]);
  assert.match(interactionPacket.packet.sections.find((section) => section.title === "Clarification queue")?.items[0]?.text ?? "", /product decision/i);
  assert.match(interactionPacket.packet.sections.find((section) => section.title === "Clarification queue")?.items[2]?.text ?? "", /database surface/i);
  assert.match(interactionPacket.packet.sections.find((section) => section.title === "Preflight plan")?.items[0]?.text ?? "", /Preflight path: clarify 3 question\(s\)/);
  assert.deepEqual(interactionPacket.packet.sections.find((section) => section.title === "Preflight plan")?.items[0]?.basis ?? [], ["clarify", "research", "best-practices", "team-decomposition", "frontend", "plan-clarify", "plan-design", "repository"]);
  assert.match(interactionPacket.packet.sections.find((section) => section.title === "Preflight plan")?.items.find((item) => item.id === "alignment-preflight-research-1")?.text ?? "", /Research topic:/);
  assert.equal(interactionPacket.questions.length, 3);
  assert.equal(interactionPacket.decisions.length, 3);
  const status = buildLiveAlignmentStatus(operation, { status: "planned", analysis_plan_ref: { id: analysisPlan.analysisPlan.id, kind: "analysis-plan", sha256: hashContract(analysisPlan.analysisPlan), media_type: "application/json", size_bytes: 1, storage_key: "analysis-plan.json" } });
  const started = await startLiveAlignmentOperation({ dataRoot: root, repositoryIdentity, operation, analysisPlan: analysisPlan.analysisPlan, interactionPacket: interactionPacket.packet, status, lease });
  assert.equal(started.operation.id, operation.id);
  assert.equal(started.status.operation_id, operation.id);

  const bundle = await loadLiveAlignmentOperationBundle(root, repositoryIdentity, operation.id);
  assert.equal(bundle.operation.id, operation.id);
  assert.equal(bundle.analysisPlan.id, analysisPlan.analysisPlan.id);
  assert.equal(bundle.interactionPacket.id, interactionPacket.packet.id);
  assert.equal(bundle.status.status, "planned");
  assert.equal(bundle.lease.owner_id, "owner-1");
  assert.equal(bundle.status.analysis_plan_ref.id, analysisPlan.analysisPlan.id);
});

test("live alignment projects operation state through the phase machine", async () => {
  const operation = buildOperation();
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-"));
  await startLiveAlignmentOperation({
    dataRoot: root,
    repositoryIdentity,
    operation,
    status: buildLiveAlignmentStatus(operation, { status: "planned" })
  });

  const waiting = await projectLiveAlignmentOperationStatus(root, repositoryIdentity, operation.id, { agentAuthorityReady: false });
  assert.equal(waiting.status.status, "waiting-agent-authority");

  const running = await projectLiveAlignmentOperationStatus(root, repositoryIdentity, operation.id, { agentAuthorityReady: true });
  assert.equal(running.status.status, "running");

  const blocked = await projectLiveAlignmentOperationStatus(root, repositoryIdentity, operation.id, { blockingQuestions: 2 });
  assert.equal(blocked.status.status, "question-blocked");

  const ready = await projectLiveAlignmentOperationStatus(root, repositoryIdentity, operation.id, { acceptanceReady: true });
  assert.equal(ready.status.status, "ready");
});
