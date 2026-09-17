import assert from "node:assert/strict";
import test from "node:test";

import {
  pickConservativeInferAnswers,
  summarizeAlignCapabilityGap,
  alignCompressionHints
} from "../src/align-capabilities.mjs";

test("pickConservativeInferAnswers selects *-infer for each unresolved decision", () => {
  const packet = {
    decisions: [
      {
        id: "decision-1",
        options: [
          { id: "question-1-clarify", label: "Clarify now" },
          { id: "question-1-infer", label: "Infer conservatively" }
        ]
      },
      {
        id: "decision-2",
        options: [
          { id: "question-2-clarify", label: "Clarify now" },
          { id: "question-2-infer", label: "Infer conservatively" }
        ]
      }
    ]
  };
  const picked = pickConservativeInferAnswers(packet, [{ decision_id: "decision-1", option_id: "question-1-infer" }]);
  assert.equal(picked.unresolved_before, 1);
  assert.deepEqual(picked.pairs, [{ decisionId: "decision-2", optionId: "question-2-infer" }]);
  assert.equal(picked.skipped.length, 0);
});

test("pickConservativeInferAnswers skips decisions without infer option", () => {
  const packet = {
    decisions: [
      { id: "decision-x", options: [{ id: "only-clarify", label: "Clarify now" }] }
    ]
  };
  const picked = pickConservativeInferAnswers(packet, []);
  assert.equal(picked.pairs.length, 0);
  assert.equal(picked.skipped[0].decisionId, "decision-x");
});

test("summarizeAlignCapabilityGap lists research tasks needing approval", () => {
  const view = {
    research_tasks: [
      { id: "research-task-1", status: "pending-approval" },
      { id: "research-task-2", status: "approved" },
      { id: "research-task-3", status: "blocked" }
    ],
    capabilities: [
      { status: "unrequested", request: { id: "research-task-1" } },
      { status: "approved", request: { id: "research-task-2" }, approval_receipt_id: "r2" },
      { status: "unrequested", request: { id: "research-task-3" } },
      { status: "pending", request: { id: "network-research" }, approval_request_id: "req-nr" }
    ]
  };
  const gap = summarizeAlignCapabilityGap(view);
  assert.equal(gap.allowed, false);
  assert.ok(gap.required_capability_ids.includes("research-task-1"));
  assert.ok(gap.required_capability_ids.includes("research-task-3"));
  assert.ok(gap.required_capability_ids.includes("network-research"));
  assert.ok(gap.pending_ids.includes("network-research"));
  assert.ok(gap.need_request_ids.includes("research-task-1"));
});

test("alignCompressionHints points at infer then for-align", () => {
  assert.match(alignCompressionHints({ status: "question-blocked" }), /infer-conservative/);
  assert.match(alignCompressionHints({ status: "waiting-research-authority" }), /for-align/);
  assert.match(alignCompressionHints({ researchPending: 2 }), /for-align/);
  assert.equal(alignCompressionHints({ status: "running" }), null);
});
