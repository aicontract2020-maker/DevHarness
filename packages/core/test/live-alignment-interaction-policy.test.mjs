import assert from "node:assert/strict";
import test from "node:test";

import { evaluateInteractionPacket } from "../src/interaction-policy.mjs";
import { buildLiveAlignmentInteractionPacket } from "../../runtime/src/live-alignment.mjs";

const repositoryIdentity = "example/project";
const commitSha = "b".repeat(40);
const sourceHash = "a".repeat(64);

function sourceRef(artifactId, pointer) {
  return {
    artifact_id: artifactId,
    artifact_sha256: sourceHash,
    location: { kind: "json", pointer }
  };
}

function artifact(id, kind) {
  return {
    id,
    kind,
    sha256: sourceHash,
    storage_key: `artifacts/${id}.json`
  };
}

function question(index) {
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
    source_refs: [sourceRef("analysis-plan-1", `/questions/${index}`)]
  };
}

function operation() {
  return {
    id: "operation-1",
    run_id: "run-1",
    repository_identity: repositoryIdentity,
    commit_sha: commitSha,
    agent_descriptor: {
      id: "codex",
      profile_id: "codex-readonly-analysis-v1"
    }
  };
}

function analysisPlan(questionCount) {
  return {
    id: "analysis-plan-1",
    questions: Array.from({ length: questionCount }, (_, index) => question(index)),
    clarification_questions: [],
    research_topics: [],
    research_tasks: [],
    team_decomposition: []
  };
}

function packetArtifacts(packet) {
  return packet.sections.flatMap((section) => section.items);
}

test("question-blocked packets stay bounded, traceable, and decision-light", () => {
  const { packet } = buildLiveAlignmentInteractionPacket({
    operation: operation(),
    analysisPlan: analysisPlan(5),
    goalArtifact: artifact("goal-1", "goal"),
    snapshotArtifact: artifact("snapshot-1", "snapshot"),
    onboardingArtifact: artifact("onboarding-1", "onboarding")
  });

  assert.equal(packet.kind, "decision-queue");
  assert.equal(packet.verdict, "action-required");
  assert.equal(packet.sections.length, 9);
  assert.deepEqual(packet.sections.map((section) => section.title), [
    "Confirmed context",
    "Quantitative summary",
    "Crew split",
    "Execution graph",
    "Stage gates",
    "Clarification queue",
    "Preflight plan",
    "Questions to answer",
    "Recommended next step"
  ]);
  assert.equal(packet.decisions.length, 3);
  assert.equal(packet.attention.required, true);
  assert.equal(packet.attention.count, 3);
  assert.deepEqual(packet.actions.map((action) => action.kind), ["answer", "inspect"]);
  assert.equal(packet.actions.filter((action) => action.recommended).length, 1);
  assert.equal(packet.actions.some((action) => action.kind === "approve"), false);
  assert.equal(packet.traceability.length, packetArtifacts(packet).length + packet.decisions.length);
  assert.equal(
    [...packetArtifacts(packet), ...packet.decisions].every((item) => packet.traceability.some((entry) => entry.item_id === item.id)),
    true
  );
  assert.equal(packet.compression.surfaced_item_count, packetArtifacts(packet).length + packet.decisions.length);

  const result = evaluateInteractionPacket(packet);
  assert.equal(result.valid, true, JSON.stringify(result.reasons));
});

test("progress pulses remain no-action packets with a single inspect path", () => {
  const { packet } = buildLiveAlignmentInteractionPacket({
    operation: operation(),
    analysisPlan: analysisPlan(0),
    goalArtifact: artifact("goal-1", "goal"),
    snapshotArtifact: artifact("snapshot-1", "snapshot"),
    onboardingArtifact: artifact("onboarding-1", "onboarding")
  });

  assert.equal(packet.kind, "progress-pulse");
  assert.equal(packet.verdict, "informational");
  assert.equal(packet.decisions.length, 0);
  assert.equal(packet.attention.required, false);
  assert.equal(packet.attention.count, 0);
  assert.deepEqual(packet.actions, [
    { id: "inspect-progress", label: "Inspect the current progress", kind: "inspect", recommended: true }
  ]);

  const result = evaluateInteractionPacket(packet);
  assert.equal(result.valid, true, JSON.stringify(result.reasons));
});

test("ready briefs require explicit gate approval and a single recommended approve action", () => {
  const { packet } = buildLiveAlignmentInteractionPacket({
    operation: operation(),
    analysisPlan: analysisPlan(0),
    goalArtifact: artifact("goal-1", "goal"),
    snapshotArtifact: artifact("snapshot-1", "snapshot"),
    onboardingArtifact: artifact("onboarding-1", "onboarding")
  });

  const readyPacket = structuredClone(packet);
  readyPacket.kind = "alignment-brief";
  readyPacket.verdict = "ready";
  readyPacket.title = "Ready alignment brief";
  readyPacket.summary = "The scope is ready for explicit approval.";
  readyPacket.attention = { required: true, count: 0, reasons: ["gate-approval"] };
  readyPacket.decisions = [];
  readyPacket.actions = [
    { id: "approve-scope", label: "Approve scope", kind: "approve", recommended: true },
    { id: "inspect-brief", label: "Inspect the brief", kind: "inspect", recommended: false }
  ];
  readyPacket.compression = {
    ...readyPacket.compression,
    surfaced_item_count: packetArtifacts(readyPacket).length
  };

  const result = evaluateInteractionPacket(readyPacket);
  assert.equal(result.valid, true, JSON.stringify(result.reasons));
});
