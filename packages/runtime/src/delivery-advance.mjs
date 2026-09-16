import { createRunEvent } from "../../core/src/goal-run.mjs";
import { evaluateInteractionPacket } from "../../core/src/interaction-policy.mjs";
import { allowedTransitions } from "../../core/src/state-machine.mjs";
import { assertContract } from "../../project/src/contracts.mjs";
import { hashContract } from "../../project/src/harness.mjs";

const DELIVERY_PIPELINE = Object.freeze([
  "verifying",
  "reviewing",
  "preparing_delivery",
  "awaiting_delivery_approval"
]);

function transition(runId, sequence, at, from, to) {
  if (!allowedTransitions(from).includes(to)) {
    throw new Error(`Delivery advance cannot transition ${from} -> ${to}.`);
  }
  return createRunEvent({ runId, sequence, at, type: "state.transitioned", data: { from, to } });
}

function artifact(id, kind, value) {
  return { id, kind, value, sha256: hashContract(value) };
}

function item(id, text, confidence, severity, sourceRefs) {
  return { id, text, confidence, severity, source_refs: sourceRefs };
}

export function deliveryAdvanceSupported(run, scorecard) {
  return run?.state === "verifying"
    && run?.gates?.scope?.status === "approved"
    && scorecard?.verdict === "ready"
    && scorecard?.run_id === run.id
    && scorecard?.head_sha === run.current_head_sha;
}

/**
 * After attested verify leaves a ready tip scorecard, build Gate 2 Delivery Brief
 * and move verifying → reviewing → preparing_delivery → awaiting_delivery_approval.
 * Does not promote/merge consumer changes; isolated worktree commits stay isolated.
 */
export async function createDeliveryAdvanceCheckpoint({
  run,
  scorecard,
  priorArtifacts = [],
  nextSequence,
  generatedAt = new Date().toISOString()
}) {
  if (!deliveryAdvanceSupported(run, scorecard)) {
    throw new Error("Delivery advance requires state=verifying, approved scope, and a ready tip scorecard.");
  }
  if (!Number.isInteger(nextSequence) || nextSequence < 2) {
    throw new Error("Delivery advance requires the next event sequence.");
  }

  let readiness = null;
  for (const entry of priorArtifacts) {
    if (entry.id === "artifact-readiness-summary") readiness = entry.value;
  }

  const deliveryMode = readiness?.delivery_mode === "controlled-change" ? "controlled-change" : "docs-only";
  const changeCommitSha = readiness?.change_commit_sha ?? null;
  const changeWorktree = readiness?.change_worktree ?? null;
  const changePath = readiness?.change_path ?? null;

  const briefValue = {
    schema_version: 1,
    kind: "delivery-brief-record",
    run_id: run.id,
    head_sha: run.current_head_sha,
    generated_at: generatedAt,
    delivery_mode: deliveryMode,
    goal: run.goal.refined ?? run.goal.original,
    scope_gate: run.gates.scope.status,
    scorecard_verdict: scorecard.verdict,
    scorecard_id: scorecard.id,
    change_commit_sha: changeCommitSha,
    change_worktree: changeWorktree,
    change_path: changePath,
    consumer_mutation: deliveryMode === "controlled-change",
    promote_required: deliveryMode === "controlled-change",
    summary: deliveryMode === "controlled-change"
      ? "Bounded controlled change is verified in an isolated worktree. Gate 2 approval closes the Goal Run; promote/PR remains a separate explicit step."
      : "Docs-only delivery is verified. Gate 2 approval closes the Goal Run without consumer source mutation."
  };
  const briefArtifact = artifact("artifact-delivery-brief", "delivery-brief", briefValue);

  const byId = new Map();
  for (const entry of priorArtifacts) {
    if (["artifact-onboarding-plan", "artifact-goal-input", "artifact-repository-snapshot", "artifact-readiness-summary", "artifact-execution-plan"].includes(entry.id)) {
      byId.set(entry.id, entry);
    }
  }
  byId.set(briefArtifact.id, briefArtifact);
  const artifacts = [...byId.values()];

  const sections = [
    {
      id: "delivery-outcome",
      title: "Delivery outcome",
      items: [
        item(
          "delivery-outcome-summary",
          briefValue.summary,
          "confirmed",
          "info",
          [briefArtifact.id, "artifact-readiness-summary"].filter((id) => byId.has(id))
        )
      ]
    },
    {
      id: "delivery-proof",
      title: "Proof",
      items: [
        item(
          "delivery-scorecard-ready",
          `Tip review scorecard is ${scorecard.verdict} with ${scorecard.exception_counts?.blocking ?? 0} blocking exception(s).`,
          "confirmed",
          "info",
          [briefArtifact.id]
        )
      ]
    }
  ];
  if (deliveryMode === "controlled-change") {
    sections.push({
      id: "delivery-change",
      title: "Bounded change",
      items: [
        item(
          "delivery-change-revision",
          `Isolated change revision ${changeCommitSha?.slice(0, 12) ?? "unknown"} writes ${changePath ?? "bounded path"}; baseline checkout ${run.current_head_sha.slice(0, 12)} stays clean until explicit promote.`,
          "confirmed",
          "info",
          [briefArtifact.id, "artifact-readiness-summary"].filter((id) => byId.has(id))
        )
      ]
    });
  }

  const surfacedItems = sections.flatMap((section) => section.items);
  const packetBody = {
    schema_version: 1,
    run_id: run.id,
    kind: "delivery-brief",
    generated_at: generatedAt,
    head_sha: run.current_head_sha,
    title: `Delivery Brief · ${run.goal.original}`,
    verdict: "ready",
    summary: briefValue.summary,
    attention: { required: true, count: 1, reasons: ["gate-approval"] },
    sections,
    decisions: [],
    actions: [
      { id: "approve-delivery", label: "Approve delivery (Gate 2)", kind: "approve", recommended: true },
      { id: "inspect-delivery", label: "Inspect delivery evidence", kind: "inspect", recommended: false }
    ],
    source_artifacts: artifacts.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      sha256: entry.sha256,
      uri: `artifacts/${entry.id}.json`
    })),
    traceability: surfacedItems.map((entry) => ({ item_id: entry.id, source_refs: entry.source_refs })),
    compression: {
      source_artifact_count: artifacts.length,
      surfaced_item_count: surfacedItems.length,
      omitted_item_count: 0
    }
  };
  const packet = { ...packetBody, id: `packet-${hashContract(packetBody).slice(0, 32)}` };
  await assertContract("interaction-packet", packet);
  const packetPolicy = evaluateInteractionPacket(packet);
  if (!packetPolicy.valid) {
    throw new Error(`Delivery Brief policy failed: ${packetPolicy.reasons.map((reason) => reason.code).join(", ")}`);
  }

  const events = [];
  let sequence = nextSequence;
  let from = run.state;
  for (const to of DELIVERY_PIPELINE.slice(1)) {
    events.push(transition(run.id, sequence, generatedAt, from, to));
    sequence += 1;
    from = to;
  }
  events.push(createRunEvent({
    runId: run.id,
    sequence,
    at: generatedAt,
    type: "interaction.published",
    data: { packet_id: packet.id, packet_sha256: hashContract(packet) }
  }));

  const nextRun = structuredClone(run);
  nextRun.state = "awaiting_delivery_approval";
  nextRun.timestamps.updated_at = generatedAt;

  return {
    run: nextRun,
    events,
    packet,
    artifacts,
    delivery: {
      mode: deliveryMode,
      brief_id: briefArtifact.id,
      brief_sha256: briefArtifact.sha256,
      change_commit_sha: changeCommitSha
    }
  };
}
