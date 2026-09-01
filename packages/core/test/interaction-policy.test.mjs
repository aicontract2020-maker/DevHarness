import assert from "node:assert/strict";
import test from "node:test";

import { evaluateInteractionPacket } from "../src/interaction-policy.mjs";

const sha = "a".repeat(40);
const artifactHash = "b".repeat(64);

function packet(kind = "alignment-brief") {
  return {
    schema_version: 1,
    id: `packet-${kind}`,
    run_id: "run-1",
    kind,
    generated_at: "2026-08-29T12:00:00.000Z",
    head_sha: sha,
    title: "Password reset",
    verdict: "action-required",
    summary: "One decision remains before execution.",
    attention: { required: true, count: 2, reasons: ["gate-approval", "security-or-privacy"] },
    sections: [
      {
        id: "outcome",
        title: "Outcome",
        items: [
          {
            id: "outcome-item",
            text: "A user can reset a forgotten password.",
            confidence: "confirmed",
            severity: "info",
            source_refs: ["requirements"]
          }
        ]
      }
    ],
    decisions: [
      {
        id: "revoke-sessions",
        question: "Revoke existing sessions?",
        why_now: "This changes security behavior.",
        impact: "high",
        reversibility: "costly",
        recommended_option_id: "revoke-all",
        options: [
          { id: "revoke-all", label: "Revoke", outcome: "Sessions end.", tradeoffs: ["More work"] },
          { id: "keep", label: "Keep", outcome: "Sessions remain.", tradeoffs: ["More risk"] }
        ]
      }
    ],
    actions: [
      { id: "approve", label: "Approve", kind: "approve", recommended: true },
      { id: "inspect", label: "Inspect", kind: "inspect", recommended: false }
    ],
    source_artifacts: [{ id: "requirements", kind: "requirements", sha256: artifactHash }],
    traceability: [{ item_id: "outcome-item", source_refs: ["requirements"] }],
    compression: { source_artifact_count: 1, surfaced_item_count: 2, omitted_item_count: 4 }
  };
}

test("a traceable Alignment Brief with bounded attention is valid", () => {
  assert.deepEqual(evaluateInteractionPacket(packet()), { valid: true, reasons: [] });
});

test("a blocked Alignment Brief requests evidence without pretending scope can be approved", () => {
  const input = packet();
  input.decisions = [];
  input.actions = [{ id: "inspect", label: "Review missing proof", kind: "inspect", recommended: true }];
  input.attention = { required: true, count: 1, reasons: ["verification-blocker"] };
  input.sections[0].items[0].severity = "blocking";
  input.compression.surfaced_item_count = 1;

  assert.deepEqual(evaluateInteractionPacket(input), { valid: true, reasons: [] });
});

test("a ready Alignment Brief cannot omit explicit gate approval", () => {
  const input = packet();
  input.decisions = [];
  input.verdict = "ready";
  input.attention = { required: true, count: 1, reasons: ["verification-blocker"] };
  input.compression.surfaced_item_count = 1;

  const result = evaluateInteractionPacket(input);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((reason) => reason.code === "gate_attention_missing"));
});

test("blocking claims cannot hide behind a ready verdict", () => {
  const input = packet("delivery-brief");
  input.decisions = [];
  input.attention.count = 1;
  input.attention.reasons = ["gate-approval"];
  input.verdict = "ready";
  input.sections[0].items[0].severity = "blocking";
  input.compression.surfaced_item_count = 1;

  const result = evaluateInteractionPacket(input);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((reason) => reason.code === "blocking_item_hidden"));
});

test("every surfaced claim must trace to a known source artifact", () => {
  const input = packet();
  input.traceability[0].source_refs = ["missing-artifact"];

  const result = evaluateInteractionPacket(input);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((reason) => reason.code === "item_mapping_mismatch"));
  assert.ok(result.reasons.some((reason) => reason.code === "source_missing"));
});

test("a Progress Pulse cannot disguise a decision as status", () => {
  const input = packet("progress-pulse");
  input.attention = { required: false, count: 0, reasons: [] };
  input.verdict = "informational";

  const result = evaluateInteractionPacket(input);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((reason) => reason.code === "progress_requires_action"));
  assert.ok(result.reasons.some((reason) => reason.code === "decision_without_attention"));
});
