import { readFile } from "node:fs/promises";

import { appendGoalRunCheckpoint, loadGoalRun, loadRunScorecard, loadRunSourceArtifact } from "./goal-run-store.mjs";
import { runStoragePaths } from "./goal-run-store.mjs";
import {
  buildLiveAlignmentDeveloperAnswer,
  findLiveAlignmentOperationBundleByRun,
  loadLiveAlignmentOperationBundle
} from "./live-alignment.mjs";
import {
  createSupervisorApprovalRequest,
  recordInteractiveApprovalDecision
} from "./supervisor-approval.mjs";
import {
  initializeSupervisorIdentity,
  listVerifiedApprovalReceipts,
  listVerifiedApprovalRequests
} from "./supervisor-store.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import {
  writeAlignmentDeveloperAnswer,
  writeAlignmentOperationStatus
} from "./alignment-operation-store.mjs";

function alignmentAnswerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function alignmentAnswerSubject({ operation, packetSha256, decisionId, optionId }) {
  const body = {
    schema_version: 1,
    run_id: operation.run_id,
    repository_identity: operation.repository_identity,
    commit_sha: operation.commit_sha,
    packet_sha256: packetSha256,
    decision_id: decisionId,
    option_id: optionId
  };
  const sha256 = hashContract(body);
  return {
    id: `alignment-answer-subject-${sha256.slice(0, 32)}`,
    artifact_sha256: sha256
  };
}

function nextLiveAction(status) {
  if (!status) return "Inspect the live Alignment bundle.";
  if (status.status === "waiting-agent-authority") return "Approve the exact agent authority, then continue the live operation.";
  if (status.status === "waiting-research-authority") return "Approve the research authority, then continue the live operation.";
  if (status.status === "running") return "Let the live operation continue and inspect progress when needed.";
  if (status.status === "question-blocked") return "Answer the blocked question before resuming the live operation.";
  if (status.status === "ready") return "Review the ready Alignment Brief and decide whether to approve scope.";
  if (status.status === "failed") return "Retry the failed phase or cancel the operation if the goal changed.";
  if (status.status === "timed-out") return "Retry or cancel the timed-out operation.";
  if (status.status === "cancelled") return "Start a new Goal Run if the work is still desired.";
  return "Continue the live operation.";
}

async function loadApprovalArtifacts(supervisorRoot, repositoryIdentity, requestId, receiptId) {
  const [requests, receipts] = await Promise.all([
    listVerifiedApprovalRequests(supervisorRoot, repositoryIdentity),
    listVerifiedApprovalReceipts(supervisorRoot, repositoryIdentity)
  ]);
  return {
    request: requests.find((candidate) => candidate.id === requestId) ?? null,
    receipt: receipts.find((candidate) => candidate.id === receiptId) ?? null
  };
}

function selectDecision(packet, decisionId, optionId) {
  const decision = packet.decisions.find((candidate) => candidate.id === decisionId);
  if (!decision) throw alignmentAnswerError("ANSWER_INVALID", `Unknown decision id: ${decisionId}`);
  const option = decision.options.find((candidate) => candidate.id === optionId);
  if (!option) throw alignmentAnswerError("ANSWER_INVALID", `Unknown option id: ${optionId}`);
  return { decision, option };
}

function promptDetails(packet, decision, option) {
  return [
    `Decision: ${decision.question}`,
    `Choice: ${option.label}`,
    `Outcome: ${option.outcome}`,
    `Tradeoffs: ${option.tradeoffs.join(" | ")}`,
    ...packet.source_artifacts.map((artifact) => `Source: ${artifact.kind} ${artifact.id}`)
  ];
}

function buildAnswerCheckpointPacket(packet, answer, now) {
  const timestamp = now().toISOString();
  const next = structuredClone(packet);
  delete next.id;
  next.generated_at = timestamp;
  next.source_artifacts = [...next.source_artifacts, {
    id: answer.id,
    kind: "developer-answer",
    sha256: hashContract(answer),
    uri: `artifacts/${answer.id}.json`
  }];
  next.compression = {
    ...next.compression,
    source_artifact_count: next.source_artifacts.length
  };
  next.id = `packet-${hashContract(next).slice(0, 32)}`;
  return next;
}

async function loadCheckpointArtifacts(dataRoot, repositoryIdentity, runId, packet, analysisPlan, answer) {
  const artifacts = [];
  for (const source of packet.source_artifacts) {
    if (source.kind === "developer-answer") {
      artifacts.push({ id: answer.id, kind: "developer-answer", value: answer, sha256: hashContract(answer) });
      continue;
    }
    if (source.kind === "analysis-plan") {
      artifacts.push({ id: analysisPlan.id, kind: "analysis-plan", value: analysisPlan, sha256: hashContract(analysisPlan) });
      continue;
    }
    const loaded = await loadRunSourceArtifact(dataRoot, repositoryIdentity, runId, source.id);
    artifacts.push({ id: source.id, kind: source.kind, value: loaded.value, sha256: source.sha256 });
  }
  return artifacts;
}

export async function recordAlignmentAnswer({
  dataRoot,
  supervisorRoot,
  repositoryIdentity,
  runId,
  packetSha256 = null,
  decisionId,
  optionId,
  responseProvider = null,
  now = () => new Date()
}) {
  const run = await loadGoalRun(dataRoot, repositoryIdentity, runId);
  const currentBundle = await findLiveAlignmentOperationBundleByRun(dataRoot, repositoryIdentity, runId, run.current_head_sha);
  if (!currentBundle) {
    const staleBundle = await findLiveAlignmentOperationBundleByRun(dataRoot, repositoryIdentity, runId);
    if (staleBundle) throw alignmentAnswerError("ANSWER_STALE", "Reload the current packet before answering.");
    throw alignmentAnswerError("SCOPE_NOT_READY", "The current run does not have a live question packet to answer.");
  }

  const bundle = currentBundle;
  if (!bundle.interactionPacket || !Array.isArray(bundle.interactionPacket.decisions) || bundle.interactionPacket.decisions.length === 0) {
    throw alignmentAnswerError("SCOPE_NOT_READY", "The current packet does not contain a blocked developer question.");
  }
  if (bundle.status?.status !== "question-blocked") {
    throw alignmentAnswerError("SCOPE_NOT_READY", "The current live packet is not blocked on a developer answer.");
  }

  const currentPacketSha256 = hashContract(bundle.interactionPacket);
  if (packetSha256 && packetSha256 !== currentPacketSha256) {
    throw alignmentAnswerError("ANSWER_STALE", "Reload the current packet before answering.");
  }

  const { decision, option } = selectDecision(bundle.interactionPacket, decisionId, optionId);
  const existingAnswer = (bundle.developerAnswers ?? []).find((answer) => answer.decision_id === decisionId);
  if (existingAnswer) {
    if (existingAnswer.option_id !== optionId) {
      throw alignmentAnswerError("ANSWER_INVALID", "A different answer for the same decision is not allowed in v1.");
    }
    if (existingAnswer.packet_sha256 !== currentPacketSha256) {
      throw alignmentAnswerError("ANSWER_STALE", "Reload the current packet before answering.");
    }
    const linked = await loadApprovalArtifacts(
      supervisorRoot,
      repositoryIdentity,
      existingAnswer.decision_ref.request_id,
      existingAnswer.decision_ref.receipt_id
    );
    return {
      run,
      operation: bundle.operation,
      bundle,
      status: bundle.status,
      lease: bundle.lease,
      fence: bundle.fence,
      request: linked.request,
      receipt: linked.receipt,
      answer: existingAnswer,
      replayed: true,
      next_action: nextLiveAction(bundle.status)
    };
  }

  await initializeSupervisorIdentity(supervisorRoot, { now });
  const subject = alignmentAnswerSubject({
    operation: bundle.operation,
    packetSha256: currentPacketSha256,
    decisionId,
    optionId
  });
  const request = await createSupervisorApprovalRequest({
    supervisorRoot,
    repositoryIdentity,
    relevantHeadSha: bundle.operation.commit_sha,
    runId: bundle.operation.run_id,
    gate: "alignment-answer",
    subject,
    expiresInMinutes: 60,
    now
  });
  const receipt = await recordInteractiveApprovalDecision({
    supervisorRoot,
    repositoryIdentity,
    requestId: request.id,
    humanId: "developer",
    details: promptDetails(bundle.interactionPacket, decision, option),
    responseProvider,
    emitPrompt: true,
    now
  });
  const answer = buildLiveAlignmentDeveloperAnswer({
    operation: bundle.operation,
    packet: bundle.interactionPacket,
    decision,
    option,
    request,
    receipt
  }).answer;
  const storedAnswer = await writeAlignmentDeveloperAnswer(dataRoot, repositoryIdentity, bundle.operation.id, answer);
  const checkpointPacket = buildAnswerCheckpointPacket(bundle.interactionPacket, answer, now);
  const checkpointArtifacts = await loadCheckpointArtifacts(dataRoot, repositoryIdentity, runId, checkpointPacket, bundle.analysisPlan, answer);
  const currentPointer = JSON.parse(await readFile(runStoragePaths(dataRoot, repositoryIdentity, runId).current, "utf8"));
  const nextSequence = Number.isInteger(currentPointer?.sequence) ? currentPointer.sequence + 1 : 2;
  await appendGoalRunCheckpoint({
    dataRoot,
    repositoryIdentity,
    runId,
    events: [{
      schema_version: 1,
      event_id: `event-${hashContract({
        run_id: runId,
        packet_sha256: currentPacketSha256,
        decision_id: decision.id,
        option_id: option.id,
        answer_id: answer.id
      }).slice(0, 24)}`,
      run_id: runId,
      sequence: nextSequence,
      at: now().toISOString(),
      type: "question.answered",
      actor: { id: "runtime", kind: "runtime", role: "orchestrator" },
      data: {
        packet_id: bundle.interactionPacket.id,
        packet_sha256: currentPacketSha256,
        decision_id: decision.id,
        option_id: option.id,
        answer_id: answer.id,
        answer_sha256: hashContract(answer)
      }
    }],
    nextRun: (() => {
      const nextRun = structuredClone(run);
      nextRun.timestamps.updated_at = now().toISOString();
      return nextRun;
    })(),
    scorecard: await loadRunScorecard(dataRoot, repositoryIdentity, runId),
    packet: checkpointPacket,
    artifacts: checkpointArtifacts
  });
  const remainingQuestions = Math.max(0, bundle.interactionPacket.decisions.length - 1 - (bundle.developerAnswers?.length ?? 0));
  const nextStatus = remainingQuestions > 0
    ? { ...bundle.status, status: "question-blocked", active_phase: bundle.status?.active_phase ?? "analysis-plan" }
    : { ...bundle.status, status: "waiting-agent-authority", active_phase: "analysis-plan" };
  await writeAlignmentOperationStatus(dataRoot, repositoryIdentity, nextStatus);
  const refreshed = await loadLiveAlignmentOperationBundle(dataRoot, repositoryIdentity, bundle.operation.id);
  return {
    run,
    operation: refreshed.operation,
    bundle: refreshed,
    status: refreshed.status,
    lease: refreshed.lease,
    fence: refreshed.fence,
    request,
    receipt,
    answer,
    storedAnswer,
    replayed: false,
    next_action: nextLiveAction(refreshed.status)
  };
}
