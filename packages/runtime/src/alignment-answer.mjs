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
  recordInteractiveApprovalDecisions
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
  if (status.status === "waiting-research-authority") return "Approve research authority (`devharness request-capability --run ID --for-align --approve`), then continue.";
  if (status.status === "running") return "Let the live operation continue and inspect progress when needed.";
  if (status.status === "question-blocked") return "Answer blocked questions (`devharness answer --run ID --infer-conservative`), then continue.";
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

export async function recordAlignmentAnswers({
  dataRoot,
  supervisorRoot,
  repositoryIdentity,
  runId,
  packetSha256 = null,
  answers,
  responseProvider = null,
  now = () => new Date()
}) {
  if (!Array.isArray(answers) || answers.length === 0) {
    throw alignmentAnswerError("ANSWER_INVALID", "At least one decision/option pair is required.");
  }
  const normalized = [];
  const seenDecisions = new Set();
  for (const entry of answers) {
    const decisionId = entry?.decisionId ?? entry?.decision_id;
    const optionId = entry?.optionId ?? entry?.option_id;
    if (!decisionId || !optionId) {
      throw alignmentAnswerError("ANSWER_INVALID", "Each answer requires decisionId and optionId.");
    }
    if (seenDecisions.has(decisionId)) {
      throw alignmentAnswerError("ANSWER_INVALID", `Duplicate decision id in answer packet: ${decisionId}`);
    }
    seenDecisions.add(decisionId);
    normalized.push({ decisionId, optionId });
  }

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

  const existingByDecision = new Map((bundle.developerAnswers ?? []).map((answer) => [answer.decision_id, answer]));
  const pending = [];
  const replayed = [];
  for (const entry of normalized) {
    const { decision, option } = selectDecision(bundle.interactionPacket, entry.decisionId, entry.optionId);
    const existingAnswer = existingByDecision.get(entry.decisionId);
    if (existingAnswer) {
      if (existingAnswer.option_id !== entry.optionId) {
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
      replayed.push({
        decision,
        option,
        answer: existingAnswer,
        request: linked.request,
        receipt: linked.receipt
      });
      continue;
    }
    pending.push({ decision, option, decisionId: entry.decisionId, optionId: entry.optionId });
  }

  if (pending.length === 0) {
    return {
      run,
      operation: bundle.operation,
      bundle,
      status: bundle.status,
      lease: bundle.lease,
      fence: bundle.fence,
      answers: replayed.map((item) => item.answer),
      answer: replayed[0]?.answer ?? null,
      receipts: replayed.map((item) => item.receipt),
      receipt: replayed[0]?.receipt ?? null,
      requests: replayed.map((item) => item.request),
      request: replayed[0]?.request ?? null,
      replayed: true,
      next_action: nextLiveAction(bundle.status)
    };
  }

  await initializeSupervisorIdentity(supervisorRoot, { now });
  const prepared = [];
  for (const item of pending) {
    const subject = alignmentAnswerSubject({
      operation: bundle.operation,
      packetSha256: currentPacketSha256,
      decisionId: item.decisionId,
      optionId: item.optionId
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
    prepared.push({
      ...item,
      request,
      details: promptDetails(bundle.interactionPacket, item.decision, item.option)
    });
  }

  const requestIds = prepared.map((item) => item.request.id);
  const detailsByRequestId = Object.fromEntries(prepared.map((item) => [item.request.id, item.details]));
  const batch = await recordInteractiveApprovalDecisions({
    supervisorRoot,
    repositoryIdentity,
    requestIds,
    humanId: "developer",
    detailsByRequestId,
    responseProvider,
    emitPrompt: true,
    now
  });
  if (batch.decision !== "approved") {
    throw alignmentAnswerError("ANSWER_INVALID", "Alignment answers were rejected; no developer answers were recorded.");
  }

  const receiptByRequestId = new Map(batch.receipts.map((receipt) => [receipt.request_id, receipt]));
  const writtenAnswers = [];
  let workingBundle = bundle;
  for (const item of prepared) {
    const receipt = receiptByRequestId.get(item.request.id);
    const answer = buildLiveAlignmentDeveloperAnswer({
      operation: workingBundle.operation,
      packet: workingBundle.interactionPacket,
      decision: item.decision,
      option: item.option,
      request: item.request,
      receipt
    }).answer;
    await writeAlignmentDeveloperAnswer(dataRoot, repositoryIdentity, workingBundle.operation.id, answer);
    const checkpointPacket = buildAnswerCheckpointPacket(workingBundle.interactionPacket, answer, now);
    const checkpointArtifacts = await loadCheckpointArtifacts(dataRoot, repositoryIdentity, runId, checkpointPacket, workingBundle.analysisPlan, answer);
    const currentPointer = JSON.parse(await readFile(runStoragePaths(dataRoot, repositoryIdentity, runId).current, "utf8"));
    const nextSequence = Number.isInteger(currentPointer?.sequence) ? currentPointer.sequence + 1 : 2;
    const liveRun = await loadGoalRun(dataRoot, repositoryIdentity, runId);
    await appendGoalRunCheckpoint({
      dataRoot,
      repositoryIdentity,
      runId,
      events: [{
        schema_version: 1,
        event_id: `event-${hashContract({
          run_id: runId,
          packet_sha256: currentPacketSha256,
          decision_id: item.decision.id,
          option_id: item.option.id,
          answer_id: answer.id
        }).slice(0, 24)}`,
        run_id: runId,
        sequence: nextSequence,
        at: now().toISOString(),
        type: "question.answered",
        actor: { id: "runtime", kind: "runtime", role: "orchestrator" },
        data: {
          packet_id: workingBundle.interactionPacket.id,
          packet_sha256: currentPacketSha256,
          decision_id: item.decision.id,
          option_id: item.option.id,
          answer_id: answer.id,
          answer_sha256: hashContract(answer)
        }
      }],
      nextRun: (() => {
        const nextRun = structuredClone(liveRun);
        nextRun.timestamps.updated_at = now().toISOString();
        return nextRun;
      })(),
      scorecard: await loadRunScorecard(dataRoot, repositoryIdentity, runId),
      packet: checkpointPacket,
      artifacts: checkpointArtifacts
    });
    writtenAnswers.push({ answer, request: item.request, receipt });
  }

  const totalAnswered = (bundle.developerAnswers?.length ?? 0) + writtenAnswers.length;
  const remainingQuestions = Math.max(0, bundle.interactionPacket.decisions.length - totalAnswered);
  const nextStatus = remainingQuestions > 0
    ? { ...bundle.status, status: "question-blocked", active_phase: bundle.status?.active_phase ?? "analysis-plan" }
    : { ...bundle.status, status: "waiting-agent-authority", active_phase: "analysis-plan" };
  await writeAlignmentOperationStatus(dataRoot, repositoryIdentity, nextStatus);
  const refreshed = await loadLiveAlignmentOperationBundle(dataRoot, repositoryIdentity, bundle.operation.id);
  const allAnswers = [
    ...replayed.map((item) => item.answer),
    ...writtenAnswers.map((item) => item.answer)
  ];
  return {
    run,
    operation: refreshed.operation,
    bundle: refreshed,
    status: refreshed.status,
    lease: refreshed.lease,
    fence: refreshed.fence,
    answers: allAnswers,
    answer: allAnswers.length === 1 ? allAnswers[0] : allAnswers[allAnswers.length - 1],
    receipts: [
      ...replayed.map((item) => item.receipt),
      ...writtenAnswers.map((item) => item.receipt)
    ],
    receipt: writtenAnswers.length > 0
      ? writtenAnswers[writtenAnswers.length - 1].receipt
      : replayed[replayed.length - 1]?.receipt ?? null,
    requests: [
      ...replayed.map((item) => item.request),
      ...writtenAnswers.map((item) => item.request)
    ],
    request: writtenAnswers.length > 0
      ? writtenAnswers[writtenAnswers.length - 1].request
      : replayed[replayed.length - 1]?.request ?? null,
    storedAnswer: writtenAnswers.length > 0 ? writtenAnswers[writtenAnswers.length - 1].answer : null,
    replayed: writtenAnswers.length === 0,
    next_action: nextLiveAction(refreshed.status)
  };
}

export async function recordAlignmentAnswer({
  dataRoot,
  supervisorRoot,
  repositoryIdentity,
  runId,
  packetSha256 = null,
  decisionId,
  optionId,
  answers = null,
  responseProvider = null,
  now = () => new Date()
}) {
  const packet = Array.isArray(answers) && answers.length > 0
    ? answers
    : [{ decisionId, optionId }];
  return recordAlignmentAnswers({
    dataRoot,
    supervisorRoot,
    repositoryIdentity,
    runId,
    packetSha256,
    answers: packet,
    responseProvider,
    now
  });
}
