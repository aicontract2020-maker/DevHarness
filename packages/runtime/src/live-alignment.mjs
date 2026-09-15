import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";

import { assertContract } from "../../project/src/contracts.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { summarizeGoalPlan, summarizeStageGateMetrics } from "../../project/src/onboard.mjs";
import { projectValidatedAlignment } from "../../project/src/live-alignment.mjs";
import { canonicalRecordId } from "./canonical-records.mjs";
import {
  appendAlignmentOperationJournal,
  alignmentOperationPaths,
  alignmentOperationsRoot,
  ensureAlignmentOperationRoot,
  loadAlignmentOperationJournal,
  loadAlignmentDeveloperAnswers,
  loadAlignmentAnalysisPlan,
  loadAlignmentInteractionPacket,
  loadAlignmentOperation,
  loadAlignmentOperationLease,
  loadAlignmentOperationStatus,
  loadAlignmentTerminalFence,
  replayAlignmentOperationJournal,
  writeAlignmentDeveloperAnswer,
  writeAlignmentAnalysisPlan,
  writeAlignmentInteractionPacket,
  writeAlignmentOperation,
  writeAlignmentOperationLease,
  writeAlignmentOperationStatus,
  writeAlignmentTerminalFence
} from "./alignment-operation-store.mjs";
import { projectAlignmentState } from "./alignment-phase-machine.mjs";

function artifactRef(id, kind, sha256, storageKey, mediaType = "application/json", sizeBytes = 0) {
  return {
    id,
    kind,
    sha256,
    media_type: mediaType,
    size_bytes: sizeBytes,
    storage_key: storageKey
  };
}

function bundleArtifactRef(bundle) {
  return artifactRef(bundle.id, "alignment-bundle", hashContract(bundle), "artifacts/alignment-bundle.json");
}

function buildOperationJournalRecord(operationId, sequence, previousSha256, type, data, occurredAt = new Date().toISOString(), actor = "runtime") {
  const record = {
    schema_version: 1,
    id: "pending",
    operation_id: operationId,
    sequence,
    previous_sha256: previousSha256,
    type,
    occurred_at: occurredAt,
    data,
    actor
  };
  record.id = canonicalRecordId("operation-journal-record", record);
  return record;
}

function latestPhaseFailure(records) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record.type === "phase-finished" && record.data?.status !== "succeeded") return record;
  }
  return null;
}

function phaseAttemptCount(records, phase) {
  return records.filter((record) => record.type === "phase-started" && record.data?.phase === phase).length;
}

async function loadOperationJournalBundle(dataRoot, repositoryIdentity, operationId) {
  const bundle = await loadLiveAlignmentOperationBundle(dataRoot, repositoryIdentity, operationId);
  if (!bundle) return null;
  const journal = await loadAlignmentOperationJournal(dataRoot, repositoryIdentity, operationId);
  const projection = replayAlignmentOperationJournal(journal.records);
  return { ...bundle, journal, projection };
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string" && value.length > 0))];
}

function domainKnownnessMetrics(domainKnownness, domain) {
  const item = domainKnownness?.[domain] ?? { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} };
  return {
    total_claims: item.total_claims,
    known_claims: item.known_claims,
    unknown_claims: item.unknown_claims,
    conflict_claims: item.conflict_claims
  };
}

function sourceRefFromArtifact(artifact, location) {
  return {
    artifact_id: artifact.id,
    artifact_sha256: artifact.sha256,
    location
  };
}

function jsonLocation(pointer) {
  return { kind: "json", pointer };
}

function areaFromDomain(domain) {
  if (domain === "repository") return "repository-bootstrap";
  if (domain === "strategy" || domain === "runtime") return "integration";
  if (["frontend", "backend", "data", "security", "integration", "testing", "deployment", "automation"].includes(domain)) return domain;
  return "integration";
}

function claimProposalFromOnboardingClaim(claim, sourceArtifact, index) {
  const proposedClass = claim.status === "runtime-observed" || claim.status === "test-confirmed" ? "code-confirmed" : claim.status;
  return {
    id: `claim-${index + 1}`,
    area: areaFromDomain(claim.domain),
    text: claim.summary,
    proposed_class: ["detected", "documented", "code-confirmed", "conflict", "unverified", "not-covered"].includes(proposedClass) ? proposedClass : "unverified",
    source_refs: [sourceRefFromArtifact(sourceArtifact, jsonLocation(`/claims/${index}`))]
  };
}

function buildQuestionFromBlocker(blocker, sourceArtifact, index) {
  return {
    id: `question-${index + 1}`,
    question: blocker.summary,
    options: [
      {
        id: `question-${index + 1}-clarify`,
        label: "Clarify now",
        outcome: "Pause before execution and ask the developer to confirm the missing decision.",
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
    material_dimensions: ["acceptance-criterion", "explicit-non-goal"],
    source_refs: [sourceRefFromArtifact(sourceArtifact, jsonLocation(`/blockers/${index}`))]
  };
}

function buildQuestionFromClarification(question, sourceArtifact, index) {
  return {
    id: `question-${index + 1}`,
    question: question.question,
    options: [
      {
        id: `question-${index + 1}-clarify`,
        label: "Clarify now",
        outcome: "Pause before execution and ask the developer to confirm the missing decision.",
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
    material_dimensions: ["acceptance-criterion", "explicit-non-goal"],
    source_refs: [sourceRefFromArtifact(sourceArtifact, jsonLocation(`/preflight/clarification_questions/${index}`))]
  };
}

function packetSourceArtifact(artifact) {
  return {
    id: artifact.id,
    kind: artifact.kind,
    sha256: artifact.sha256,
    ...(artifact.storage_key ? { uri: artifact.storage_key } : {})
  };
}

function buildQuestionDecision(question, questionIndex) {
  const recommendedOption = question.options.find((option) => option.recommended) ?? question.options[0];
  const decision = {
    id: `decision-${questionIndex + 1}`,
    question: question.question,
    why_now: "This decision is blocking progress on the current live alignment plan.",
    impact: "high",
    reversibility: "costly",
    recommended_option_id: recommendedOption.id,
    options: question.options.map((option) => ({
      id: option.id,
      label: option.label,
      outcome: option.outcome,
      tradeoffs: option.tradeoffs
    }))
  };

  return {
    decision,
    traceability: (question.source_refs ?? []).map((ref) => ref.artifact_id)
  };
}

export function buildLiveAlignmentInteractionPacket({
  operation,
  analysisPlan,
  analysisSummary = null,
  onboardingSummary = null,
  goalArtifact,
  snapshotArtifact,
  onboardingArtifact
}) {
  const sourceArtifacts = [
    packetSourceArtifact(goalArtifact),
    packetSourceArtifact(snapshotArtifact),
    packetSourceArtifact(onboardingArtifact),
    packetSourceArtifact({
      id: analysisPlan.id,
      kind: "analysis-plan",
      sha256: operationDigest(analysisPlan),
      storage_key: "analysis-plan.json"
    })
  ];
  const sourceArtifactIds = sourceArtifacts.map((artifact) => artifact.id);
  const questions = analysisPlan.questions.slice(0, 3);
  const decisionEntries = questions.map((question, index) => buildQuestionDecision(question, index));
  const decisions = decisionEntries.map((entry) => entry.decision);
  const preflight = {
    clarification_questions: analysisPlan.clarification_questions ?? [],
    research_topics: analysisPlan.research_topics ?? [],
    research_tasks: analysisPlan.research_tasks ?? [],
    team_decomposition: analysisPlan.team_decomposition ?? []
  };
  const clarificationQuestions = preflight.clarification_questions.length > 0
    ? preflight.clarification_questions.slice(0, 3)
    : analysisPlan.questions.slice(0, 3).map((question, index) => ({
        id: question.id ?? `question-${index + 1}`,
        question: question.question
      }));
  const researchTopics = preflight.research_topics ?? [];
  const researchTasks = preflight.research_tasks ?? [];
  const teamDecomposition = preflight.team_decomposition ?? [];
  const researchBasis = uniqueStrings(researchTopics.flatMap((topic) => topic.basis ?? [])).slice(0, 10);
  const teamBasis = uniqueStrings(teamDecomposition.flatMap((team) => team.basis ?? [])).slice(0, 10);
  const understanding = onboardingSummary ?? null;
  const stageGates = analysisSummary?.stage_gates ?? null;
  const stageGateMetrics = analysisSummary?.stage_gate_metrics ?? summarizeStageGateMetrics(stageGates);
  const stageGateBasis = stageGates ? uniqueStrings([
    ...(stageGates.implement?.basis ?? []),
    ...(stageGates.verify?.basis ?? []),
    ...(stageGates.deliver?.basis ?? [])
  ]).slice(0, 10) : [];
  const executionGraph = analysisSummary?.execution_graph ?? { node_count: 0, max_parallelism: 0, integration_owner_task_id: null, critical_path: [], schedule_valid: false, blocked_reasons: [], next_ready_wave: null, execution_waves: [], nodes: [] };
  const domainKnownness = understanding?.domain_knownness ?? null;
  const itemSourceRefs = sourceArtifactIds;
  const sections = [
    {
      id: "live-alignment-context",
      title: "Confirmed context",
      items: [
        {
          id: "alignment-context-1",
          text: `Goal ${operation.run_id} is in live alignment for agent ${operation.agent_descriptor.id} (${operation.agent_descriptor.profile_id}).`,
          confidence: "confirmed",
          severity: "info",
          source_refs: itemSourceRefs
        }
      ]
    },
    {
      id: "live-alignment-quantitative",
      title: "Quantitative summary",
      items: understanding && domainKnownness
        ? [
            {
              id: "alignment-quantitative-understanding",
              text: `Understanding: database ${domainKnownness.database.known_claims}/${domainKnownness.database.total_claims} known · frontend ${domainKnownness.frontend.known_claims}/${domainKnownness.frontend.total_claims} known · backend ${domainKnownness.backend.known_claims}/${domainKnownness.backend.total_claims} known.`,
              confidence: "confirmed",
              severity: "info",
              source_refs: itemSourceRefs
            },
            {
              id: "alignment-quantitative-database",
              text: `Database: ${domainKnownness.database.known_claims}/${domainKnownness.database.total_claims} known · unk ${domainKnownness.database.unknown_claims} · conf ${domainKnownness.database.conflict_claims}.`,
              confidence: "confirmed",
              severity: "info",
              metrics: domainKnownnessMetrics(domainKnownness, "database"),
              source_refs: itemSourceRefs
            },
            {
              id: "alignment-quantitative-frontend",
              text: `Frontend: ${domainKnownness.frontend.known_claims}/${domainKnownness.frontend.total_claims} known · unk ${domainKnownness.frontend.unknown_claims} · conf ${domainKnownness.frontend.conflict_claims}.`,
              confidence: "confirmed",
              severity: "info",
              metrics: domainKnownnessMetrics(domainKnownness, "frontend"),
              source_refs: itemSourceRefs
            },
            {
              id: "alignment-quantitative-backend",
              text: `Backend: ${domainKnownness.backend.known_claims}/${domainKnownness.backend.total_claims} known · unk ${domainKnownness.backend.unknown_claims} · conf ${domainKnownness.backend.conflict_claims}.`,
              confidence: "confirmed",
              severity: "info",
              metrics: domainKnownnessMetrics(domainKnownness, "backend"),
              source_refs: itemSourceRefs
            },
            {
              id: "alignment-quantitative-gaps",
              text: `Gaps: ${understanding.unresolved_claims} unresolved claim(s) · ${understanding.conflict_claims} conflict(s) · ${questions.length} blocking question(s).`,
              confidence: "confirmed",
              severity: "info",
              source_refs: itemSourceRefs
            },
            {
              id: "alignment-quantitative-crew",
              text: `Crew and research: ${preflight.team_decomposition.length} crew group(s) · ${preflight.research_tasks.length} research task(s) · ${preflight.research_topics.length} research topic(s).`,
              confidence: "confirmed",
              severity: "info",
              source_refs: itemSourceRefs
            },
            ...(stageGateMetrics
              ? [{
                  id: "alignment-quantitative-stage-gates",
                  text: `Stage gates: ${stageGateMetrics.ready}/${stageGateMetrics.total} ready · ${stageGateMetrics.blocked} blocked · ${stageGateMetrics.total_reasons} reason(s).`,
                  confidence: "confirmed",
                  severity: stageGateMetrics.blocked > 0 ? "warning" : "info",
                  basis: stageGateBasis,
                  source_refs: itemSourceRefs
                }]
              : [])
          ]
        : [
            {
              id: "alignment-quantitative-none",
              text: "No quantitative summary was available for this packet.",
              confidence: "confirmed",
              severity: "info",
              source_refs: itemSourceRefs
            }
          ]
    },
    {
      id: "live-alignment-crew",
      title: "Crew split",
      items: preflight.team_decomposition.length > 0
        ? preflight.team_decomposition.map((team, index) => ({
            id: `alignment-crew-${index + 1}`,
            text: `${team.label}: ${team.focus} Tasks: ${team.task_ids.length > 0 ? team.task_ids.join(", ") : "none"}. Exit: ${team.exit_criteria}.`,
            confidence: "confirmed",
            severity: "info",
            source_refs: itemSourceRefs
          }))
        : [
            {
              id: "alignment-crew-none",
              text: "No crew split was proposed for this run.",
              confidence: "confirmed",
              severity: "info",
              source_refs: itemSourceRefs
            }
          ]
    },
    {
      id: "live-alignment-execution-graph",
      title: "Execution graph",
      items: [
        {
          id: "alignment-execution-graph-summary",
          text: `Execution graph: ${executionGraph.node_count} node(s) · max parallelism ${executionGraph.max_parallelism} · integration owner ${executionGraph.integration_owner_task_id ?? "unknown"} · critical path ${executionGraph.critical_path.join(" → ") || "not yet derivable"} · ${executionGraph.schedule_valid ? (executionGraph.next_ready_wave?.task_ids?.length > 0 ? `next ready wave ${executionGraph.next_ready_wave.index}: ${executionGraph.next_ready_wave.task_ids.join(", ")}` : "next ready wave: none") : `blocked: ${(executionGraph.blocked_reasons ?? []).map((reason) => reason.summary).join("; ") || "schedule invalid"}`}.`,
          confidence: "confirmed",
          severity: executionGraph.schedule_valid ? "info" : "warning",
          basis: uniqueStrings([
            ...(executionGraph.critical_path ?? []),
            ...(executionGraph.blocked_reasons ?? []).map((reason) => reason.code ?? reason.summary ?? "blocked"),
            ...(executionGraph.next_ready_wave?.task_ids ?? [])
          ]).slice(0, 10),
          source_refs: itemSourceRefs
        },
        ...executionGraph.nodes.map((node) => ({
          id: `alignment-execution-graph-node-${node.task_id}`,
          text: `${node.task_id}: depends on ${node.depends_on.length > 0 ? node.depends_on.join(", ") : "none"}; resources ${node.resources.length > 0 ? node.resources.join(", ") : "none"}; readiness ${node.readiness}${typeof node.wave_index === "number" ? ` (wave ${node.wave_index})` : ""}.`,
          confidence: "confirmed",
          severity: node.readiness === "blocked" ? "warning" : "info",
          basis: node.proof_criterion_ids,
          source_refs: itemSourceRefs
        }))
      ]
    },
    {
      id: "live-alignment-stages",
      title: "Stage gates",
      items: stageGates
        ? [
            ...(stageGateMetrics
              ? [{
                  id: "alignment-stage-summary",
                  text: `Stage gate summary: ${stageGateMetrics.ready}/${stageGateMetrics.total} ready · ${stageGateMetrics.blocked} blocked · ${stageGateMetrics.total_reasons} reason(s).`,
                  confidence: "confirmed",
                  severity: stageGateMetrics.blocked > 0 ? "warning" : "info",
                  basis: stageGateBasis,
                  source_refs: itemSourceRefs
                }]
              : []),
            {
              id: "alignment-stage-implement",
              text: `Implement gate: ${stageGates.implement.status}${stageGates.implement.reasons.length > 0 ? ` (${stageGates.implement.reasons.join("; ")})` : ""}.`,
              confidence: "confirmed",
              severity: stageGates.implement.status === "ready" ? "info" : "warning",
              basis: stageGates.implement.basis ?? ["understanding", "scope", "capability", "schedule"],
              source_refs: itemSourceRefs
            },
            {
              id: "alignment-stage-verify",
              text: `Verify gate: ${stageGates.verify.status}${stageGates.verify.reasons.length > 0 ? ` (${stageGates.verify.reasons.join("; ")})` : ""}.`,
              confidence: "confirmed",
              severity: stageGates.verify.status === "ready" ? "info" : "warning",
              basis: stageGates.verify.basis ?? ["testing", "understanding", "acceptance", "schedule"],
              source_refs: itemSourceRefs
            },
            {
              id: "alignment-stage-deliver",
              text: `Deliver gate: ${stageGates.deliver.status}${stageGates.deliver.reasons.length > 0 ? ` (${stageGates.deliver.reasons.join("; ")})` : ""}.`,
              confidence: "confirmed",
              severity: stageGates.deliver.status === "ready" ? "info" : "warning",
              basis: stageGates.deliver.basis ?? ["delivery", "testing", "understanding", "scope", "capability", "acceptance"],
              source_refs: itemSourceRefs
            }
          ]
        : [
            {
              id: "alignment-stage-none",
              text: "No stage gates were available for this packet.",
              confidence: "confirmed",
              severity: "info",
              source_refs: itemSourceRefs
            }
          ]
    },
    {
      id: "live-alignment-clarification",
      title: "Clarification queue",
      items: clarificationQuestions.length > 0
        ? clarificationQuestions.map((question, index) => ({
            id: `alignment-clarification-${index + 1}`,
            text: question.question,
            confidence: "confirmed",
            severity: "warning",
            basis: uniqueStrings([question.id ?? `clarify-${index + 1}`, ...(question.basis ?? [])]).slice(0, 10),
            source_refs: itemSourceRefs
          }))
        : [
            {
              id: "alignment-clarification-none",
              text: "No clarifying questions are blocking this run.",
              confidence: "confirmed",
              severity: "info",
              source_refs: itemSourceRefs
            }
          ]
    },
    {
      id: "live-alignment-preflight",
      title: "Preflight plan",
      items: [
        {
          id: "alignment-preflight-summary",
          text: `Preflight path: clarify ${clarificationQuestions.length > 0 ? `${clarificationQuestions.length} question(s)` : "none"} → research ${researchTopics.length} topic(s) → split ${teamDecomposition.length} crew group(s).`,
          confidence: "confirmed",
          severity: "info",
          basis: uniqueStrings(["clarify", "research", "best-practices", "team-decomposition", ...researchBasis, ...teamBasis]).slice(0, 10),
          source_refs: itemSourceRefs
        },
        ...(clarificationQuestions.length > 0
          ? clarificationQuestions.map((question, index) => ({
              id: `alignment-preflight-clarification-${index + 1}`,
              text: question.question,
              confidence: "confirmed",
              severity: "warning",
              basis: uniqueStrings([question.id ?? `clarify-${index + 1}`, "clarify", ...(question.basis ?? [])]).slice(0, 10),
              source_refs: itemSourceRefs
            }))
          : []),
        ...researchTopics.map((topic, index) => ({
          id: `alignment-preflight-research-${index + 1}`,
          text: `Research topic: ${topic.purpose} → ${topic.expected_outcome}. Query: ${topic.query}.`,
          confidence: "confirmed",
          severity: "info",
          basis: topic.basis,
          source_refs: itemSourceRefs
        })),
        ...teamDecomposition.map((team, index) => ({
          id: `alignment-preflight-team-${index + 1}`,
          text: `${team.label}: ${team.focus} Tasks: ${team.task_ids.length > 0 ? team.task_ids.join(", ") : "none"}. Exit: ${team.exit_criteria}.`,
          confidence: "confirmed",
          severity: "info",
          basis: team.basis,
          source_refs: itemSourceRefs
        }))
      ]
    },
    {
      id: "live-alignment-questions",
      title: "Questions to answer",
      items: questions.map((question, index) => ({
        id: `alignment-question-${index + 1}`,
        text: question.question,
        confidence: "verify",
        severity: "blocking",
        source_refs: question.source_refs.map((ref) => ref.artifact_id)
      }))
    },
    {
      id: "live-alignment-next",
      title: "Recommended next step",
      items: [
        {
          id: "alignment-next-1",
          text: decisions.length > 0
            ? "Answer the blocked question, then release the agent authority to continue the live operation."
            : "No blocking questions remain in the current packet.",
          confidence: "confirmed",
          severity: decisions.length > 0 ? "warning" : "info",
          source_refs: itemSourceRefs
        }
      ]
    }
  ];
  const surfacedItems = sections.flatMap((section) => section.items);
  const packetBody = {
    schema_version: 1,
    run_id: operation.run_id,
    kind: questions.length > 0 ? "decision-queue" : "progress-pulse",
    generated_at: new Date().toISOString(),
    head_sha: operation.commit_sha,
    title: questions.length > 0 ? `Live Alignment Questions · ${operation.run_id}` : `Live Alignment Progress · ${operation.run_id}`,
    verdict: questions.length > 0 ? "action-required" : "informational",
    summary: questions.length > 0
      ? `The live alignment plan is blocked on a human answer before the agent can continue. Showing ${questions.length} of ${analysisPlan.questions.length} unresolved question(s).`
      : "The live alignment plan is tracking progress without a blocking developer question.",
    attention: {
      required: questions.length > 0,
      count: decisions.length,
      reasons: questions.length > 0 ? ["goal-ambiguity", "verification-blocker"] : []
    },
    sections,
    decisions,
    actions: questions.length > 0
      ? [
          { id: "answer-question", label: "Answer the blocked question", kind: "answer", recommended: true },
          { id: "inspect-plan", label: "Inspect the current analysis plan", kind: "inspect", recommended: false }
        ]
      : [
          { id: "inspect-progress", label: "Inspect the current progress", kind: "inspect", recommended: true }
        ],
    source_artifacts: sourceArtifacts,
    traceability: [
      ...surfacedItems.map((item) => ({ item_id: item.id, source_refs: item.source_refs })),
      ...decisionEntries.map((entry) => ({ item_id: entry.decision.id, source_refs: entry.traceability }))
    ],
    compression: {
      source_artifact_count: sourceArtifacts.length,
      surfaced_item_count: surfacedItems.length + decisions.length,
      omitted_item_count: Math.max(0, sourceArtifacts.length - (surfacedItems.length + decisions.length))
    }
  };
  const packet = { ...packetBody, id: `interaction-packet-${operationDigest(packetBody).slice(0, 32)}` };
  return { packet, questions, decisions };
}

export function buildLiveAlignmentDeveloperAnswer({
  operation,
  packet,
  decision,
  option,
  request,
  receipt,
  answeredAt = receipt.decided_at
}) {
  const subjectSha = operationDigest(packet);
  const answerBody = {
    schema_version: 1,
    run_id: operation.run_id,
    repository_identity: operation.repository_identity,
    commit_sha: operation.commit_sha,
    packet_sha256: subjectSha,
    decision_id: decision.id,
    option_id: option.id,
    decision_ref: {
      gate: request.gate,
      subject_sha256: subjectSha,
      request_id: request.id,
      receipt_id: receipt.id,
      request_sha256: operationDigest(request),
      receipt_sha256: operationDigest(receipt),
      actor: { id: receipt.decided_by.id, kind: receipt.decided_by.kind },
      decided_at: receipt.decided_at
    },
    actor: { id: receipt.decided_by.id, kind: receipt.decided_by.kind },
    answered_at: answeredAt
  };
  return { answer: { ...answerBody, id: `developer-answer-${operationDigest(answerBody).slice(0, 32)}` } };
}

export function buildLiveAlignmentAnalysisPlan({
  operation,
  goalArtifact,
  snapshotArtifact,
  onboardingArtifact,
  onboardingPlan
}) {
  const planSketch = summarizeGoalPlan(onboardingPlan);
  const preflight = onboardingPlan.preflight ?? planSketch.preflight ?? { clarification_questions: [], research_topics: [], research_tasks: [], team_decomposition: [] };
  const clarificationQueue = (preflight.clarification_questions ?? [])
    .slice(0, 3)
    .map((question, index) => ({
      id: question.id ?? `clarify-${index + 1}`,
      question: question.question,
      source_blocker_id: question.blocker_id ?? null,
      basis: Array.isArray(question.basis) ? question.basis : []
    }));
  const executionGraph = planSketch.execution_graph ?? { node_count: 0, max_parallelism: 0, integration_owner_task_id: null, critical_path: [], schedule_valid: false, blocked_reasons: [], next_ready_wave: null, execution_waves: [], nodes: [] };
  const coverageByDomain = new Map((onboardingPlan.coverage ?? []).map((item) => [item.domain, item]));
  const areaOrder = [
    ["repository-bootstrap", "repository"],
    ["frontend", "frontend"],
    ["backend", "backend"],
    ["data", "database"],
    ["security", "security"],
    ["integration", "strategy"],
    ["testing", "testing"],
    ["deployment", "deployment"],
    ["automation", "automation"]
  ];
  const affectedAreas = areaOrder.map(([area, domain]) => {
    const coverage = coverageByDomain.get(domain);
    const proposedStatus = coverage?.status ?? (domain === "repository" ? "applicable" : "gap");
    return {
      area,
      proposed_status: ["applicable", "not-applicable", "conflict", "gap"].includes(proposedStatus) ? proposedStatus : "gap",
      summary: coverage?.status === "not-applicable"
        ? `${area} is not applicable to this repository goal slice.`
        : coverage?.status
          ? `${domain} coverage is ${coverage.status}; ${coverage.claim_ids?.length ?? 0} claims are attached to the onboarding plan.`
          : `${area} has not yet been proven.`
      ,
      source_refs: [sourceRefFromArtifact(onboardingArtifact, jsonLocation(`/coverage/${Math.max(0, onboardingPlan.coverage?.findIndex((item) => item.domain === domain) ?? 0)}`))]
    };
  });

  const claims = (onboardingPlan.claims ?? []).slice(0, 100).map((claim, index) => claimProposalFromOnboardingClaim(claim, onboardingArtifact, index));
  const assumptions = (onboardingPlan.blockers ?? []).slice(0, 50).map((blocker, index) => ({
    id: `assumption-${index + 1}`,
    kind: "assumption",
    summary: blocker.summary,
    material_dimensions: ["acceptance-criterion"],
    source_refs: [sourceRefFromArtifact(onboardingArtifact, jsonLocation(`/blockers/${index}`))]
  }));
  const conflicts = (onboardingPlan.claims ?? []).filter((claim) => claim.status === "conflict").slice(0, 50).map((claim, index) => ({
    id: `conflict-${index + 1}`,
    kind: "conflict",
    summary: claim.summary,
    material_dimensions: ["security-privacy-credential", "externally-observable-behavior"],
    source_refs: [sourceRefFromArtifact(onboardingArtifact, jsonLocation(`/claims/${index}`))]
  }));
  const questions = clarificationQueue.length > 0
    ? clarificationQueue.map((question, index) => buildQuestionFromClarification(question, onboardingArtifact, index))
    : (onboardingPlan.blockers ?? []).slice(0, 3).map((blocker, index) => buildQuestionFromBlocker(blocker, onboardingArtifact, index));
  const researchTopics = (preflight.research_topics ?? [])
    .slice(0, 5)
    .map((topic, index) => ({
      id: topic.id ?? `research-topic-${index + 1}`,
      purpose: topic.purpose,
      ...(topic.query ? { query: topic.query } : {}),
      ...(topic.owner ? { owner: topic.owner } : {}),
      ...(typeof topic.priority === "number" ? { priority: topic.priority } : {}),
      ...(topic.expected_outcome ? { expected_outcome: topic.expected_outcome } : {}),
      ...(Array.isArray(topic.basis) ? { basis: topic.basis } : {}),
      public_identifiers: topic.public_identifiers,
      source_refs: [sourceRefFromArtifact(onboardingArtifact, jsonLocation(`/preflight/research_topics/${index}`))]
    }));
  const researchTasks = (preflight.research_tasks ?? [])
    .slice(0, 5)
    .map((task, index) => ({
      id: task.id ?? `research-task-${index + 1}`,
      topic_id: task.topic_id,
      query: task.query,
      owner: task.owner,
      priority: task.priority,
      approval_capability: task.approval_capability ?? "network-research",
      status: task.status ?? "pending-approval",
      expected_outcome: task.expected_outcome,
      basis: task.basis
    }));
  const teamDecomposition = (preflight.team_decomposition ?? [])
    .slice(0, 8)
    .map((team, index) => ({
      id: team.id ?? `team-${index + 1}`,
      label: team.label,
      focus: team.focus,
      task_ids: team.task_ids,
      exit_criteria: team.exit_criteria,
      basis: team.basis
    }));
  const researchBasis = uniqueStrings(researchTopics.flatMap((topic) => topic.basis ?? [])).slice(0, 10);
  const teamBasis = uniqueStrings(teamDecomposition.flatMap((team) => team.basis ?? [])).slice(0, 10);
  const untrustedInstructions = [];

  const body = {
    schema_version: 1,
    invocation_id: `analysis-plan-invocation-${operation.id.slice(-16)}`,
    operation_id: operation.id,
    affected_areas: affectedAreas,
    claims,
    assumptions,
    conflicts,
    questions,
    untrusted_instructions: untrustedInstructions,
    research_topics: researchTopics,
    research_tasks: researchTasks,
    team_decomposition: teamDecomposition
  };
  const id = `analysis-plan-${operationDigest(body).slice(0, 32)}`;
  const analysisPlan = { ...body, id };
  return {
    analysisPlan,
    summary: {
      crew: planSketch.crew.map((crew) => crew.label),
      checkpoints: planSketch.checkpoints.map((step) => step.label),
      clarification_questions: clarificationQueue.length,
      questions: questions.length,
      research_topics: researchTopics.length,
      research_tasks: researchTasks.length,
      team_decomposition: teamDecomposition.length,
      stage_gates: planSketch.stage_gates,
      stage_gate_metrics: planSketch.stage_gate_metrics ?? summarizeStageGateMetrics(planSketch.stage_gates),
      execution_graph: executionGraph
    }
  };
}

function operationDigest(parts) {
  return hashContract(parts);
}

export function buildLiveAlignmentOperation({
  run,
  goalArtifact,
  snapshotArtifact,
  onboardingArtifact,
  agentDescriptor,
  agentAuthoritySubject,
  resultContractSha256,
  limits,
  developerAnswerArtifacts = [],
  inputCheckpointSha256 = null
}) {
  const semantic = {
    run_id: run.id,
    repository_identity: run.repository.identity,
    commit_sha: run.current_head_sha,
    input_checkpoint_sha256: inputCheckpointSha256 ?? operationDigest({
      run_id: run.id,
      goal_sha256: goalArtifact.sha256,
      snapshot_sha256: snapshotArtifact.sha256,
      onboarding_sha256: onboardingArtifact.sha256,
      developer_answer_ids: developerAnswerArtifacts.map((artifact) => artifact.id)
    }),
    original_goal: goalArtifact,
    developer_answers: developerAnswerArtifacts,
    snapshot: snapshotArtifact,
    onboarding: onboardingArtifact,
    agent_descriptor: agentDescriptor,
    agent_authority_subject: agentAuthoritySubject,
    result_contract_sha256: resultContractSha256,
    limits
  };
  return {
    schema_version: 1,
    id: `alignment-operation-${operationDigest(semantic).slice(0, 32)}`,
    ...semantic
  };
}

export function buildLiveAlignmentStatus(operation, {
  status = "planned",
  active_phase = null,
  current_attempt_id = null,
  active_execution_ms = 0,
  agent_attempts = 0,
  provider_requests = 0,
  total_tokens = 0,
  retained_records = 0,
  retained_bytes = 0,
  analysis_plan_ref = null,
  research_subject_ref = null,
  research_authority_epoch = 0,
  result_bundle_ref = null,
  checkpoint_sha256 = null,
  terminal_error = null
} = {}) {
  return {
    schema_version: 1,
    operation_id: operation.id,
    status,
    active_phase,
    current_attempt_id,
    active_execution_ms,
    agent_attempts,
    provider_requests,
    total_tokens,
    retained_records,
    retained_bytes,
    analysis_plan_ref,
    research_subject_ref,
    research_authority_epoch,
    result_bundle_ref,
    checkpoint_sha256,
    terminal_error,
    journal_head_sha256: operationDigest({ operation_id: operation.id, status, active_phase, current_attempt_id, active_execution_ms, agent_attempts, provider_requests, total_tokens, retained_records, retained_bytes }),
    accounting_head_sha256: operationDigest({ operation_id: operation.id, status, analysis_plan_ref, research_subject_ref, research_authority_epoch, result_bundle_ref, checkpoint_sha256, terminal_error })
  };
}

export function buildLiveAlignmentLease(operation, {
  owner_id,
  boot_id,
  pid,
  process_birth_id,
  acquired_at = new Date().toISOString(),
  wall_expires_at = new Date(Date.now() + 60_000).toISOString(),
  heartbeat_sequence = 0,
  heartbeat_at = acquired_at
}) {
  return {
    schema_version: 1,
    operation_id: operation.id,
    owner_id,
    boot_id,
    pid,
    process_birth_id,
    acquired_at,
    wall_expires_at,
    heartbeat_sequence,
    heartbeat_at
  };
}

export async function startLiveAlignmentOperation({
  dataRoot,
  repositoryIdentity,
  operation,
  analysisPlan = null,
  interactionPacket = null,
  status = null,
  lease = null,
  fence = null
}) {
  await assertContract("alignment-operation", operation);
  const paths = await ensureAlignmentOperationRoot(dataRoot, repositoryIdentity, operation.id);
  await writeAlignmentOperation(dataRoot, repositoryIdentity, operation);
  const createdRecord = buildOperationJournalRecord(
    operation.id,
    1,
    null,
    "operation-created",
    { operation_sha256: operationDigest(operation) },
    new Date().toISOString()
  );
  await appendAlignmentOperationJournal(dataRoot, repositoryIdentity, createdRecord, {
    expectedSequence: 0,
    expectedPreviousSha256: null
  });
  if (analysisPlan) await writeAlignmentAnalysisPlan(dataRoot, repositoryIdentity, analysisPlan);
  if (interactionPacket) await writeAlignmentInteractionPacket(dataRoot, repositoryIdentity, operation.id, interactionPacket);
  const analysisPlanRef = analysisPlan
    ? artifactRef(analysisPlan.id, "analysis-plan", operationDigest(analysisPlan), "analysis-plan.json", "application/json", Buffer.byteLength(`${JSON.stringify(analysisPlan, null, 2)}\n`))
    : null;
  const currentStatus = status
    ? (analysisPlanRef && !status.analysis_plan_ref ? { ...status, analysis_plan_ref: analysisPlanRef } : status)
    : buildLiveAlignmentStatus(operation, { analysis_plan_ref: analysisPlanRef });
  await writeAlignmentOperationStatus(dataRoot, repositoryIdentity, currentStatus);
  if (lease) await writeAlignmentOperationLease(dataRoot, repositoryIdentity, lease);
  if (fence) await writeAlignmentTerminalFence(dataRoot, repositoryIdentity, fence);
  return { paths, operation, status: currentStatus, lease, fence };
}

export async function publishValidatedAlignment({
  dataRoot,
  repositoryIdentity,
  operation,
  analysisPlan,
  bundle,
  goalAnalysis,
  validation,
  trustContext = null,
  generatedAt = new Date().toISOString(),
  lease = null,
  fence = null
}) {
  const validated = await projectValidatedAlignment({ bundle, goalAnalysis, validation, trustContext, generatedAt });
  const resultBundleRef = bundleArtifactRef(validated.bundle);
  const analysisPlanRef = analysisPlan
    ? artifactRef(analysisPlan.id, "analysis-plan", operationDigest(analysisPlan), "analysis-plan.json", "application/json", Buffer.byteLength(`${JSON.stringify(analysisPlan, null, 2)}\n`))
    : null;
  const status = buildLiveAlignmentStatus(operation, {
    status: validated.bundle.verdict === "ready" ? "ready" : "question-blocked",
    analysis_plan_ref: analysisPlanRef,
    result_bundle_ref: resultBundleRef
  });
  const publication = await startLiveAlignmentOperation({
    dataRoot,
    repositoryIdentity,
    operation,
    analysisPlan,
    interactionPacket: validated.packet,
    status,
    lease,
    fence
  });
  return { ...validated, result_bundle_ref: resultBundleRef, status: publication.status, publication };
}

export async function retryLiveAlignmentOperation({
  dataRoot,
  repositoryIdentity,
  operationId,
  now = () => new Date()
}) {
  const bundle = await loadOperationJournalBundle(dataRoot, repositoryIdentity, operationId);
  if (!bundle) return null;
  if (!["failed", "timed-out"].includes(bundle.status.status)) {
    throw new Error("Retry requires a failed or timed-out live alignment operation.");
  }
  if (bundle.fence?.kind === "cancel") {
    throw new Error("RETRY_EXHAUSTED");
  }

  const failedAttempt = latestPhaseFailure(bundle.journal.records);
  if (!failedAttempt) {
    throw new Error("Retry requires a recorded failed phase.");
  }
  const phase = failedAttempt.data.phase;
  const attemptNo = phaseAttemptCount(bundle.journal.records, phase) + 1;
  if (attemptNo > 2) {
    throw new Error("RETRY_EXHAUSTED");
  }

  const attemptId = `attempt-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const invocationSha256 = hashContract({
    operation_id: operationId,
    phase,
    attempt_no: attemptNo,
    retry: true,
    failure_sha256: failedAttempt.data.attempt_sha256
  });
  const record = buildOperationJournalRecord(
    operationId,
    bundle.journal.sequence + 1,
    bundle.journal.head_sha256,
    "phase-started",
    {
      phase,
      attempt_id: attemptId,
      attempt_no: attemptNo,
      invocation_sha256: invocationSha256
    },
    now().toISOString()
  );
  await appendAlignmentOperationJournal(dataRoot, repositoryIdentity, record, {
    expectedSequence: bundle.journal.sequence,
    expectedPreviousSha256: bundle.journal.head_sha256
  });

  const status = buildLiveAlignmentStatus(bundle.operation, {
    status: "running",
    active_phase: phase,
    current_attempt_id: attemptId,
    agent_attempts: Math.max(bundle.status.agent_attempts + 1, attemptNo),
    provider_requests: bundle.status.provider_requests,
    total_tokens: bundle.status.total_tokens,
    retained_records: bundle.status.retained_records,
    retained_bytes: bundle.status.retained_bytes,
    analysis_plan_ref: bundle.status.analysis_plan_ref,
    research_subject_ref: bundle.status.research_subject_ref,
    research_authority_epoch: bundle.status.research_authority_epoch,
    result_bundle_ref: bundle.status.result_bundle_ref,
    checkpoint_sha256: bundle.status.checkpoint_sha256,
    terminal_error: null
  });
  await writeAlignmentOperationStatus(dataRoot, repositoryIdentity, status);
  return {
    ...bundle,
    journal: await loadAlignmentOperationJournal(dataRoot, repositoryIdentity, operationId),
    status
  };
}

export async function cancelLiveAlignmentOperation({
  dataRoot,
  repositoryIdentity,
  operationId,
  requestedBy = { id: "developer", kind: "human" },
  now = () => new Date()
}) {
  const bundle = await loadOperationJournalBundle(dataRoot, repositoryIdentity, operationId);
  if (!bundle) return null;
  if (bundle.status.status === "ready") {
    throw new Error("ALREADY_COMPLETED");
  }
  if (bundle.fence?.kind === "commit") {
    throw new Error("ALREADY_COMMITTING");
  }

  const fence = bundle.fence ?? {
    schema_version: 1,
    id: `terminal-fence-${operationId}`,
    operation_id: operationId,
    kind: "cancel",
    created_at: now().toISOString(),
    expected_journal_head_sha256: bundle.journal.head_sha256,
    prepared_manifest_sha256: null,
    requested_by: requestedBy
  };
  let createdFence = false;
  if (!bundle.fence) {
    const publishedFence = await writeAlignmentTerminalFence(dataRoot, repositoryIdentity, fence);
    if (publishedFence.fence.kind === "commit") {
      throw new Error("ALREADY_COMMITTING");
    }
    createdFence = publishedFence.created;
  }

  const status = buildLiveAlignmentStatus(bundle.operation, {
    status: "cancelled",
    active_phase: null,
    current_attempt_id: null,
    agent_attempts: bundle.status.agent_attempts,
    provider_requests: bundle.status.provider_requests,
    total_tokens: bundle.status.total_tokens,
    retained_records: bundle.status.retained_records,
    retained_bytes: bundle.status.retained_bytes,
    analysis_plan_ref: bundle.status.analysis_plan_ref,
    research_subject_ref: bundle.status.research_subject_ref,
    research_authority_epoch: bundle.status.research_authority_epoch,
    result_bundle_ref: bundle.status.result_bundle_ref,
    checkpoint_sha256: bundle.status.checkpoint_sha256,
    terminal_error: "CANCELLED"
  });
  await writeAlignmentOperationStatus(dataRoot, repositoryIdentity, status);
  if (createdFence) {
    const record = buildOperationJournalRecord(
      operationId,
      bundle.journal.sequence + 1,
      bundle.journal.head_sha256,
      "cancellation-fenced",
      {
        fence_sequence: 1,
        requested_by: requestedBy,
        requested_at: fence.created_at
      },
      fence.created_at,
      "supervisor-verified-foreground-human"
    );
    await appendAlignmentOperationJournal(dataRoot, repositoryIdentity, record, {
      expectedSequence: bundle.journal.sequence,
      expectedPreviousSha256: bundle.journal.head_sha256
    });
  }

  return {
    ...bundle,
    fence,
    status
  };
}

export async function reconcileLiveAlignmentOperation({
  dataRoot,
  repositoryIdentity,
  operationId,
  isOwnerAlive = async () => false,
  now = () => new Date()
}) {
  const bundle = await loadOperationJournalBundle(dataRoot, repositoryIdentity, operationId);
  if (!bundle) return null;
  const lease = bundle.lease;
  const leaseExpired = lease ? Date.parse(lease.wall_expires_at) <= now().getTime() : false;
  const ownerAlive = lease ? await isOwnerAlive(lease) : false;
  if (lease && leaseExpired && !ownerAlive && !["ready", "failed", "cancelled", "timed-out"].includes(bundle.status.status)) {
    const failureRecord = buildOperationJournalRecord(
      operationId,
      bundle.journal.sequence + 1,
      bundle.journal.head_sha256,
      "operation-failed",
      {
        code: "TIMEOUT",
        phase: bundle.status.active_phase ?? latestPhaseFailure(bundle.journal.records)?.data.phase ?? null,
        attempt_id: bundle.status.current_attempt_id ?? latestPhaseFailure(bundle.journal.records)?.data.attempt_id ?? null,
        diagnostic_sha256: hashContract({
          operation_id: operationId,
          reason: "lease-expired",
          wall_expires_at: lease.wall_expires_at
        })
      },
      now().toISOString()
    );
    await appendAlignmentOperationJournal(dataRoot, repositoryIdentity, failureRecord, {
      expectedSequence: bundle.journal.sequence,
      expectedPreviousSha256: bundle.journal.head_sha256
    });
    const status = buildLiveAlignmentStatus(bundle.operation, {
      status: "failed",
      active_phase: null,
      current_attempt_id: null,
      agent_attempts: bundle.status.agent_attempts,
      provider_requests: bundle.status.provider_requests,
      total_tokens: bundle.status.total_tokens,
      retained_records: bundle.status.retained_records,
      retained_bytes: bundle.status.retained_bytes,
      analysis_plan_ref: bundle.status.analysis_plan_ref,
      research_subject_ref: bundle.status.research_subject_ref,
      research_authority_epoch: bundle.status.research_authority_epoch,
      result_bundle_ref: bundle.status.result_bundle_ref,
      checkpoint_sha256: bundle.status.checkpoint_sha256,
      terminal_error: "TIMEOUT"
    });
    await writeAlignmentOperationStatus(dataRoot, repositoryIdentity, status);
    return {
      ...bundle,
      journal: await loadAlignmentOperationJournal(dataRoot, repositoryIdentity, operationId),
      status
    };
  }
  return bundle;
}

export async function loadLiveAlignmentOperationBundle(dataRoot, repositoryIdentity, operationId) {
  const operation = await loadAlignmentOperation(dataRoot, repositoryIdentity, operationId);
  if (!operation) return null;
  const analysisPlan = await loadAlignmentAnalysisPlan(dataRoot, repositoryIdentity, operationId);
  const interactionPacket = await loadAlignmentInteractionPacket(dataRoot, repositoryIdentity, operationId);
  const developerAnswers = await loadAlignmentDeveloperAnswers(dataRoot, repositoryIdentity, operationId);
  const status = await loadAlignmentOperationStatus(dataRoot, repositoryIdentity, operationId);
  const lease = await loadAlignmentOperationLease(dataRoot, repositoryIdentity, operationId);
  const fence = await loadAlignmentTerminalFence(dataRoot, repositoryIdentity, operationId);
  return { operation, analysisPlan, interactionPacket, developerAnswers, status, lease, fence, paths: alignmentOperationPaths(dataRoot, repositoryIdentity, operationId) };
}

export async function findLiveAlignmentOperationBundleByRun(dataRoot, repositoryIdentity, runId, commitSha = null) {
  let entries;
  try {
    entries = await readdir(alignmentOperationsRoot(dataRoot, repositoryIdentity), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const operation = await loadAlignmentOperation(dataRoot, repositoryIdentity, entry.name);
    if (!operation || operation.run_id !== runId) continue;
    if (commitSha && operation.commit_sha !== commitSha) continue;
    return loadLiveAlignmentOperationBundle(dataRoot, repositoryIdentity, operation.id);
  }
  return null;
}

export async function projectLiveAlignmentOperationStatus(dataRoot, repositoryIdentity, operationId, context = {}) {
  const bundle = await loadLiveAlignmentOperationBundle(dataRoot, repositoryIdentity, operationId);
  if (!bundle) return null;
  const projected = projectAlignmentState(bundle.status, context);
  const nextStatus = {
    ...bundle.status,
    status: projected.status,
    active_phase: projected.active_phase,
    terminal_error: context.failureReason ?? bundle.status.terminal_error
  };
  await writeAlignmentOperationStatus(dataRoot, repositoryIdentity, nextStatus);
  return { ...bundle, status: nextStatus, projection: projected };
}

export function createLiveAlignmentArtifactRefs({
  goal,
  snapshot,
  onboarding,
  developerAnswers = []
}) {
  return {
    goal: artifactRef(goal.id, "goal", goal.sha256, goal.storage_key, goal.media_type, goal.size_bytes),
    snapshot: artifactRef(snapshot.id, "snapshot", snapshot.sha256, snapshot.storage_key, snapshot.media_type, snapshot.size_bytes),
    onboarding: artifactRef(onboarding.id, "onboarding", onboarding.sha256, onboarding.storage_key, onboarding.media_type, onboarding.size_bytes),
    developerAnswers: developerAnswers.map((answer) => artifactRef(answer.id, "developer-answer", answer.sha256, answer.storage_key, answer.media_type, answer.size_bytes))
  };
}

export function stableLiveAlignmentOperationId(parts) {
  return `alignment-operation-${operationDigest(parts).slice(0, 32)}`;
}

export function stableLiveAlignmentExecutionId() {
  return `execution-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}
