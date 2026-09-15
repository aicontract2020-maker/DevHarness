import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { hashContract } from "../../project/src/harness.mjs";
import {
  buildLiveAlignmentAnalysisPlan,
  buildLiveAlignmentInteractionPacket,
  buildLiveAlignmentLease,
  buildLiveAlignmentOperation,
  buildLiveAlignmentStatus,
  createLiveAlignmentArtifactRefs,
  loadLiveAlignmentOperationBundle,
  startLiveAlignmentOperation
} from "../src/live-alignment.mjs";
import { continueLiveAlignmentOperation, unresolvedLiveAlignmentDecisions } from "../src/live-alignment-continue.mjs";
import { loadAlignmentOperationJournal } from "../src/alignment-operation-store.mjs";
import { reconcileLiveAlignmentOperation } from "../src/live-alignment.mjs";

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
  blockers: [{ id: "blocker-1", summary: "Need a product decision.", source_refs: ["package.json"] }],
  preflight: {
    clarification_questions: [
      { id: "clarify-1", blocker_id: "blocker-1", question: "What product decision do we need before implementation can proceed?", priority: 1, basis: ["plan-clarify", "goal-clarify", "blocker-1"] }
    ],
    research_topics: [{
      id: "research-framework-best-practices",
      purpose: "Review framework best practices before implementation starts.",
      query: "Official best practices for Next.js routing",
      owner: "frontend",
      priority: 2,
      expected_outcome: "Keep implementation choices consistent with public guidance.",
      public_identifiers: ["Next.js"],
      basis: ["research", "best-practices", "frontend"]
    }],
    research_tasks: [{
      id: "research-task-1",
      topic_id: "research-framework-best-practices",
      query: "Official best practices for Next.js routing",
      owner: "frontend",
      priority: 2,
      approval_capability: "network-research",
      status: "pending-approval",
      expected_outcome: "Keep implementation choices consistent with public guidance.",
      basis: ["research", "best-practices", "frontend"]
    }],
    team_decomposition: [{
      id: "team-discovery",
      label: "Discovery",
      focus: "Resolve repository and goal ambiguities before implementation starts.",
      task_ids: ["goal-clarify", "goal-design"],
      exit_criteria: "All material questions are either answered or explicitly approved as assumptions.",
      basis: ["plan-clarify", "plan-design", "repository"]
    }]
  },
  next_action: { label: "Review and approve", recommended: true }
};

const baseArtifacts = createLiveAlignmentArtifactRefs({
  goal: { id: "goal-1", sha256: "a".repeat(64), storage_key: "artifacts/goal.json", media_type: "application/json", size_bytes: 1 },
  snapshot: { id: "snapshot-1", sha256: "a".repeat(64), storage_key: "artifacts/snapshot.json", media_type: "application/json", size_bytes: 1 },
  onboarding: { id: "onboarding-1", sha256: "a".repeat(64), storage_key: "artifacts/onboarding.json", media_type: "application/json", size_bytes: 1 }
});

const descriptor = {
  schema_version: 1,
  id: "scripted",
  version: "1.0.0",
  protocol_version: 1,
  profile_id: "scripted-readonly-analysis-v1",
  model_id: "gpt-approved",
  executable_version: "scripted-1",
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
    inputCheckpointSha256: hashContract({ run_id: run.id, head_sha: run.current_head_sha })
  });
}

function snapshotFor(root) {
  return {
    schema_version: 1,
    captured_at: "2026-09-15T12:00:00.000Z",
    repository: {
      name: "demo",
      root_uri: pathToFileURL(root).href,
      identity: repositoryIdentity,
      git: {
        is_repository: true,
        head_sha: run.current_head_sha,
        branch: "main",
        dirty: false,
        changed_file_count: 0,
        remote_hosts: []
      }
    },
    inventory: { file_count: 1, manifests: [], lockfiles: [] },
    detected: { platforms: ["web"], languages: ["JavaScript"], frameworks: ["Next.js"], package_managers: [], services: [], test_tools: [], ci_files: [], deployment_files: [], agent_files: [] },
    commands: [],
    environment: { example_files: [], local_files: [], declared_keys: [], locally_set_keys: [], local_files_ignored: true },
    submodules: []
  };
}

function makeRegistry(resultPathWriter) {
  return {
    async start(name, { executionContext }) {
      assert.equal(name, "scripted");
      await resultPathWriter(executionContext.resultPath);
      return {
        started_at: "2026-09-15T12:00:00.000Z",
        completed_at: "2026-09-15T12:00:05.000Z",
        exit_code: 0,
        status: "succeeded",
        termination_reason: "completed",
        result_path: executionContext.resultPath,
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        adapter_diagnostics: []
      };
    },
    async cancel() {},
    async probe() { return descriptor; }
  };
}

const approvedCapabilities = {
  capabilities: [
    { request: { id: "agent-runtime", capability: "agent-runtime" }, status: "approved" },
    { request: { id: "research-task-1", capability: "network-research" }, status: "approved" }
  ],
  research_tasks: [{ id: "research-task-1", status: "approved", query: "Official best practices for Next.js routing" }]
};

async function startBundle(t, { status, leaseExpiresAt, includeQuestions = true }) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-live-continue-"));
  const consumerRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-live-continue-consumer-"));
  t.after(() => Promise.all([rm(dataRoot, { recursive: true, force: true }), rm(consumerRoot, { recursive: true, force: true })]));
  await writeFile(path.join(consumerRoot, "tracked.txt"), "tracked\n");
  const operation = buildOperation();
  const plan = buildLiveAlignmentAnalysisPlan({
    operation,
    goalArtifact: baseArtifacts.goal,
    snapshotArtifact: baseArtifacts.snapshot,
    onboardingArtifact: baseArtifacts.onboarding,
    onboardingPlan
  });
  const interactionPacket = buildLiveAlignmentInteractionPacket({
    operation,
    analysisPlan: plan.analysisPlan,
    analysisSummary: plan.summary,
    onboardingSummary: onboardingPlan.summary,
    goalArtifact: baseArtifacts.goal,
    snapshotArtifact: baseArtifacts.snapshot,
    onboardingArtifact: baseArtifacts.onboarding
  });
  if (!includeQuestions) interactionPacket.packet.decisions = [];
  const lease = buildLiveAlignmentLease(operation, {
    owner_id: "owner-stale",
    boot_id: "boot-stale",
    pid: 1234,
    process_birth_id: "birth-stale",
    acquired_at: "2026-09-01T11:58:00.000Z",
    wall_expires_at: leaseExpiresAt,
    heartbeat_at: "2026-09-01T11:58:00.000Z"
  });
  await startLiveAlignmentOperation({
    dataRoot,
    repositoryIdentity,
    operation,
    analysisPlan: plan.analysisPlan,
    interactionPacket: interactionPacket.packet,
    status: buildLiveAlignmentStatus(operation, {
      status,
      active_phase: "analysis-plan",
      analysis_plan_ref: {
        id: plan.analysisPlan.id,
        kind: "analysis-plan",
        sha256: hashContract(plan.analysisPlan),
        media_type: "application/json",
        size_bytes: 1,
        storage_key: "analysis-plan.json"
      }
    }),
    lease
  });
  return { dataRoot, consumerRoot, operation, plan };
}

test("continue reacquires an expired dead lease and does not TIMEOUT-fail the operation", async (t) => {
  const { dataRoot, consumerRoot, operation } = await startBundle(t, {
    status: "running",
    leaseExpiresAt: "2026-09-01T11:59:00.000Z",
    includeQuestions: true
  });
  const owner = { owner_id: "owner-live", boot_id: "boot-live", pid: 4321, process_birth_id: "birth-live" };
  const result = await continueLiveAlignmentOperation({
    dataRoot,
    repositoryIdentity,
    runId: run.id,
    snapshot: snapshotFor(consumerRoot),
    now: () => new Date("2026-09-01T12:10:00.000Z"),
    isOwnerAlive: async () => false,
    owner,
    capabilityView: approvedCapabilities
  });
  assert.equal(result.status.status, "question-blocked");
  assert.equal(result.status.terminal_error, null);
  assert.equal(result.lease.owner_id, "owner-live");
  assert.equal(result.lease.pid, 4321);
  assert.equal(result.unresolved_decisions.length >= 1, true);
  const journal = await loadAlignmentOperationJournal(dataRoot, repositoryIdentity, operation.id);
  assert.equal(journal.records.some((record) => record.type === "operation-failed"), false);
  const afterReconcile = await reconcileLiveAlignmentOperation({
    dataRoot,
    repositoryIdentity,
    operationId: operation.id,
    isOwnerAlive: async () => true,
    now: () => new Date("2026-09-01T12:10:01.000Z")
  });
  assert.equal(afterReconcile.status.status, "question-blocked");
});

test("continue binds research subject, runs the gateway, and ticks the agent worker", async (t) => {
  const { dataRoot, consumerRoot, operation } = await startBundle(t, {
    status: "running",
    leaseExpiresAt: "2026-09-01T11:59:00.000Z",
    includeQuestions: false
  });
  const owner = { owner_id: "owner-live", boot_id: "boot-live", pid: 4321, process_birth_id: "birth-live" };
  const origin = "https://docs.example.com";
  const fetched = [];
  const result = await continueLiveAlignmentOperation({
    dataRoot,
    repositoryIdentity,
    runId: run.id,
    snapshot: snapshotFor(consumerRoot),
    now: () => new Date("2026-09-01T12:10:00.000Z"),
    isOwnerAlive: async () => false,
    owner,
    capabilityView: approvedCapabilities,
    researchRecipes: [{
      taskId: "research-task-1",
      origin,
      url: `${origin}/guide`,
      originId: "docs",
      originSourceSha256: "b".repeat(64)
    }],
    researchAuthority: {
      capability: "network-research",
      request_id: "authority-request-1",
      receipt_id: "authority-receipt-1",
      request_sha256: "d".repeat(64),
      receipt_sha256: "e".repeat(64),
      approved_at: "2026-09-01T12:00:00.000Z",
      expires_at: "2026-09-01T13:00:00.000Z",
      epoch: 1
    },
    fetchImpl: async (url) => {
      fetched.push(url);
      return new Response("<html><title>Best Practices</title><body>Hello World</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    },
    adapterRegistry: makeRegistry(async (resultPath) => {
      await writeFile(resultPath, JSON.stringify({ ok: true, phase: "analysis-plan" }));
    })
  });

  // researchAuthority.subject_sha256 was pending; bind happens inside continue and authority must match.
  // If continue rejected, retry with the bound subject from the first error — assert bound path below.
  assert.equal(result.status.research_subject_ref?.kind, "network-research-subject");
  assert.equal(result.status.research_authority_epoch, 1);
  assert.equal(result.status.agent_attempts, 1);
  assert.equal(result.worker.worker.attempt.status, "succeeded");
  assert.equal(result.status.status, "running");
  assert.equal(result.status.active_phase, "analysis-synthesis");
  assert.equal(fetched[0], `${origin}/guide`);
  assert.equal(result.research[0].manifest.outcome, "success");
  const journal = await loadAlignmentOperationJournal(dataRoot, repositoryIdentity, operation.id);
  assert.equal(journal.records.some((record) => record.type === "research-subject-created"), true);
  assert.equal(journal.records.some((record) => record.type === "research-authority-attached"), true);
  assert.equal(journal.records.some((record) => record.type === "phase-started"), true);
  assert.equal(journal.records.some((record) => record.type === "phase-finished"), true);
  assert.equal(unresolvedLiveAlignmentDecisions(result.bundle.interactionPacket, result.bundle.developerAnswers).length, 0);
  const reloaded = await loadLiveAlignmentOperationBundle(dataRoot, repositoryIdentity, operation.id);
  assert.equal(reloaded.lease.owner_id, "owner-live");
});

test("continue reports a missing adapter without failing the operation", async (t) => {
  const { dataRoot, consumerRoot, operation } = await startBundle(t, {
    status: "running",
    leaseExpiresAt: "2026-09-01T11:59:00.000Z",
    includeQuestions: false
  });
  const result = await continueLiveAlignmentOperation({
    dataRoot,
    repositoryIdentity,
    runId: run.id,
    snapshot: snapshotFor(consumerRoot),
    now: () => new Date("2026-09-01T12:10:00.000Z"),
    isOwnerAlive: async () => false,
    owner: { owner_id: "owner-live", boot_id: "boot-live", pid: 4321, process_birth_id: "birth-live" },
    capabilityView: approvedCapabilities
  });
  assert.equal(result.status.status, "running");
  assert.equal(result.status.terminal_error, null);
  assert.equal(result.status.agent_attempts, 0);
  assert.equal(result.blockers.some((blocker) => /adapter/i.test(blocker)), true);
  assert.equal(result.blockers.some((blocker) => /recipes/i.test(blocker)), true);
  const journal = await loadAlignmentOperationJournal(dataRoot, repositoryIdentity, operation.id);
  assert.equal(journal.records.some((record) => record.type === "operation-failed"), false);
});

test("continue binds multiple HTTPS recipes and ticks the local readonly adapter name", async (t) => {
  const { dataRoot, consumerRoot, operation } = await startBundle(t, {
    status: "running",
    leaseExpiresAt: "2026-09-01T11:59:00.000Z",
    includeQuestions: false
  });
  // Rewrite the operation agent id onto the stored bundle is unnecessary: continue resolves adapterName from the argument.
  const { createLocalReadonlyAnalysisAdapter, LOCAL_READONLY_ADAPTER_ID } = await import("../../../adapters/agents/local-readonly/index.mjs");
  const { AgentAdapterRegistry } = await import("../src/agent-adapter.mjs");
  const registry = new AgentAdapterRegistry().register(LOCAL_READONLY_ADAPTER_ID, createLocalReadonlyAnalysisAdapter({
    clock: () => new Date("2026-09-01T12:10:00.000Z")
  }));
  const result = await continueLiveAlignmentOperation({
    dataRoot,
    repositoryIdentity,
    runId: run.id,
    snapshot: snapshotFor(consumerRoot),
    now: () => new Date("2026-09-01T12:10:00.000Z"),
    isOwnerAlive: async () => false,
    owner: { owner_id: "owner-live", boot_id: "boot-live", pid: 4321, process_birth_id: "birth-live" },
    capabilityView: {
      capabilities: [
        { request: { id: "agent-runtime", capability: "agent-runtime" }, status: "approved" },
        { request: { id: "research-task-1", capability: "network-research" }, status: "approved" },
        { request: { id: "research-task-2", capability: "network-research" }, status: "approved" }
      ],
      research_tasks: [
        { id: "research-task-1", status: "approved", query: "Official best practices for Next.js routing" },
        { id: "research-task-2", status: "approved", query: "Official Docker security guidance" }
      ]
    },
    researchRecipes: [
      { taskId: "research-task-1", origin: "https://nextjs.org", url: "https://nextjs.org/docs/app/getting-started", originId: "nextjs" },
      { taskId: "research-task-2", origin: "https://docs.docker.com", url: "https://docs.docker.com/engine/security/", originId: "docker" }
    ],
    adapterRegistry: registry,
    adapterName: LOCAL_READONLY_ADAPTER_ID
  });
  assert.equal(result.status.research_subject_ref?.kind, "network-research-subject");
  assert.equal(result.status.agent_attempts, 1);
  assert.equal(result.worker.worker.attempt.status, "succeeded");
  assert.equal(result.status.active_phase, "analysis-synthesis");
  assert.equal(result.blockers.some((blocker) => /authority receipt/i.test(blocker)), true);
});



test("continue auto-attaches network-research authority from capability receipts onto the bound subject", async (t) => {
  const { approvalRequestHash } = await import("../../core/src/approval-policy.mjs");
  const { initializeSupervisorIdentity, attestApprovalReceipt, writeApprovalReceipt } = await import("../src/supervisor-store.mjs");
  const { createSupervisorApprovalRequest } = await import("../src/supervisor-approval.mjs");
  const { dataRoot, consumerRoot, operation } = await startBundle(t, {
    status: "running",
    leaseExpiresAt: "2026-09-01T11:59:00.000Z",
    includeQuestions: false
  });
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-continue-auth-sup-"));
  t.after(() => rm(supervisorRoot, { recursive: true, force: true }));
  await initializeSupervisorIdentity(supervisorRoot, { now: () => new Date("2026-09-01T12:00:00.000Z") });

  const request = await createSupervisorApprovalRequest({
    supervisorRoot,
    repositoryIdentity,
    relevantHeadSha: run.current_head_sha,
    runId: run.id,
    gate: "capability",
    subject: { id: "research-task-1", artifact_sha256: hashContract({ id: "research-task-1", capability: "network-research" }) },
    expiresInMinutes: 60,
    now: () => new Date("2026-09-01T12:00:00.000Z")
  });
  const receipt = await attestApprovalReceipt(supervisorRoot, {
    schema_version: 1,
    id: "approval-receipt-continue-research-1",
    request_id: request.id,
    request_sha256: approvalRequestHash(request),
    run_id: request.run_id,
    repository_identity: request.repository_identity,
    relevant_head_sha: request.relevant_head_sha,
    gate: "capability",
    subject: structuredClone(request.subject),
    nonce: request.nonce,
    decision: "approved",
    decided_at: "2026-09-01T12:01:00.000Z",
    decided_by: { id: "developer", kind: "human" },
    source: "interactive-human-gate",
    expires_at: request.expires_at
  });
  await writeApprovalReceipt(supervisorRoot, repositoryIdentity, receipt);

  const origin = "https://docs.example.com";
  const fetched = [];
  const result = await continueLiveAlignmentOperation({
    dataRoot,
    repositoryIdentity,
    runId: run.id,
    snapshot: snapshotFor(consumerRoot),
    supervisorRoot,
    now: () => new Date("2026-09-01T12:10:00.000Z"),
    isOwnerAlive: async () => false,
    owner: { owner_id: "owner-live", boot_id: "boot-live", pid: 4321, process_birth_id: "birth-live" },
    capabilityView: {
      capabilities: [
        { request: { id: "agent-runtime", capability: "agent-runtime" }, status: "approved" },
        {
          request: { id: "research-task-1", capability: "network-research" },
          status: "approved",
          approval_request_id: request.id,
          approval_receipt_id: receipt.id
        }
      ],
      research_tasks: [
        { id: "research-task-1", status: "approved", query: "Official best practices for Next.js routing", approval_receipt_id: receipt.id }
      ]
    },
    researchRecipes: [{
      taskId: "research-task-1",
      origin,
      url: `${origin}/guide`,
      originId: "docs",
      originSourceSha256: "b".repeat(64)
    }],
    fetchImpl: async (url) => {
      fetched.push(url);
      return new Response("<html><title>Best Practices</title><body>Hello World</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    },
    adapterRegistry: makeRegistry(async (resultPath) => {
      await writeFile(resultPath, JSON.stringify({ ok: true, phase: "analysis-plan" }));
    })
  });

  assert.equal(result.status.research_subject_ref?.kind, "network-research-subject");
  assert.equal(result.status.research_authority_epoch, 1);
  assert.equal(fetched[0], `${origin}/guide`);
  assert.equal(result.research[0]?.manifest?.outcome, "success");
  assert.equal(result.research[0]?.source?.network_authority_ref?.receipt_id, receipt.id);
  assert.equal(
    result.research[0]?.source?.network_authority_ref?.subject_sha256,
    result.status.research_subject_ref.sha256
  );
  const journal = await loadAlignmentOperationJournal(dataRoot, repositoryIdentity, operation.id);
  assert.equal(journal.records.some((record) => record.type === "research-authority-attached"), true);
  assert.equal(result.blockers.some((blocker) => /authority receipt/i.test(blocker)), false);
});

test("continue leaves analysis-validation with local-readonly artifacts and a ready bundle", async (t) => {
  const { dataRoot, consumerRoot, operation } = await startBundle(t, {
    status: "running",
    leaseExpiresAt: "2026-09-01T11:59:00.000Z",
    includeQuestions: false
  });
  const { createLocalReadonlyAnalysisAdapter, LOCAL_READONLY_ADAPTER_ID } = await import("../../../adapters/agents/local-readonly/index.mjs");
  const { AgentAdapterRegistry } = await import("../src/agent-adapter.mjs");
  const registry = new AgentAdapterRegistry().register(LOCAL_READONLY_ADAPTER_ID, createLocalReadonlyAnalysisAdapter({
    clock: () => new Date("2026-09-01T12:10:00.000Z")
  }));
  const owner = { owner_id: "owner-live", boot_id: "boot-live", pid: 4321, process_birth_id: "birth-live" };
  const tick = async () => continueLiveAlignmentOperation({
    dataRoot,
    repositoryIdentity,
    runId: run.id,
    snapshot: snapshotFor(consumerRoot),
    now: () => new Date("2026-09-01T12:10:00.000Z"),
    isOwnerAlive: async () => false,
    owner,
    capabilityView: {
      capabilities: [
        { request: { id: "agent-runtime", capability: "agent-runtime" }, status: "approved" }
      ],
      research_tasks: []
    },
    adapterRegistry: registry,
    adapterName: LOCAL_READONLY_ADAPTER_ID
  });
  const plan = await tick();
  assert.equal(plan.status.active_phase, "analysis-synthesis");
  const synthesis = await tick();
  assert.equal(synthesis.status.active_phase, "analysis-validation");
  const validation = await tick();
  assert.equal(validation.status.status, "ready");
  assert.equal(validation.status.active_phase, null);
  assert.equal(validation.status.result_bundle_ref?.kind, "alignment-bundle");
  assert.equal(validation.bundle.interactionPacket.kind, "alignment-brief");
  assert.equal(validation.bundle.interactionPacket.verdict, "ready");
});

test("continue ticks an injected Codex adapter through the worker contract", async (t) => {
  const { dataRoot, consumerRoot } = await startBundle(t, {
    status: "running",
    leaseExpiresAt: "2026-09-01T11:59:00.000Z",
    includeQuestions: false
  });
  const { createCodexAdapter } = await import("../../../adapters/agents/codex/index.mjs");
  const { AgentAdapterRegistry } = await import("../src/agent-adapter.mjs");
  const { defaultCodexProfile } = await import("../src/codex-runtime.mjs");
  const profile = defaultCodexProfile({ DEVHARNESS_CODEX_MODEL: "gpt-approved" });
  const spawnCalls = [];
  const proxyCalls = [];
  const adapter = createCodexAdapter({
    profile,
    implementationBytes: Buffer.from("codex-adapter-test"),
    async inspectExecutable() {
      return { path: "/opt/codex", version: "codex-cli 1.2.3", bytes: Buffer.from("codex-executable") };
    },
    async spawnProcess(request) {
      spawnCalls.push(request);
      const resultPath = request.argv[request.argv.indexOf("--output-last-message") + 1];
      await writeFile(resultPath, `${JSON.stringify({ schema_version: 1, phase: "analysis-plan", summary: "injected Codex result" })}\n`);
      return {
        completion: Promise.resolve({
          exitCode: 0,
          startedAt: "2026-09-01T12:10:00.000Z",
          completedAt: "2026-09-01T12:10:05.000Z",
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 }
        }),
        async kill() {}
      };
    },
    async resultFileExists(target) {
      try {
        await (await import("node:fs/promises")).access(target);
        return true;
      } catch {
        return false;
      }
    }
  });
  const registry = new AgentAdapterRegistry().register("codex", adapter);
  const result = await continueLiveAlignmentOperation({
    dataRoot,
    repositoryIdentity,
    runId: run.id,
    snapshot: snapshotFor(consumerRoot),
    now: () => new Date("2026-09-01T12:10:00.000Z"),
    isOwnerAlive: async () => false,
    owner: { owner_id: "owner-codex", boot_id: "boot-codex", pid: 7777, process_birth_id: "birth-codex" },
    capabilityView: approvedCapabilities,
    adapterRegistry: registry,
    adapterName: "codex",
    providerCredential: "sk-test-parent",
    environment: { OPENAI_API_KEY: "sk-test-parent", DEVHARNESS_CODEX_MODEL: "gpt-approved" },
    codexProfile: profile,
    async startProviderProxy(options) {
      proxyCalls.push(options);
      return { server: { close(cb) { cb?.(); } }, port: 43199, token: options.childToken, origin: "http://127.0.0.1:43199" };
    }
  });
  assert.equal(result.worker.worker.attempt.status, "succeeded");
  assert.equal(result.status.active_phase, "analysis-synthesis");
  assert.equal(spawnCalls.length, 1);
  assert.equal(proxyCalls.length, 1);
  assert.equal(proxyCalls[0].parentCredential, "sk-test-parent");
  assert.equal(spawnCalls[0].argv.includes("gpt-approved"), true);
  assert.equal(spawnCalls[0].env.DEVHARNESS_PROXY_TOKEN, proxyCalls[0].childToken);
  assert.match(spawnCalls[0].stdin, /"phase":"analysis-plan"/);
  assert.equal(spawnCalls[0].stdin.includes("sk-test-parent"), false);
});

test("continue reports AUTH_UNAVAILABLE for Codex without a parent credential", async (t) => {
  const { dataRoot, consumerRoot } = await startBundle(t, {
    status: "running",
    leaseExpiresAt: "2026-09-01T11:59:00.000Z",
    includeQuestions: false
  });
  const { createCodexAdapter } = await import("../../../adapters/agents/codex/index.mjs");
  const { AgentAdapterRegistry } = await import("../src/agent-adapter.mjs");
  const { defaultCodexProfile } = await import("../src/codex-runtime.mjs");
  const registry = new AgentAdapterRegistry().register("codex", createCodexAdapter({
    profile: defaultCodexProfile({}),
    implementationBytes: Buffer.from("codex-adapter-test"),
    async inspectExecutable() {
      return { path: "/opt/codex", version: "1.0.0", bytes: Buffer.from("codex") };
    },
    async spawnProcess() { throw new Error("Codex must not spawn without auth"); }
  }));
  const result = await continueLiveAlignmentOperation({
    dataRoot,
    repositoryIdentity,
    runId: run.id,
    snapshot: snapshotFor(consumerRoot),
    now: () => new Date("2026-09-01T12:10:00.000Z"),
    isOwnerAlive: async () => false,
    owner: { owner_id: "owner-codex", boot_id: "boot-codex", pid: 7777, process_birth_id: "birth-codex" },
    capabilityView: approvedCapabilities,
    adapterRegistry: registry,
    adapterName: "codex",
    environment: { PATH: "/usr/bin:/bin" },
    async startProviderProxy() { throw new Error("proxy must not start"); }
  });
  assert.equal(result.worker, null);
  assert.equal(result.status.terminal_error, null);
  assert.equal(result.status.status, "running");
  assert.equal(result.blockers.some((blocker) => /OPENAI_API_KEY or DEVHARNESS_PROVIDER_CREDENTIAL/.test(blocker)), true);
});
