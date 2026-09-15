import { hashContract } from "../../project/src/harness.mjs";
import {
  buildLiveAlignmentInteractionPacket,
  buildLiveAlignmentLease,
  buildLiveAlignmentOperation,
  buildLiveAlignmentStatus
} from "../src/live-alignment.mjs";

const hash = "a".repeat(64);

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

export function makeLiveAlignmentFixture({ adapterId, authorityId, answerLabel }) {
  const goalArtifact = artifact("goal-1", "goal");
  const snapshotArtifact = artifact("snapshot-1", "snapshot");
  const onboardingArtifact = artifact("onboarding-1", "onboarding");
  const resultContractSha256 = hashContract({ answerLabel, kind: "result-contract" });
  const limits = {
    wall_ms: 120_000,
    stdout_bytes: 32_768,
    stderr_bytes: 32_768,
    result_bytes: 1_048_576,
    total_tokens: 2_048
  };
  const operation = buildLiveAlignmentOperation({
    run: {
      id: "run-1",
      repository: { identity: "example/project" },
      current_head_sha: "b".repeat(40)
    },
    goalArtifact,
    snapshotArtifact,
    onboardingArtifact,
    agentDescriptor: {
      schema_version: 1,
      id: adapterId,
      version: "1.0.0",
      protocol_version: 1,
      profile_id: `${adapterId}-read-only`,
      model_id: "gpt-approved",
      executable_version: `${adapterId}-1.0.0`,
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
      descriptor_sha256: hashContract({ adapterId, kind: "descriptor" })
    },
    agentAuthoritySubject: {
      id: authorityId,
      subject_sha256: hashContract({ authorityId, kind: "authority" }),
      label: authorityId
    },
    resultContractSha256,
    limits,
    developerAnswerArtifacts: []
  });

  const analysisPlan = {
    id: "analysis-plan-1",
    invocation_id: "analysis-plan-invocation-1",
    operation_id: operation.id,
    questions: [
      {
        id: "question-1",
        question: "Should the agent proceed with the default browser pack?",
        options: [
          {
            id: "question-1-clarify",
            label: "Clarify now",
            outcome: "Pause and ask the developer to confirm the missing decision.",
            tradeoffs: ["Prevents a hidden assumption from hardening into the plan.", "Adds a short pause for explicit human guidance."],
            recommended: true
          },
          {
            id: "question-1-infer",
            label: "Infer conservatively",
            outcome: "Continue with the safest conservative assumption and keep the question open.",
            tradeoffs: ["Keeps momentum if the risk is low.", "Can leave an assumption that later needs correction."],
            recommended: false
          }
        ],
        source_refs: [sourceRef(goalArtifact, "/questions/0")]
      }
    ],
    clarification_questions: [
      {
        id: "clarify-1",
        question: "Which surface should be used for the first real-browser check?",
        basis: ["browser"]
      }
    ],
    research_topics: [
      {
        id: "research-topic-1",
        purpose: "Review best practices for agent-native review pages.",
        query: "agent-native review page best practices",
        expected_outcome: "A concise set of UI conventions and trust signals.",
        basis: ["best-practices", "review"],
        public_identifiers: ["Playwright", "browser QA"]
      }
    ],
    research_tasks: [
      {
        id: "research-task-1",
        topic_id: "research-topic-1",
        query: "agent-native review page best practices",
        owner: "researcher",
        priority: 1,
        approval_capability: "network-research",
        status: "approved",
        expected_outcome: "A concise set of UI conventions and trust signals.",
        basis: ["best-practices", "review"]
      }
    ],
    team_decomposition: [
      {
        id: "team-1",
        label: "Implementer",
        focus: "Build the page and mapping surface.",
        task_ids: ["task-1"],
        exit_criteria: "The brief is visible and reviewable.",
        basis: ["implementation", "review"]
      }
    ],
    coverage: [
      { domain: "repository", status: "applicable", claim_ids: ["claim-1"] },
      { domain: "frontend", status: "applicable", claim_ids: ["claim-2"] },
      { domain: "backend", status: "applicable", claim_ids: ["claim-3"] }
    ],
    claims: [
      { id: "claim-1", domain: "repository", summary: "The repository is understood.", status: "code-confirmed" },
      { id: "claim-2", domain: "frontend", summary: "The frontend is understood.", status: "code-confirmed" },
      { id: "claim-3", domain: "backend", summary: "The backend is understood.", status: "code-confirmed" }
    ],
    blockers: [],
    stage_gates: {
      implement: { status: "ready", reasons: [], basis: ["scope"] },
      verify: { status: "ready", reasons: [], basis: ["testing"] },
      deliver: { status: "ready", reasons: [], basis: ["delivery"] }
    },
    execution_graph: {
      node_count: 1,
      max_parallelism: 1,
      integration_owner_task_id: "task-1",
      critical_path: ["task-1"],
      schedule_valid: true,
      blocked_reasons: [],
      next_ready_wave: { index: 1, task_ids: ["task-1"] },
      execution_waves: [{ index: 1, task_ids: ["task-1"] }],
      nodes: [
        {
          task_id: "task-1",
          depends_on: [],
          resources: [],
          readiness: "ready",
          wave_index: 1,
          proof_criterion_ids: ["criterion-1"]
        }
      ]
    }
  };

  const analysisSummary = {
    stage_gates: analysisPlan.stage_gates,
    execution_graph: analysisPlan.execution_graph
  };

  const onboardingSummary = {
    unresolved_claims: 0,
    conflict_claims: 0,
    domain_knownness: {
      database: { total_claims: 1, known_claims: 1, unknown_claims: 0, conflict_claims: 0 },
      frontend: { total_claims: 1, known_claims: 1, unknown_claims: 0, conflict_claims: 0 },
      backend: { total_claims: 1, known_claims: 1, unknown_claims: 0, conflict_claims: 0 }
    }
  };

  const { packet, questions, decisions } = buildLiveAlignmentInteractionPacket({
    operation,
    analysisPlan,
    analysisSummary,
    onboardingSummary,
    goalArtifact,
    snapshotArtifact,
    onboardingArtifact
  });

  return {
    goalArtifact,
    snapshotArtifact,
    onboardingArtifact,
    operation,
    analysisPlan,
    analysisSummary,
    onboardingSummary,
    interactionPacket: packet,
    interactionQuestions: questions,
    interactionDecisions: decisions,
    status: buildLiveAlignmentStatus(operation, {
      status: "planned",
      active_phase: "analysis-plan",
      current_attempt_id: "attempt-1"
    }),
    lease: buildLiveAlignmentLease(operation, {
      owner_id: "owner-1",
      boot_id: "boot-1",
      pid: 1234,
      process_birth_id: 5678
    })
  };
}

export function normalizeInteractionPacket(packet) {
  const normalizeText = (text) => String(text ?? "")
    .replace(/agent [^(]+ \([^)]+\)/g, "agent <adapter> (<profile>)")
    .replace(/\b(codex|cursor|claude|gemini|openai)\b/gi, "<adapter>");
  return {
    kind: packet.kind,
    verdict: packet.verdict,
    summary: normalizeText(packet.summary),
    attention: packet.attention,
    sections: packet.sections.map((section) => ({
      id: section.id,
      title: section.title,
      items: section.items.map((item) => ({
        text: normalizeText(item.text),
        confidence: item.confidence,
        severity: item.severity
      }))
    })),
    decisions: packet.decisions.map((decision) => ({
      question: decision.question,
      why_now: decision.why_now,
      impact: decision.impact,
      reversibility: decision.reversibility,
      options: decision.options.map((option) => option.label)
    }))
  };
}

export function normalizeStatus(status) {
  return {
    status: status.status,
    active_phase: status.active_phase,
    agent_attempts: status.agent_attempts,
    provider_requests: status.provider_requests,
    total_tokens: status.total_tokens,
    retained_records: status.retained_records,
    retained_bytes: status.retained_bytes,
    terminal_error: status.terminal_error
  };
}
