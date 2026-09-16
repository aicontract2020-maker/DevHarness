import { readFile } from "node:fs/promises";

import { createRunEvent } from "../../core/src/goal-run.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import {
  appendGoalRunCheckpoint,
  loadGoalRun,
  loadRunInteraction,
  loadRunScorecard,
  loadRunSourceArtifact,
  runStoragePaths
} from "./goal-run-store.mjs";
import { listVerifiedApprovalReceipts } from "./supervisor-store.mjs";

const RUN_GATES = new Set(["scope", "delivery"]);

function gateDecisionFromReceipt(receipt) {
  return {
    status: receipt.decision === "approved" ? "approved" : "rejected",
    decided_at: receipt.decided_at,
    decided_by: structuredClone(receipt.decided_by),
    artifact_hash: receipt.subject.artifact_sha256
  };
}

function alreadyApplied(run, gate, decision) {
  const current = run.gates?.[gate];
  return current?.status === decision.status
    && current?.artifact_hash === decision.artifact_hash
    && current?.decided_at === decision.decided_at;
}

function buildGateDecisionPacket({ run, receipt, decision, at }) {
  const receiptSha256 = hashContract(receipt);
  const sourceId = `artifact-approval-receipt-${receipt.id.slice(-24)}`;
  const itemId = `gate-${receipt.gate}-decision`;
  const packetBody = {
    schema_version: 1,
    run_id: run.id,
    kind: "progress-pulse",
    generated_at: at,
    head_sha: run.current_head_sha,
    title: `${receipt.gate} gate ${decision.status}`,
    verdict: "informational",
    summary: `Supervisor-verified ${receipt.gate} gate was recorded as ${decision.status}.`,
    attention: { required: false, count: 0, reasons: [] },
    sections: [{
      id: "gate-decision",
      title: "Gate decision",
      items: [{
        id: itemId,
        text: `${receipt.gate} gate ${decision.status} via receipt ${receipt.id}.`,
        confidence: "confirmed",
        severity: "info",
        source_refs: [sourceId]
      }]
    }],
    decisions: [],
    actions: [{ id: "inspect-gate", label: "Inspect gate decision", kind: "inspect", recommended: true }],
    source_artifacts: [{
      id: sourceId,
      kind: "approval-receipt",
      sha256: receiptSha256,
      uri: `artifacts/${sourceId}.json`
    }],
    traceability: [{ item_id: itemId, source_refs: [sourceId] }],
    compression: { source_artifact_count: 1, surfaced_item_count: 1, omitted_item_count: 0 }
  };
  return {
    packet: { ...packetBody, id: `packet-${hashContract(packetBody).slice(0, 32)}` },
    artifacts: [{ id: sourceId, kind: "approval-receipt", value: receipt, sha256: receiptSha256 }]
  };
}

async function loadCurrentPacketArtifacts(dataRoot, repositoryIdentity, runId, packet) {
  const artifacts = [];
  for (const source of packet.source_artifacts) {
    const loaded = await loadRunSourceArtifact(dataRoot, repositoryIdentity, runId, source.id);
    artifacts.push({ id: source.id, kind: source.kind, value: loaded.value, sha256: source.sha256 });
  }
  return artifacts;
}

/**
 * Persist a Supervisor-verified scope/delivery receipt onto the Goal Run gates
 * via an append-only gate.decided checkpoint (idempotent when already applied).
 */
export async function applyRunGateFromApprovalReceipt({
  dataRoot,
  repositoryIdentity,
  receipt,
  now = () => new Date()
}) {
  if (!receipt || !RUN_GATES.has(receipt.gate)) {
    return { applied: false, reason: "not-a-run-gate", run: null, receipt };
  }
  if (!["approved", "rejected"].includes(receipt.decision)) {
    throw new Error("Run gate receipt must be approved or rejected.");
  }
  if (receipt.repository_identity !== repositoryIdentity) {
    throw new Error("Approval receipt repository does not match the Goal Run.");
  }

  const run = await loadGoalRun(dataRoot, repositoryIdentity, receipt.run_id);
  if (run.current_head_sha !== receipt.relevant_head_sha) {
    throw new Error("Approval receipt revision does not match the Goal Run head.");
  }

  const decision = gateDecisionFromReceipt(receipt);
  if (alreadyApplied(run, receipt.gate, decision)) {
    return { applied: false, reason: "already-applied", run, receipt };
  }

  const current = typeof now === "function" ? now() : now;
  const at = (current instanceof Date ? current : new Date(current)).toISOString();
  const paths = runStoragePaths(dataRoot, repositoryIdentity, receipt.run_id);
  let nextSequence = 2;
  try {
    const pointer = JSON.parse(await readFile(paths.current, "utf8"));
    if (Number.isInteger(pointer?.sequence) && pointer.sequence >= 1) nextSequence = pointer.sequence + 1;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const events = [
    createRunEvent({
      runId: receipt.run_id,
      sequence: nextSequence,
      at,
      type: "gate.decided",
      actor: structuredClone(receipt.decided_by),
      data: {
        gate: receipt.gate,
        decision,
        receipt_id: receipt.id,
        request_id: receipt.request_id
      }
    })
  ];

  const nextRun = structuredClone(run);
  nextRun.gates[receipt.gate] = structuredClone(decision);
  nextRun.timestamps.updated_at = at;

  if (
    receipt.gate === "scope"
    && receipt.decision === "approved"
    && run.state === "awaiting_scope_approval"
  ) {
    events.push(createRunEvent({
      runId: receipt.run_id,
      sequence: nextSequence + 1,
      at,
      type: "state.transitioned",
      actor: { id: "runtime", kind: "runtime", role: "orchestrator" },
      data: { from: "awaiting_scope_approval", to: "planning" }
    }));
    nextRun.state = "planning";
  }

  if (
    receipt.gate === "delivery"
    && receipt.decision === "approved"
    && run.state === "awaiting_delivery_approval"
  ) {
    events.push(createRunEvent({
      runId: receipt.run_id,
      sequence: nextSequence + 1,
      at,
      type: "state.transitioned",
      actor: { id: "runtime", kind: "runtime", role: "orchestrator" },
      data: { from: "awaiting_delivery_approval", to: "completed" }
    }));
    events.push(createRunEvent({
      runId: receipt.run_id,
      sequence: nextSequence + 2,
      at,
      type: "run.completed",
      actor: structuredClone(receipt.decided_by),
      data: { gate: "delivery", receipt_id: receipt.id }
    }));
    nextRun.state = "completed";
    nextRun.timestamps.completed_at = at;
  }

  const scorecard = await loadRunScorecard(dataRoot, repositoryIdentity, receipt.run_id);
  const existingPacket = await loadRunInteraction(dataRoot, repositoryIdentity, receipt.run_id);
  let packet;
  let artifacts;
  if (existingPacket) {
    packet = existingPacket;
    artifacts = await loadCurrentPacketArtifacts(dataRoot, repositoryIdentity, receipt.run_id, packet);
  } else {
    ({ packet, artifacts } = buildGateDecisionPacket({ run: nextRun, receipt, decision, at }));
  }

  await appendGoalRunCheckpoint({
    dataRoot,
    repositoryIdentity,
    runId: receipt.run_id,
    events,
    nextRun,
    scorecard,
    packet,
    artifacts
  });

  return {
    applied: true,
    reason: "applied",
    run: await loadGoalRun(dataRoot, repositoryIdentity, receipt.run_id),
    receipt
  };
}

/**
 * When a matching Supervisor-verified scope/delivery receipt already exists but
 * the Goal Run gate is still pending, write the gate onto the run.
 */
export async function reconcileRunGatesFromApprovals({
  dataRoot,
  supervisorRoot,
  repositoryIdentity,
  runId,
  now = () => new Date()
}) {
  const current = now instanceof Date ? now : new Date(now);
  const run = await loadGoalRun(dataRoot, repositoryIdentity, runId);
  const receipts = await listVerifiedApprovalReceipts(supervisorRoot, repositoryIdentity, { now: current });
  const applications = [];

  for (const gate of ["scope", "delivery"]) {
    if (run.gates?.[gate]?.status !== "pending") continue;
    const match = receipts.find((receipt) =>
      receipt.gate === gate
      && receipt.decision === "approved"
      && receipt.run_id === runId
      && receipt.relevant_head_sha === run.current_head_sha
      && receipt.repository_identity === repositoryIdentity
    );
    if (!match) continue;
    const result = await applyRunGateFromApprovalReceipt({
      dataRoot,
      repositoryIdentity,
      receipt: match,
      now: () => current
    });
    applications.push(result);
  }

  return {
    run: applications.length > 0
      ? await loadGoalRun(dataRoot, repositoryIdentity, runId)
      : run,
    applications
  };
}
