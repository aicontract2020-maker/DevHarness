import assert from "node:assert/strict";
import test from "node:test";

import { evaluateInteractionPacket } from "../../core/src/interaction-policy.mjs";
import { loadTrustedEvaluationContext } from "../../core/src/trusted-context.mjs";
import { projectValidatedAlignment } from "../src/live-alignment.mjs";

const repositoryIdentity = "example/project";
const commitSha = "b".repeat(40);
const hash = "a".repeat(64);
const now = "2026-09-01T18:00:00.000Z";

function artifact(id, kind) {
  return {
    id,
    kind,
    sha256: hash,
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

function trustedContext() {
  return loadTrustedEvaluationContext({
    snapshot: {
      repository: {
        identity: repositoryIdentity,
        git: { head_sha: commitSha, dirty: false }
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
    commit_sha: commitSha,
    goal_ref: goalRef,
    developer_answer_refs: developerAnswerRefs,
    agent_descriptor: {
      schema_version: 1,
      id: "codex",
      version: "1.0.0",
      protocol_version: 1,
      profile_id: "codex-readonly-analysis-v1",
      model_id: "gpt-approved",
      executable_version: "codex-1",
      modes: ["analysis-plan", "analysis-synthesis", "analysis-validation"],
      features: {
        structured_output: true,
        explicit_cancel: true,
        ephemeral_session: true,
        read_only_tool_policy: true,
        built_in_web_disable: true,
        trusted_usage: true
      },
      implementation_sha256: hash,
      executable_sha256: hash,
      profile_template_sha256: hash,
      control_plane_origins: ["https://api.example.com"],
      descriptor_sha256: hash
    },
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
      question(index, [[
        "deployment-behavior",
        "security-privacy-credential",
        "data-schema-migration",
        "externally-observable-behavior"
      ][index] ?? "acceptance-criterion"])
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

test("projecting a blocked bundle yields a bounded decision queue with answers preserved", async () => {
  const context = await trustedContext();
  const answerRef = artifact("developer-answer-1", "developer-answer");
  const result = await projectValidatedAlignment({
    bundle: bundleSeed({ developerAnswerRefs: [answerRef] }),
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
    trustContext: context,
    generatedAt: now
  });

  assert.equal(result.reasons.length > 0, true);
  assert.equal(result.bundle.verdict, "question-blocked");
  assert.equal(result.bundle.developer_answer_refs.length, 1);
  assert.equal(result.packet.kind, "decision-queue");
  assert.deepEqual(result.packet.sections.map((section) => section.title), [
    "Refined outcome",
    "Confirmed project/system understanding",
    "Boundaries/non-goals",
    "Acceptance criteria/proof gaps",
    "Questions to answer"
  ]);
  assert.equal(result.packet.decisions.length, 3);
  assert.deepEqual(result.packet.decisions.map((decision) => decision.id), ["question-2", "question-3", "question-4"]);
  assert.deepEqual(result.packet.actions.map((action) => action.kind), ["answer", "inspect"]);
  assert.equal(result.packet.actions.filter((action) => action.recommended).length, 1);
  assert.equal(result.packet.source_artifacts.some((artifact) => artifact.kind === "alignment-bundle"), true);
  assert.equal(result.packet.traceability.some((entry) => entry.item_id === "question-2"), true);
  assert.equal(result.packet.traceability.some((entry) => entry.item_id === "question-3"), true);
  assert.equal(result.packet.traceability.some((entry) => entry.item_id === "question-4"), true);
  assert.equal(evaluateInteractionPacket(result.packet).valid, true);
  assert.equal(result.packet.compression.omitted_item_count > 0, true);
});

test("projecting a ready bundle yields a brief with gate approval and no decisions", async () => {
  const context = await trustedContext();
  const result = await projectValidatedAlignment({
    bundle: bundleSeed(),
    goalAnalysis: goalAnalysis({ questionCount: 0 }),
    validation: validation({
      questionChecks: [],
      verdict: "valid"
    }),
    trustContext: context,
    generatedAt: now
  });

  assert.equal(result.reasons.length, 0);
  assert.equal(result.bundle.verdict, "ready");
  assert.deepEqual(result.packet.sections.map((section) => section.title), [
    "Refined outcome",
    "Confirmed project/system understanding",
    "Boundaries/non-goals",
    "Acceptance criteria/proof gaps"
  ]);
  assert.equal(result.packet.kind, "alignment-brief");
  assert.equal(result.packet.decisions.length, 0);
  assert.deepEqual(result.packet.attention.reasons, ["gate-approval"]);
  assert.deepEqual(result.packet.actions.map((action) => action.kind), ["approve", "inspect"]);
  assert.equal(result.packet.actions.filter((action) => action.recommended).length, 1);
  assert.equal(result.packet.source_artifacts.some((artifact) => artifact.kind === "alignment-bundle"), true);
  assert.equal(evaluateInteractionPacket(result.packet).valid, true);
});
