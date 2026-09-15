import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateInteractionPacket } from "../../core/src/interaction-policy.mjs";
import { loadTrustedEvaluationContext } from "../../core/src/trusted-context.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { projectValidatedAlignment } from "../../project/src/live-alignment.mjs";
import {
  buildLiveAlignmentAnalysisPlan,
  buildLiveAlignmentOperation,
  createLiveAlignmentArtifactRefs,
  loadLiveAlignmentOperationBundle,
  publishValidatedAlignment
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
    domain_knownness: {
      database: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} },
      frontend: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} },
      backend: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} }
    },
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

function artifact(id, kind) {
  return {
    id,
    kind,
    sha256: "a".repeat(64),
    media_type: "application/json",
    size_bytes: 1,
    storage_key: `artifacts/${id}.json`
  };
}

function sourceRef(artifactRef, pointer) {
  return {
    artifact_id: artifactRef.id,
    artifact_sha256: artifactRef.sha256,
    location: { kind: "json", pointer }
  };
}

function question(index, dimensions) {
  return {
    id: `question-${index + 1}`,
    question: `Question ${index + 1}?`,
    options: [
      {
        id: `question-${index + 1}-clarify`,
        label: "Clarify now",
        outcome: "Pause and ask the developer to confirm the missing decision.",
        tradeoffs: ["Prevents a hidden assumption from hardening into the plan.", "Adds a short pause for explicit human guidance."],
        recommended: true
      },
      {
        id: `question-${index + 1}-infer`,
        label: "Infer conservatively",
        outcome: "Continue with the safest conservative assumption and keep the question open.",
        tradeoffs: ["Keeps momentum if the risk is low.", "Can leave an assumption that later needs correction."],
        recommended: false
      }
    ],
    material_dimensions: dimensions,
    source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), `/questions/${index}`)]
  };
}

function finding(kind, id, summary, dimensions = ["acceptance-criterion"]) {
  return {
    id,
    kind,
    summary,
    material_dimensions: dimensions,
    source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), `/${kind}s/${id}`)]
  };
}

function claim(id, area, proposedClass, text) {
  return {
    id,
    area,
    text,
    proposed_class: proposedClass,
    source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), `/claims/${id}`)]
  };
}

function area(areaName, status) {
  return {
    id: `area-${areaName}`,
    area: areaName,
    proposed_status: status,
    summary: `${areaName} is ${status}.`,
    source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), `/areas/${areaName}`)]
  };
}

function criterion(id, proofSurface, then) {
  return {
    id,
    given: "A clear goal exists.",
    when: "analysis completes.",
    then,
    proof_surface: proofSurface,
    source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), `/criteria/${id}`)]
  };
}

async function trustedContext() {
  return loadTrustedEvaluationContext({
    snapshot: {
      repository: {
        identity: repositoryIdentity,
        git: { head_sha: run.current_head_sha, dirty: false }
      },
      detected: {
        platforms: ["web", "api"],
        services: ["PostgreSQL"],
        deployment_files: ["Dockerfile"],
        frameworks: ["Next.js"]
      }
    },
    goalImpact: {}
  });
}

function bundleSeed({ developerAnswerRefs = [] } = {}) {
  const goalRef = artifact("goal-1", "goal");
  const analysisPlanRef = artifact("analysis-plan-1", "analysis-plan");
  const goalAnalysisRef = artifact("goal-analysis-1", "goal-analysis");
  const validationRef = artifact("goal-analysis-validation-1", "analysis-validation");

  return {
    schema_version: 1,
    id: "alignment-bundle-1",
    operation_id: "operation-1",
    run_id: "run-1",
    repository_identity: repositoryIdentity,
    commit_sha: run.current_head_sha,
    goal_ref: goalRef,
    developer_answer_refs: developerAnswerRefs,
    agent_descriptor: descriptor,
    analysis_plan_ref: analysisPlanRef,
    research_source_refs: [],
    research_gaps: [],
    goal_analysis_ref: goalAnalysisRef,
    validation_ref: validationRef
  };
}

function goalAnalysis({ questionCount = 0 } = {}) {
  return {
    schema_version: 1,
    id: "goal-analysis-1",
    invocation_id: "analysis-invocation-1",
    operation_id: "operation-1",
    refined_outcome: { id: "outcome-1", text: "Deliver a trustworthy agent-ready development flow.", source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), "/outcome")] },
    affected_areas: [
      area("repository-bootstrap", "applicable"),
      area("frontend", "applicable"),
      area("backend", "applicable"),
      area("data", "applicable"),
      area("security", "applicable"),
      area("integration", "applicable"),
      area("testing", "applicable"),
      area("deployment", "applicable"),
      area("automation", "not-applicable")
    ],
    claims: [
      claim("claim-repository", "repository-bootstrap", "code-confirmed", "The repository structure is understood."),
      claim("claim-frontend", "frontend", "code-confirmed", "The frontend surface is understood."),
      claim("claim-backend", "backend", "code-confirmed", "The backend surface is understood."),
      claim("claim-data", "data", "code-confirmed", "The data model is understood."),
      claim("claim-security", "security", "code-confirmed", "The security model is understood."),
      claim("claim-testing", "testing", "code-confirmed", "The test model is understood.")
    ],
    assumptions: [finding("assumption", "assumption-1", "The repo remains on the current head.")],
    conflicts: [],
    boundaries: [
      { id: "boundary-1", text: "Do not edit the consumer repository.", source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), "/boundaries/0")] }
    ],
    non_goals: [
      { id: "non-goal-1", text: "Do not auto-merge or auto-deploy.", source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), "/non_goals/0")] }
    ],
    questions: Array.from({ length: questionCount }, (_, index) =>
      question(index, [
        "deployment-behavior",
        "security-privacy-credential",
        "data-schema-migration",
        "externally-observable-behavior"
      ])
    ),
    acceptance_criteria: [
      criterion("criterion-1", "browser", "The feature works in a browser."),
      criterion("criterion-2", "database", "The data flow is verified against a database."),
      criterion("criterion-3", "unit", "The module has focused unit tests.")
    ],
    untrusted_instructions: [],
    research_source_refs: [],
    research_gaps: []
  };
}

function validation({ questionChecks = [], verdict = "valid" } = {}) {
  const goalAnalysisRef = artifact("goal-analysis-1", "goal-analysis");
  return {
    schema_version: 1,
    id: "goal-analysis-validation-1",
    invocation_id: "validation-invocation-1",
    operation_id: "operation-1",
    producer_analysis_id: "goal-analysis-1",
    citation_checks: [
      { id: "citation-outcome", proposal_id: "claim-repository", source_ref: sourceRef(goalAnalysisRef, "/claims/0"), exists: true, supports: true, max_supported_class: "code-confirmed", finding_ids: [] },
      { id: "citation-frontend", proposal_id: "claim-frontend", source_ref: sourceRef(goalAnalysisRef, "/claims/1"), exists: true, supports: true, max_supported_class: "code-confirmed", finding_ids: [] },
      { id: "citation-backend", proposal_id: "claim-backend", source_ref: sourceRef(goalAnalysisRef, "/claims/2"), exists: true, supports: true, max_supported_class: "code-confirmed", finding_ids: [] },
      { id: "citation-data", proposal_id: "claim-data", source_ref: sourceRef(goalAnalysisRef, "/claims/3"), exists: true, supports: true, max_supported_class: "code-confirmed", finding_ids: [] },
      { id: "citation-security", proposal_id: "claim-security", source_ref: sourceRef(goalAnalysisRef, "/claims/4"), exists: true, supports: true, max_supported_class: "code-confirmed", finding_ids: [] },
      { id: "citation-testing", proposal_id: "claim-testing", source_ref: sourceRef(goalAnalysisRef, "/claims/5"), exists: true, supports: true, max_supported_class: "code-confirmed", finding_ids: [] }
    ],
    area_checks: [
      { id: "area-check-repository-bootstrap", area: "repository-bootstrap", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/repository-bootstrap")], finding_ids: [] },
      { id: "area-check-frontend", area: "frontend", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/frontend")], finding_ids: [] },
      { id: "area-check-backend", area: "backend", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/backend")], finding_ids: [] },
      { id: "area-check-data", area: "data", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/data")], finding_ids: [] },
      { id: "area-check-security", area: "security", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/security")], finding_ids: [] },
      { id: "area-check-integration", area: "integration", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/integration")], finding_ids: [] },
      { id: "area-check-testing", area: "testing", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/testing")], finding_ids: [] },
      { id: "area-check-deployment", area: "deployment", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/deployment")], finding_ids: [] },
      { id: "area-check-automation", area: "automation", applicable: false, covered: false, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/automation")], finding_ids: [] }
    ],
    question_checks: questionChecks,
    missing_items: [],
    prompt_injection_findings: [],
    verdict
  };
}

test("fresh validation produces a blocked decision queue and persists it as the runtime packet", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-synthesis-"));
  const operation = buildOperation();
  const analysisPlan = buildLiveAlignmentAnalysisPlan({
    operation,
    goalArtifact: baseArtifacts.goal,
    snapshotArtifact: baseArtifacts.snapshot,
    onboardingArtifact: baseArtifacts.onboarding,
    onboardingPlan
  });

  const result = await projectValidatedAlignment({
    bundle: bundleSeed({ developerAnswerRefs: [artifact("answer-1", "developer-answer")] }),
    goalAnalysis: goalAnalysis({ questionCount: 4 }),
    validation: validation({
      questionChecks: [
        { id: "check-1", question_id: "question-1", complete: true, material_dimensions: ["deployment-behavior"], source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), "/questions/0")], finding_ids: [] },
        { id: "check-2", question_id: "question-2", complete: true, material_dimensions: ["security-privacy-credential"], source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), "/questions/1")], finding_ids: [] },
        { id: "check-3", question_id: "question-3", complete: true, material_dimensions: ["data-schema-migration"], source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), "/questions/2")], finding_ids: [] },
        { id: "check-4", question_id: "question-4", complete: false, material_dimensions: ["externally-observable-behavior"], source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), "/questions/3")], finding_ids: ["question-4"] }
      ],
      verdict: "blocked"
    }),
    trustContext: await trustedContext(),
    generatedAt: "2026-09-01T18:00:00.000Z"
  });

  assert.equal(result.reasons.length > 0, true);
  assert.equal(result.bundle.verdict, "question-blocked");
  assert.equal(result.packet.kind, "decision-queue");
  assert.equal(result.packet.decisions.length, 3);
  assert.equal(evaluateInteractionPacket(result.packet).valid, true);

  const published = await publishValidatedAlignment({
    dataRoot: root,
    repositoryIdentity,
    operation,
    analysisPlan: analysisPlan.analysisPlan,
    bundle: bundleSeed({ developerAnswerRefs: [artifact("answer-1", "developer-answer")] }),
    goalAnalysis: goalAnalysis({ questionCount: 4 }),
    validation: validation({
      questionChecks: [
        { id: "check-1", question_id: "question-1", complete: true, material_dimensions: ["deployment-behavior"], source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), "/questions/0")], finding_ids: [] },
        { id: "check-2", question_id: "question-2", complete: true, material_dimensions: ["security-privacy-credential"], source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), "/questions/1")], finding_ids: [] },
        { id: "check-3", question_id: "question-3", complete: true, material_dimensions: ["data-schema-migration"], source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), "/questions/2")], finding_ids: [] },
        { id: "check-4", question_id: "question-4", complete: false, material_dimensions: ["externally-observable-behavior"], source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), "/questions/3")], finding_ids: ["question-4"] }
      ],
      verdict: "blocked"
    }),
    trustContext: await trustedContext(),
    generatedAt: "2026-09-01T18:00:00.000Z"
  });

  const bundle = await loadLiveAlignmentOperationBundle(root, repositoryIdentity, operation.id);
  assert.equal(published.packet.id, result.packet.id);
  assert.equal(published.result_bundle_ref.kind, "alignment-bundle");
  assert.equal(bundle.interactionPacket.id, published.packet.id);
  assert.equal(bundle.analysisPlan.id, analysisPlan.analysisPlan.id);
  assert.equal(bundle.status.analysis_plan_ref.id, analysisPlan.analysisPlan.id);
  assert.equal(bundle.status.result_bundle_ref.id, published.result_bundle_ref.id);
});

test("fresh validation can publish a ready Alignment Brief without developer decisions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-synthesis-"));
  const operation = buildOperation();
  const analysisPlan = buildLiveAlignmentAnalysisPlan({
    operation,
    goalArtifact: baseArtifacts.goal,
    snapshotArtifact: baseArtifacts.snapshot,
    onboardingArtifact: baseArtifacts.onboarding,
    onboardingPlan
  });

  const result = await projectValidatedAlignment({
    bundle: bundleSeed(),
    goalAnalysis: goalAnalysis({ questionCount: 0 }),
    validation: validation({ questionChecks: [], verdict: "valid" }),
    trustContext: await trustedContext(),
    generatedAt: "2026-09-01T18:00:00.000Z"
  });

  assert.equal(result.reasons.length, 0);
  assert.equal(result.bundle.verdict, "ready");
  assert.equal(result.packet.kind, "alignment-brief");
  assert.equal(result.packet.decisions.length, 0);
  assert.deepEqual(result.packet.attention.reasons, ["gate-approval"]);
  assert.equal(evaluateInteractionPacket(result.packet).valid, true);

  const published = await publishValidatedAlignment({
    dataRoot: root,
    repositoryIdentity,
    operation,
    analysisPlan: analysisPlan.analysisPlan,
    bundle: bundleSeed(),
    goalAnalysis: goalAnalysis({ questionCount: 0 }),
    validation: validation({ questionChecks: [], verdict: "valid" }),
    trustContext: await trustedContext(),
    generatedAt: "2026-09-01T18:00:00.000Z"
  });

  const bundle = await loadLiveAlignmentOperationBundle(root, repositoryIdentity, operation.id);
  assert.equal(bundle.interactionPacket.kind, "alignment-brief");
  assert.equal(bundle.interactionPacket.id, published.packet.id);
  assert.equal(bundle.analysisPlan.id, analysisPlan.analysisPlan.id);
  assert.equal(bundle.status.result_bundle_ref.kind, "alignment-bundle");
  assert.equal(bundle.status.result_bundle_ref.id, published.result_bundle_ref.id);
});
